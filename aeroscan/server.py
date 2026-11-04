"""
AeroScan — drone-based aircraft EXTERIOR surface defect inspection dashboard.

    python server.py            ->  http://localhost:8000

A single background worker owns the video source and the YOLO model. It runs
model.track(..., tracker="bytetrack.yaml", persist=True) so every physical defect is
counted once, keeps the best-confidence crop of each one as its snapshot, and tags it with
the aircraft section the operator has selected. The page polls /api/state and shows the
annotated frames from the /api/stream MJPEG endpoint.

Environment overrides:
    AEROSCAN_WEIGHTS   path to the .pt weights   (default runs/detect/aircraft/weights/best.pt)
    AEROSCAN_PORT      HTTP port                 (default 8000)
    AEROSCAN_IMGSZ     inference size            (default 640)
    AEROSCAN_MIN_HITS  frames a track must be seen before it is counted (default 2)
"""
from __future__ import annotations

import asyncio
import csv
import io
import json
import os
import platform
import re
import sys
import threading
import time
import traceback
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent
STATIC = ROOT / "static"
UPLOADS = ROOT / "uploads"
SETTINGS_FILE = ROOT / "aeroscan_settings.json"
UPLOADS.mkdir(exist_ok=True)

WEIGHTS = Path(os.environ.get("AEROSCAN_WEIGHTS", ROOT / "runs" / "detect" / "aircraft" / "weights" / "best.pt"))
IMGSZ = int(os.environ.get("AEROSCAN_IMGSZ", "640"))
MIN_HITS = max(1, int(os.environ.get("AEROSCAN_MIN_HITS", "2")))
DEFAULT_RTSP = "rtsp://192.168.1.1:7070/webcam"
SECTIONS = ["Nose", "Forward Fuselage", "Wings & Engines", "Aft Fuselage", "Tail"]
STREAM_MAX_W = 1280
CONNECT_TIMEOUT_S = 12.0

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
VIDEO_EXT = {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".webm", ".wmv", ".mpg", ".mpeg"}

# --------------------------------------------------------------------------- class metadata
# Class names always come from model.names; these keyword rules only decide weight/colour.
SEVERITY_RULES: list[tuple[tuple[str, ...], int, str, tuple[int, int, int]]] = [
    # keywords                                   weight  key          BGR colour (matches the page)
    (("crack",),                                     15, "crack",     (77, 72, 229)),    # red     #e5484d
    (("corros", "rust", "oxid"),                     10, "corrosion", (21, 107, 247)),   # orange  #f76b15
    (("fastener", "rivet", "missing", "screw", "bolt"), 8, "fastener", (255, 92, 124)),  # violet  #7c5cff
    (("dent", "deform", "buckl"),                     6, "dent",      (36, 165, 245)),   # amber   #f5a524
    (("paint", "peel", "coating", "chip"),            3, "paint",     (166, 184, 20)),   # teal    #14b8a6
    (("scratch", "abras", "scuff"),                   2, "scratch",   (246, 130, 59)),   # blue    #3b82f6
]
OTHER = (5, "other", (152, 141, 139))


def class_meta(name: str) -> tuple[int, str, tuple[int, int, int]]:
    n = name.lower()
    for keys, weight, key, color in SEVERITY_RULES:
        if any(k in n for k in keys):
            return weight, key, color
    return OTHER


def health_label(score: int) -> str:
    if score >= 80:
        return "Serviceable"
    if score >= 50:
        return "Inspection required"
    return "Engineering review"


# --------------------------------------------------------------------------- frame readers
try:  # reuse the project's threaded latest-frame reader when it is next to this file
    sys.path.insert(0, str(ROOT))
    from live_detect import LatestFrame as UserLatestFrame  # type: ignore
except Exception:  # noqa: BLE001 - any import problem -> built-in reader
    UserLatestFrame = None


class BuiltinLatestFrame:
    """Threaded latest-frame reader (RTSP / webcam / screen region). Drops stale frames."""

    def __init__(self, source: Any):
        self.source = source
        self.frame: Optional[np.ndarray] = None
        self.seq = 0
        self.error: Optional[str] = None
        self.ended = False
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._t = threading.Thread(target=self._run, daemon=True)
        self._t.start()

    def _run(self):
        try:
            if isinstance(self.source, dict):
                self._run_screen(self.source)
            else:
                self._run_capture(self.source)
        except Exception as e:  # noqa: BLE001
            self.error = str(e)

    def _publish(self, frame):
        with self._lock:
            self.frame = frame
            self.seq += 1

    def _run_capture(self, src):
        if isinstance(src, int):
            api = cv2.CAP_DSHOW if platform.system() == "Windows" else cv2.CAP_ANY
            cap = cv2.VideoCapture(src, api)
        else:
            cap = cv2.VideoCapture(src, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        if not cap.isOpened():
            self.error = f"Could not open {src!r}"
            return
        fails = 0
        while not self._stop.is_set():
            ok, frame = cap.read()
            if not ok or frame is None:
                fails += 1
                if fails > 100:
                    self.error = "Video source stopped sending frames"
                    break
                time.sleep(0.02)
                continue
            fails = 0
            self._publish(frame)
        cap.release()

    def _run_screen(self, region):
        import mss  # imported lazily: only needed for screen mirroring

        with mss.mss() as sct:
            while not self._stop.is_set():
                shot = np.asarray(sct.grab(region))
                self._publish(cv2.cvtColor(shot, cv2.COLOR_BGRA2BGR))
                time.sleep(1 / 60)

    def read(self) -> tuple[Optional[np.ndarray], int]:
        with self._lock:
            return self.frame, self.seq

    def stop(self):
        self._stop.set()


class UserReaderAdapter:
    """Duck-typed wrapper around live_detect.LatestFrame (read() may return frame or (ok, frame))."""

    def __init__(self, inner: Any):
        self.inner = inner
        self.error: Optional[str] = None
        self.ended = False
        self._last_id = None
        self.seq = 0
        start = getattr(inner, "start", None)
        if callable(start) and not getattr(inner, "_started", None):
            try:
                start()
            except RuntimeError:
                pass  # already-started thread

    def read(self) -> tuple[Optional[np.ndarray], int]:
        fn = next((getattr(self.inner, n) for n in ("read", "get", "latest") if callable(getattr(self.inner, n, None))), None)
        if fn is None:
            frame = getattr(self.inner, "frame", None)
        else:
            out = fn()
            frame = out[1] if isinstance(out, tuple) and len(out) >= 2 else out
            if isinstance(out, tuple) and len(out) >= 2 and out[0] is False:
                frame = None
        if frame is not None and id(frame) != self._last_id:
            self._last_id = id(frame)
            self.seq += 1
        return frame, self.seq

    def stop(self):
        for n in ("stop", "release", "close"):
            fn = getattr(self.inner, n, None)
            if callable(fn):
                try:
                    fn()
                except Exception:  # noqa: BLE001
                    pass
                return


def wait_first_frame(reader, timeout: float, alive: Callable[[], bool]) -> bool:
    t0 = time.time()
    while time.time() - t0 < timeout and alive():
        if getattr(reader, "error", None):
            return False
        if reader.read()[0] is not None:
            return True
        time.sleep(0.05)
    return False


def open_live_reader(source: Any, alive: Callable[[], bool]):
    """Prefer the project's LatestFrame; fall back to the built-in one if it fails or stays silent."""
    if UserLatestFrame is not None:
        try:
            r = UserReaderAdapter(UserLatestFrame(source))
            if wait_first_frame(r, 6.0, alive):
                return r, "live_detect.LatestFrame"
            r.stop()
        except Exception as e:  # noqa: BLE001
            print(f"[aeroscan] live_detect.LatestFrame failed ({e}); using built-in reader")
    r = BuiltinLatestFrame(source)
    if wait_first_frame(r, CONNECT_TIMEOUT_S, alive):
        return r, "built-in reader"
    err = r.error or "No frames received (check the address / that the drone Wi-Fi is connected)"
    r.stop()
    raise RuntimeError(err)


class RealTimeVideo:
    """Plays a file at wall-clock speed: frames that inference cannot keep up with are skipped."""

    def __init__(self, path: Path):
        self.cap = cv2.VideoCapture(str(path))
        if not self.cap.isOpened():
            raise RuntimeError("Could not open the uploaded video")
        self.fps = self.cap.get(cv2.CAP_PROP_FPS) or 30.0
        if not (1 <= self.fps <= 240):
            self.fps = 30.0
        self.frames = int(self.cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        self.idx = 0
        self.t0: Optional[float] = None
        self.ended = False
        self.error = None
        self.seq = 0

    def read(self) -> tuple[Optional[np.ndarray], int]:
        if self.ended:
            return None, self.seq
        now = time.perf_counter()
        if self.t0 is None:
            self.t0 = now
        target = int((now - self.t0) * self.fps)
        if target < self.idx:  # inference is faster than real time -> wait for the frame's time
            time.sleep((self.idx - target) / self.fps)
            target = self.idx
        while self.idx < target:  # skip frames we are too late for
            if not self.cap.grab():
                self.ended = True
                return None, self.seq
            self.idx += 1
        ok, frame = self.cap.read()
        self.idx += 1
        if not ok:
            self.ended = True
            return None, self.seq
        self.seq += 1
        return frame, self.seq

    @property
    def position_s(self) -> float:
        return self.idx / self.fps

    def stop(self):
        self.cap.release()


# --------------------------------------------------------------------------- engine
@dataclass
class Defect:
    id: str
    cls: str
    conf: float
    size_pct: float
    timestamp: str
    section: str
    track_id: Optional[int]
    source: str
    video_time_s: Optional[float] = None
    snapshot: bytes = field(default=b"", repr=False)

    def public(self) -> dict:
        w, key, _ = class_meta(self.cls)
        return {
            "id": self.id, "class": self.cls, "key": key, "weight": w, "confidence": round(self.conf, 4),
            "size_pct": round(self.size_pct, 3), "timestamp": self.timestamp, "section": self.section,
            "track_id": self.track_id, "source": self.source, "video_time_s": self.video_time_s,
        }


def load_settings() -> dict:
    s = {"confidence": 0.35, "registration": "", "aircraft_type": "", "inspector": ""}
    try:
        s.update(json.loads(SETTINGS_FILE.read_text()))
    except Exception:  # noqa: BLE001
        pass
    return s


class Engine:
    def __init__(self):
        self.lock = threading.RLock()
        self.model = None
        self.image_model = None  # separate instance: plain predict must not inherit tracker callbacks
        self.names: dict[int, str] = {}
        self.device: Any = "cpu"
        self.half = False
        self.model_status = "loading"
        self.model_error: Optional[str] = None

        self.status = "idle"  # idle | connecting | live | finished | error
        self.message = ""
        self.source: dict = {}
        self.fps = 0.0
        self.section = SECTIONS[0]
        self.settings = load_settings()

        self.defects: list[Defect] = []
        self.by_id: dict[str, Defect] = {}
        self.track_map: dict[int, str] = {}
        self.track_hits: dict[int, int] = {}
        self.counter = 0

        self.frame_jpeg: Optional[bytes] = None
        self.frame_seq = 0
        self.frame_size: Optional[tuple[int, int]] = None
        self.version = 0

        self.gen = 0  # bumps on every connect/stop so stale workers exit quietly
        self.reader = None
        threading.Thread(target=self._load_model, daemon=True).start()

    # ---------------------------------------------------------------- model
    def _load_model(self):
        try:
            import torch
            from ultralytics import YOLO

            if not WEIGHTS.exists():
                raise FileNotFoundError(f"Weights not found: {WEIGHTS}")
            if torch.cuda.is_available():
                self.device, self.half = 0, True
            elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                self.device, self.half = "mps", False
            else:
                self.device, self.half = "cpu", False
            m = YOLO(str(WEIGHTS))
            self.names = {int(k): str(v) for k, v in m.names.items()}
            m.predict(np.zeros((IMGSZ, IMGSZ, 3), np.uint8), device=self.device, half=self.half, imgsz=IMGSZ, verbose=False)  # warm-up
            self.model = m
            self.image_model = YOLO(str(WEIGHTS))
            self.model_status = "ready"
            dev = torch.cuda.get_device_name(0) if self.device == 0 else str(self.device)
            print(f"[aeroscan] model ready: {WEIGHTS.name} on {dev} (half={self.half}) classes={list(self.names.values())}")
        except Exception as e:  # noqa: BLE001
            self.model_status, self.model_error = "error", str(e)
            print(f"[aeroscan] model failed to load: {e}")
        self.touch()

    def wait_model(self, alive: Callable[[], bool]) -> bool:
        while self.model_status == "loading" and alive():
            time.sleep(0.1)
        return self.model_status == "ready"

    def reset_tracker(self):
        pred = getattr(self.model, "predictor", None)
        for t in getattr(pred, "trackers", None) or []:
            try:
                t.reset()
            except Exception:  # noqa: BLE001
                pass
        self.track_map.clear()
        self.track_hits.clear()

    # ---------------------------------------------------------------- state helpers
    def touch(self):
        self.version += 1

    def set_status(self, gen: int, status: str, message: str = ""):
        with self.lock:
            if gen != self.gen:
                return
            self.status, self.message = status, message
            self.touch()

    def publish_frame(self, gen: int, frame: np.ndarray):
        h, w = frame.shape[:2]
        if w > STREAM_MAX_W:
            frame = cv2.resize(frame, (STREAM_MAX_W, int(h * STREAM_MAX_W / w)), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        if ok and gen == self.gen:
            self.frame_jpeg = buf.tobytes()
            self.frame_size = (w, h)
            self.frame_seq += 1

    def save_settings(self):
        try:
            SETTINGS_FILE.write_text(json.dumps(self.settings, indent=2))
        except Exception:  # noqa: BLE001
            pass

    # ---------------------------------------------------------------- source control
    def start(self, source: dict, target: Callable[[int, dict], None]):
        with self.lock:
            self._stop_locked(clear_frame=False)
            self.gen += 1
            gen = self.gen
            self.source = source
            self.status, self.message, self.fps = "connecting", "", 0.0
            self.touch()
        threading.Thread(target=self._guard, args=(gen, source, target), daemon=True).start()
        return gen

    def _guard(self, gen, source, target):
        try:
            target(gen, source)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            self.set_status(gen, "error", str(e))

    def _stop_locked(self, clear_frame: bool):
        self.gen += 1
        if self.reader is not None:
            try:
                self.reader.stop()
            except Exception:  # noqa: BLE001
                pass
            self.reader = None
        self.fps = 0.0
        if clear_frame:
            self.frame_jpeg, self.frame_size = None, None
            self.frame_seq += 1

    def stop(self):
        with self.lock:
            was = self.status
            self._stop_locked(clear_frame=False)
            if was in ("connecting", "live"):
                self.status, self.message = "idle", "Stopped"
            self.touch()

    def reset(self):
        with self.lock:
            self.defects.clear()
            self.by_id.clear()
            self.counter = 0
            self.reset_tracker()
            if self.status not in ("connecting", "live"):
                self._stop_locked(clear_frame=True)
                self.status, self.message, self.source = "idle", "", {}
            self.touch()

    def alive(self, gen: int) -> Callable[[], bool]:
        return lambda: gen == self.gen

    # ---------------------------------------------------------------- workers
    def run_live(self, gen: int, source: dict):
        alive = self.alive(gen)
        if not self.wait_model(alive):
            raise RuntimeError(self.model_error or "Model not loaded")
        reader, via = open_live_reader(source["arg"], alive)
        with self.lock:
            if not alive():
                reader.stop()
                return
            self.reader = reader
            self.source["via"] = via
        self._loop(gen, reader, live=True)

    def run_video(self, gen: int, source: dict):
        alive = self.alive(gen)
        if not self.wait_model(alive):
            raise RuntimeError(self.model_error or "Model not loaded")
        reader = RealTimeVideo(Path(source["arg"]))
        with self.lock:
            if not alive():
                reader.stop()
                return
            self.reader = reader
        self._loop(gen, reader, live=False)

    def _loop(self, gen: int, reader, live: bool):
        alive = self.alive(gen)
        with self.lock:
            self.reset_tracker()
        first, last_seq, ema, t_prev = True, -1, 0.0, time.perf_counter()
        while alive():
            frame, seq = reader.read()
            if frame is None or seq == last_seq:
                if getattr(reader, "ended", False):
                    self.set_status(gen, "finished", "End of video")
                    return
                if getattr(reader, "error", None):
                    raise RuntimeError(reader.error)
                time.sleep(0.003)
                continue
            last_seq = seq
            res = self.model.track(
                frame, persist=True, tracker="bytetrack.yaml", conf=float(self.settings["confidence"]),
                half=self.half, device=self.device, imgsz=IMGSZ, verbose=False,
            )[0]
            if not alive():
                return
            vt = None if live else round(reader.position_s, 2)
            self._ingest(res, frame, tracked=True, video_time=vt)
            self.publish_frame(gen, self._draw(frame, res))
            now = time.perf_counter()
            dt, t_prev = now - t_prev, now
            ema = (1 / dt) if ema == 0 else ema * 0.9 + (1 / max(dt, 1e-6)) * 0.1
            self.fps = round(ema, 1)
            if first:
                self.set_status(gen, "live")
                first = False

    def run_image(self, gen: int, source: dict):
        alive = self.alive(gen)
        if not self.wait_model(alive):
            raise RuntimeError(self.model_error or "Model not loaded")
        frame = cv2.imread(str(source["arg"]))
        if frame is None:
            raise RuntimeError("Could not read the uploaded image")
        t0 = time.perf_counter()
        res = self.image_model.predict(
            frame, conf=float(self.settings["confidence"]), half=self.half, device=self.device, imgsz=IMGSZ, verbose=False,
        )[0]
        if not alive():
            return
        self._ingest(res, frame, tracked=False, video_time=None)
        self.publish_frame(gen, self._draw(frame, res))
        self.fps = round(1 / max(time.perf_counter() - t0, 1e-6), 1)
        n = 0 if res.boxes is None else len(res.boxes)
        self.set_status(gen, "finished", f"{n} detection(s) in image")

    # ---------------------------------------------------------------- results
    def _ingest(self, res, frame: np.ndarray, tracked: bool, video_time: Optional[float]):
        boxes = res.boxes
        if boxes is None or len(boxes) == 0:
            return
        xyxy = boxes.xyxy.cpu().numpy()
        confs = boxes.conf.cpu().numpy()
        clss = boxes.cls.cpu().numpy().astype(int)
        ids = boxes.id.cpu().numpy().astype(int) if (tracked and boxes.id is not None) else [None] * len(xyxy)
        h, w = frame.shape[:2]
        with self.lock:
            for (x1, y1, x2, y2), c, k, tid in zip(xyxy, confs, clss, ids):
                if tracked and tid is None:
                    continue
                name = self.names.get(int(k), str(k))
                size = float(max(0, x2 - x1) * max(0, y2 - y1) / (w * h) * 100)
                d = None
                if tid is not None:
                    self.track_hits[tid] = self.track_hits.get(tid, 0) + 1
                    did = self.track_map.get(tid)
                    d = self.by_id.get(did) if did else None
                    if d is None and self.track_hits[tid] < MIN_HITS:
                        continue
                if d is None:
                    self.counter += 1
                    d = Defect(
                        id=f"D{self.counter:03d}", cls=name, conf=0.0, size_pct=size,
                        timestamp=datetime.now().isoformat(timespec="seconds"), section=self.section,
                        track_id=int(tid) if tid is not None else None, source=self.source.get("kind", ""),
                        video_time_s=video_time,
                    )
                    self.defects.append(d)
                    self.by_id[d.id] = d
                    if tid is not None:
                        self.track_map[tid] = d.id
                    self.touch()
                if float(c) > d.conf:  # keep the best frame of this defect
                    d.conf, d.cls, d.size_pct = float(c), name, size
                    d.snapshot = self._crop(frame, x1, y1, x2, y2)
                    self.touch()

    @staticmethod
    def _crop(frame, x1, y1, x2, y2) -> bytes:
        h, w = frame.shape[:2]
        bw, bh = x2 - x1, y2 - y1
        pad = max(24, 0.25 * max(bw, bh))
        a, b = int(max(0, x1 - pad)), int(max(0, y1 - pad))
        c, d = int(min(w, x2 + pad)), int(min(h, y2 + pad))
        crop = frame[b:d, a:c].copy()
        if crop.size == 0:
            crop = frame
        cv2.rectangle(crop, (int(x1 - a), int(y1 - b)), (int(x2 - a), int(y2 - b)), (255, 255, 255), 1, cv2.LINE_AA)
        if crop.shape[1] < 320:  # upscale tiny crops so the card image is not a blur of 3 pixels
            s = 320 / crop.shape[1]
            crop = cv2.resize(crop, None, fx=s, fy=s, interpolation=cv2.INTER_CUBIC)
        ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 90])
        return buf.tobytes() if ok else b""

    def _draw(self, frame: np.ndarray, res) -> np.ndarray:
        img = frame.copy()
        boxes = res.boxes
        if boxes is None or len(boxes) == 0:
            return img
        h, w = img.shape[:2]
        scale = max(0.45, w / 1600)
        th = max(1, int(round(w / 640)))
        ids = boxes.id.cpu().numpy().astype(int) if boxes.id is not None else [None] * len(boxes)
        for (x1, y1, x2, y2), c, k, tid in zip(boxes.xyxy.cpu().numpy().astype(int), boxes.conf.cpu().numpy(), boxes.cls.cpu().numpy().astype(int), ids):
            name = self.names.get(int(k), str(k))
            _, _, color = class_meta(name)
            cv2.rectangle(img, (x1, y1), (x2, y2), color, th + 1, cv2.LINE_AA)
            did = self.track_map.get(tid) if tid is not None else None
            label = f"{did + ' ' if did else ''}{name} {c:.2f}"
            (tw, tht), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, scale, th)
            ty = y1 - 6 if y1 - tht - 10 > 0 else y2 + tht + 10
            cv2.rectangle(img, (x1, ty - tht - 6), (x1 + tw + 10, ty + 4), color, -1, cv2.LINE_AA)
            cv2.putText(img, label, (x1 + 5, ty - 1), cv2.FONT_HERSHEY_SIMPLEX, scale, (255, 255, 255), th, cv2.LINE_AA)
        return img

    # ---------------------------------------------------------------- summary
    def health(self) -> dict:
        score = max(0, 100 - sum(class_meta(d.cls)[0] for d in self.defects))
        return {"score": score, "label": health_label(score), "advisory": True}

    def snapshot(self) -> dict:
        with self.lock:
            defects = [d.public() for d in self.defects]
            counts: dict[str, int] = {}
            by_section = {s: {} for s in SECTIONS}
            for d in self.defects:
                counts[d.cls] = counts.get(d.cls, 0) + 1
                by_section.setdefault(d.section, {})
                by_section[d.section][d.cls] = by_section[d.section].get(d.cls, 0) + 1
            names = list(self.names.values())
            return {
                "status": self.status, "message": self.message, "fps": self.fps,
                "source": {k: v for k, v in self.source.items() if k != "arg"},
                "section": self.section, "sections": SECTIONS,
                "defects": defects, "counts": counts, "by_section": by_section,
                "health": self.health(),
                "classes": [{"name": n, "key": class_meta(n)[1], "weight": class_meta(n)[0]} for n in names],
                "settings": self.settings,
                "has_frame": self.frame_jpeg is not None, "frame_seq": self.frame_seq, "frame_size": self.frame_size,
                "model": {"status": self.model_status, "error": self.model_error, "weights": WEIGHTS.name,
                          "device": "cuda" if self.device == 0 else str(self.device), "half": self.half},
                "version": self.version,
            }


engine = Engine()

# --------------------------------------------------------------------------- API
app = FastAPI(title="AeroScan", docs_url="/api/docs")
app.mount("/static", StaticFiles(directory=STATIC), name="static")


class ConnectBody(BaseModel):
    kind: str  # rtsp | webcam | screen
    value: Optional[str] = None


class SectionBody(BaseModel):
    section: str


class SettingsBody(BaseModel):
    confidence: Optional[float] = None
    registration: Optional[str] = None
    aircraft_type: Optional[str] = None
    inspector: Optional[str] = None


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/api/state")
def state():
    return JSONResponse(engine.snapshot(), headers={"Cache-Control": "no-store"})


@app.post("/api/connect")
def connect(body: ConnectBody):
    kind = body.kind.lower()
    val = (body.value or "").strip()
    if kind == "rtsp":
        url = val or DEFAULT_RTSP
        src = {"kind": "rtsp", "label": "Drone feed", "detail": url, "arg": url}
    elif kind == "webcam":
        idx = int(val) if val.isdigit() else 0
        src = {"kind": "webcam", "label": f"Webcam {idx}", "detail": str(idx), "arg": idx}
    elif kind == "screen":
        nums = [int(float(x)) for x in re.split(r"[,\s]+", val) if x] if val else []
        if len(nums) != 4 or nums[2] <= 0 or nums[3] <= 0:
            raise HTTPException(400, "Screen region must be 'left,top,width,height'")
        region = dict(zip(("left", "top", "width", "height"), nums))
        src = {"kind": "screen", "label": "Screen mirror", "detail": ",".join(map(str, nums)), "arg": region}
    else:
        raise HTTPException(400, f"Unknown source kind {body.kind!r}")
    engine.start(src, engine.run_live)
    return {"status": "connecting", "source": {k: v for k, v in src.items() if k != "arg"}}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    ctype = (file.content_type or "").lower()
    if ext in IMAGE_EXT or ctype.startswith("image/"):
        kind = "image"
    elif ext in VIDEO_EXT or ctype.startswith("video/"):
        kind = "video"
    else:
        raise HTTPException(400, "Upload an image or a video file")
    dest = UPLOADS / f"{uuid.uuid4().hex[:10]}{ext or ('.jpg' if kind == 'image' else '.mp4')}"
    with dest.open("wb") as f:
        while chunk := await file.read(1 << 20):
            f.write(chunk)
    src = {"kind": kind, "label": "Image" if kind == "image" else "Video", "detail": file.filename, "arg": str(dest)}
    engine.start(src, engine.run_image if kind == "image" else engine.run_video)
    return {"status": "connecting", "source": {k: v for k, v in src.items() if k != "arg"}}


@app.post("/api/stop")
def stop():
    engine.stop()
    return {"status": engine.status}


@app.post("/api/section")
def set_section(body: SectionBody):
    if body.section not in SECTIONS:
        raise HTTPException(400, f"Section must be one of {SECTIONS}")
    with engine.lock:
        engine.section = body.section
        engine.touch()
    return {"section": engine.section}


@app.post("/api/settings")
def set_settings(body: SettingsBody):
    with engine.lock:
        for k, v in body.model_dump(exclude_none=True).items():
            if k == "confidence":
                v = float(min(0.95, max(0.05, v)))
            else:
                v = str(v).strip()[:80]
            engine.settings[k] = v
        engine.save_settings()
        engine.touch()
    return engine.settings


@app.post("/api/reset")
def reset():
    engine.reset()
    return {"status": engine.status}


@app.get("/api/snapshot/{defect_id}")
def snapshot(defect_id: str):
    d = engine.by_id.get(defect_id)
    if d is None or not d.snapshot:
        raise HTTPException(404, "No snapshot for that defect")
    return Response(d.snapshot, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/frame.jpg")
def frame():
    if engine.frame_jpeg is None:
        raise HTTPException(404, "No frame yet")
    return Response(engine.frame_jpeg, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


@app.get("/api/stream")
async def stream(request: Request):
    boundary = "frame"

    async def gen():
        last = -1
        while not await request.is_disconnected():
            jpg, seq = engine.frame_jpeg, engine.frame_seq
            if jpg is not None and seq != last:
                last = seq
                yield (f"--{boundary}\r\nContent-Type: image/jpeg\r\nContent-Length: {len(jpg)}\r\n\r\n").encode() + jpg + b"\r\n"
            await asyncio.sleep(0.02)

    return StreamingResponse(gen(), media_type=f"multipart/x-mixed-replace; boundary={boundary}", headers={"Cache-Control": "no-store"})


@app.get("/api/report.csv")
def report():
    s = engine.snapshot()
    st, h = s["settings"], s["health"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["defect_id", "class", "confidence", "size_pct_of_frame", "timestamp", "section", "track_id", "source", "video_time_s",
                "registration", "aircraft_type", "inspector"])
    for d in s["defects"]:
        w.writerow([d["id"], d["class"], f"{d['confidence']:.3f}", f"{d['size_pct']:.3f}", d["timestamp"], d["section"],
                    d["track_id"] if d["track_id"] is not None else "", d["source"], d["video_time_s"] if d["video_time_s"] is not None else "",
                    st.get("registration", ""), st.get("aircraft_type", ""), st.get("inspector", "")])
    w.writerow([])
    w.writerow(["# health_score", h["score"], h["label"], "ADVISORY - not a maintenance release; confirm findings by a qualified inspector"])
    reg = re.sub(r"[^A-Za-z0-9_-]+", "", st.get("registration") or "aircraft") or "aircraft"
    name = f"aeroscan_{reg}_{datetime.now():%Y%m%d_%H%M}.csv"
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}"'})


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("AEROSCAN_PORT", "8000"))
    print(f"[aeroscan] http://localhost:{port}   weights={WEIGHTS}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")
