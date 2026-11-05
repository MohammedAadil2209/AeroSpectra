"""Inspection runner: one active inspection at a time (one drone).

Worker thread pipeline per frame:
  source.read() -> resize -> detector (every Nth frame) -> dedupe -> persist evidence + DB
  -> annotate -> optional recording -> JPEG for MJPEG stream -> WebSocket events
"""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np

from app.config import (
    EVIDENCE_DIR,
    RECORDING_DIR,
    STREAM_JPEG_QUALITY,
    UPLOAD_DIR,
)
from app.database import repository as repo
from app.database.session import session_scope
from app.detection.annotate import draw_detections, draw_hud
from app.detection.detectors import Detector, RawDetection, ai_config, models
from app.services import risk as risk_engine
from app.services.events import kpi, publish
from app.services.settings_store import get_value
from app.services.triage import triage_priority
from app.video.sources import (
    CameraSource,
    DroneDirectSource,
    FileSource,
    SimulatedSource,
    VideoSource,
    VideoSourceError,
)
from app.websocket.manager import ws_manager

log = logging.getLogger("aerospectra.runner")
MAX_W = 1280
SIM_UNWATCHED_TIMEOUT_S = 30.0
SOURCE_LABELS = {"camera": "LIVE CAMERA", "upload": "UPLOADED VIDEO", "simulation": "SIMULATION", "drone_direct": "DRONE (WI-FI)"}
# live sources: reconnect without ending the session, never "end of video"
LIVE_KINDS = ("camera", "drone_direct")


class InspectionConflict(RuntimeError):
    pass


def _iou(a: Tuple[float, float, float, float], b: Tuple[float, float, float, float]) -> float:
    ax0, ay0, aw, ah = a
    bx0, by0, bw, bh = b
    ix = max(0.0, min(ax0 + aw, bx0 + bw) - max(ax0, bx0))
    iy = max(0.0, min(ay0 + ah, by0 + bh) - max(ay0, by0))
    inter = ix * iy
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


@dataclass
class Session:
    inspection_id: str
    aircraft_id: str
    source: VideoSource
    detector: Detector
    is_demo: bool
    stop_event: threading.Event = field(default_factory=threading.Event)
    paused: bool = False
    recording: bool = False
    writer: Optional[cv2.VideoWriter] = None
    recording_url: Optional[str] = None
    recording_segment: int = 0
    frames: int = 0
    detections: int = 0
    active_time: float = 0.0
    current_section: str = "Unassigned"
    sections: List[str] = field(default_factory=list)
    seen_keys: set = field(default_factory=set)
    recent: List[Tuple[str, Tuple[float, float, float, float], float]] = field(default_factory=list)
    last_dets: List[RawDetection] = field(default_factory=list)
    # temporal confirmation tracks: [category, box, hits, last_seen_monotonic]
    tracks: List[list] = field(default_factory=list)
    stop_reason: str = "user"
    status: str = "active"
    error: Optional[str] = None
    thread: Optional[threading.Thread] = None
    started_at: datetime = field(default_factory=datetime.utcnow)
    source_fps: float = 0.0
    risk_counts: Dict[str, int] = field(default_factory=lambda: {"low": 0, "medium": 0, "high": 0, "critical": 0})
    cost_min: float = 0.0
    cost_max: float = 0.0


class InspectionRunner:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.session: Optional[Session] = None
        self._frame_cond = threading.Condition()
        self._jpeg: Optional[bytes] = None
        self._jpeg_seq = 0

    # ------------------------------------------------------------ public API
    @property
    def active_id(self) -> Optional[str]:
        s = self.session
        return s.inspection_id if s and not s.stop_event.is_set() else None

    def snapshot(self) -> Optional[dict]:
        s = self.session
        if not s or s.stop_event.is_set():
            return None
        return {
            "inspection_id": s.inspection_id,
            "aircraft_id": s.aircraft_id,
            "source": s.source.kind,
            "detection_mode": s.detector.mode,
            "detector": s.detector.name,
            "status": "paused" if s.paused else "active",
            "recording": s.recording,
            "frames": s.frames,
            "detections": s.detections,
            "elapsed_s": round(s.active_time, 1),
            "section": s.current_section,
            "is_demo": s.is_demo,
            "started_at": s.started_at,
            "source_fps": round(s.source_fps, 1),
            "inference_fps": getattr(s.detector, "fps", 0.0),
            "connected": s.source.connected,
            "reconnects": s.source.reconnects,
            "risk_counts": dict(s.risk_counts),
            "cost_min": round(s.cost_min),
            "cost_max": round(s.cost_max),
        }

    def start(
        self,
        aircraft_id: str,
        source_kind: str,
        camera_uri: Optional[str],
        upload_id: Optional[str],
        record: bool,
        notes: str,
    ) -> str:
        with self._lock:
            if self.active_id:
                raise InspectionConflict(f"Inspection {self.active_id} is already running. Stop it first.")
            source = self._make_source(source_kind, camera_uri, upload_id)
            source.open()  # raises VideoSourceError with a clear message
            detector = models.detector_for(source_kind)
            is_demo = source_kind == "simulation"
            with session_scope() as db:
                aircraft = repo.get_aircraft(db, aircraft_id)
                if aircraft is None:
                    source.close()
                    raise ValueError(f"Unknown aircraft '{aircraft_id}'.")
                if aircraft.is_demo != is_demo:
                    source.close()
                    raise ValueError(
                        "Simulation inspections are demonstration records and must use a DEMO aircraft; "
                        "camera/upload inspections must use a registered (real) aircraft."
                    )
                insp = repo.create_inspection(
                    db,
                    aircraft_id=aircraft_id,
                    source=source_kind,
                    source_detail=source.describe(),
                    status="active",
                    detection_mode=detector.mode,
                    notes=notes,
                    is_demo=is_demo,
                    sections_inspected=[],
                )
                inspection_id = insp.id
                payload = repo.inspection_payload(db, insp)
            s = Session(inspection_id, aircraft_id, source, detector, is_demo)
            s.started_at = payload["started_at"]
            self.session = s
            if record:
                self._start_writer(s, None)
            s.thread = threading.Thread(target=self._run, args=(s,), name=f"insp-{inspection_id}", daemon=True)
            s.thread.start()
        publish("inspection.started", {"inspection": payload, "detector": detector.name, "active": self.snapshot()})
        kpi.touch(is_demo)
        return inspection_id

    def stop(self, reason: str = "user") -> Optional[str]:
        s = self.session
        if not s or s.stop_event.is_set():
            return None
        s.stop_reason = reason
        s.stop_event.set()
        if s.thread and s.thread is not threading.current_thread():
            s.thread.join(timeout=5)
        return s.inspection_id

    def pause(self) -> bool:
        s = self.session
        if not self.active_id or s is None:
            return False
        s.paused = True
        publish("inspection.updated", {"inspection_id": s.inspection_id, "status": "paused"})
        return True

    def resume(self) -> bool:
        s = self.session
        if not self.active_id or s is None:
            return False
        s.paused = False
        publish("inspection.updated", {"inspection_id": s.inspection_id, "status": "active"})
        return True

    def set_recording(self, on: bool) -> dict:
        s = self.session
        if not self.active_id or s is None:
            raise InspectionConflict("No active inspection.")
        if on and not s.recording:
            s.recording = True  # writer created lazily on next frame (needs frame size)
        elif not on and s.recording:
            s.recording = False
            self._close_writer(s)
        publish(
            "recording.status",
            {"inspection_id": s.inspection_id, "recording": s.recording, "recording_url": s.recording_url},
        )
        return {"recording": s.recording, "recording_url": s.recording_url}

    def drone_source(self) -> Optional[DroneDirectSource]:
        """The running direct-drone source, if any (for status / lens switching)."""
        s = self.session
        if s and not s.stop_event.is_set() and isinstance(s.source, DroneDirectSource):
            return s.source
        return None

    def set_section(self, section: str) -> None:
        s = self.session
        if s and section:
            s.current_section = section[:48]
            if section not in s.sections and section != "Unassigned":
                s.sections.append(section[:48])

    def wait_frame(self, last_seq: int, timeout: float = 2.0) -> Tuple[int, Optional[bytes]]:
        with self._frame_cond:
            if self._jpeg_seq == last_seq:
                self._frame_cond.wait(timeout)
            return self._jpeg_seq, self._jpeg

    # ------------------------------------------------------------ internals
    @staticmethod
    def _make_source(kind: str, camera_uri: Optional[str], upload_id: Optional[str]) -> VideoSource:
        if kind == "camera":
            if not camera_uri:
                raise VideoSourceError("No camera URI configured.")
            return CameraSource(camera_uri)
        if kind == "upload":
            if not upload_id:
                raise VideoSourceError("No uploaded video selected.")
            matches = list(UPLOAD_DIR.glob(f"{upload_id}.*"))
            if not matches:
                raise VideoSourceError(f"Upload '{upload_id}' not found.")
            return FileSource(matches[0])
        if kind == "simulation":
            return SimulatedSource()
        if kind == "drone_direct":
            # camera_uri carries the drone IP ("" / "auto" -> auto-detect 192.168.1.1 / Wi-Fi gateway)
            return DroneDirectSource(camera_uri or None)
        raise VideoSourceError(f"Unknown source '{kind}'.")

    def _start_writer(self, s: Session, frame: Optional[np.ndarray]) -> None:
        s.recording = True
        if frame is None:
            return
        h, w = frame.shape[:2]
        s.recording_segment += 1
        name = f"{s.inspection_id}-{s.recording_segment}.mp4"
        path = RECORDING_DIR / name
        for codec in ("avc1", "mp4v"):
            writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*codec), s.source.fps, (w, h))
            if writer.isOpened():
                s.writer = writer
                s.recording_url = f"/recordings/{name}"
                return
        log.warning("Could not open a VideoWriter; recording disabled")
        s.recording = False

    @staticmethod
    def _close_writer(s: Session) -> None:
        if s.writer is not None:
            s.writer.release()
            s.writer = None

    def _publish(self, frame: np.ndarray) -> None:
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, STREAM_JPEG_QUALITY])
        if not ok:
            return
        with self._frame_cond:
            self._jpeg = buf.tobytes()
            self._jpeg_seq += 1
            self._frame_cond.notify_all()

    @staticmethod
    def _confirm(s: Session, dets: List[RawDetection], now: float, max_gap: float = 1.5) -> List[RawDetection]:
        """Return only detections matched (same class, IoU > 0.3) in >= confirm_hits consecutive inferences."""
        need = max(1, ai_config.confirm_hits)
        s.tracks = [t for t in s.tracks if now - t[3] <= max_gap]
        confirmed: List[RawDetection] = []
        used = set()
        for d in dets:
            box = (d.x, d.y, d.w, d.h)
            best, best_iou = None, 0.3
            for i, t in enumerate(s.tracks):
                if i in used or t[0] != d.category:
                    continue
                iou = _iou(box, t[1])
                if iou > best_iou:
                    best, best_iou = i, iou
            if best is None:
                s.tracks.append([d.category, box, 1, now])
                used.add(len(s.tracks) - 1)
                hits = 1
            else:
                t = s.tracks[best]
                t[1], t[2], t[3] = box, t[2] + 1, now
                used.add(best)
                hits = t[2]
            if hits >= need:
                confirmed.append(d)
        return confirmed

    def _is_new(self, s: Session, d: RawDetection, t: float) -> bool:
        if d.track_key is not None:
            if d.track_key in s.seen_keys:
                return False
            s.seen_keys.add(d.track_key)
            return True
        box = (d.x, d.y, d.w, d.h)
        s.recent = [r for r in s.recent if t - r[2] < 4.0]
        for i, (cat, rbox, _) in enumerate(s.recent):
            if cat == d.category and _iou(box, rbox) > 0.3:
                s.recent[i] = (cat, box, t)
                return False
        s.recent.append((d.category, box, t))
        return True

    def _persist(self, s: Session, d: RawDetection, frame: np.ndarray, t: float) -> None:
        h, w = frame.shape[:2]
        det_id = repo.new_id("DET")
        scale = min(1.0, 960 / w)
        ev = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1 else frame
        cv2.imwrite(str(EVIDENCE_DIR / f"{det_id}.jpg"), ev, [cv2.IMWRITE_JPEG_QUALITY, 88])
        bbox = {
            "x": round(max(0.0, d.x / w), 4),
            "y": round(max(0.0, d.y / h), 4),
            "w": round(min(1.0, d.w / w), 4),
            "h": round(min(1.0, d.h / h), 4),
            "frame_w": w,
            "frame_h": h,
        }
        # thumbnail crop (padded) for the live AI record feed
        pad = 0.35
        cx0 = int(max(0, d.x - d.w * pad)); cy0 = int(max(0, d.y - d.h * pad))
        cx1 = int(min(w, d.x + d.w * (1 + pad))); cy1 = int(min(h, d.y + d.h * (1 + pad)))
        thumb_url = None
        if cx1 - cx0 > 4 and cy1 - cy0 > 4:
            crop = frame[cy0:cy1, cx0:cx1]
            ts = 220 / max(crop.shape[:2])
            crop = cv2.resize(crop, (max(1, int(crop.shape[1] * ts)), max(1, int(crop.shape[0] * ts))))
            cv2.imwrite(str(EVIDENCE_DIR / f"{det_id}_thumb.jpg"), crop, [cv2.IMWRITE_JPEG_QUALITY, 85])
            thumb_url = f"/evidence/{det_id}_thumb.jpg"
        with session_scope() as db:
            det = repo.add_detection(
                db,
                thumb_url=thumb_url,
                maintenance_status="detected",
                id=det_id,
                inspection_id=s.inspection_id,
                aircraft_id=s.aircraft_id,
                category=d.category,
                confidence=round(d.confidence, 4),
                detected_at=datetime.utcnow(),
                video_time_s=round(t, 2),
                bbox=bbox,
                section=s.current_section,
                priority=triage_priority(d.category, d.confidence),
                evidence_url=f"/evidence/{det_id}.jpg",
                origin=d.origin,
                model_name=s.detector.name,
                review_status="pending",
                reviewer_notes="",
                is_demo=s.is_demo,
            )
            repo.score_detection(db, det)
            db.flush()
            payload = repo.detection_payload(det)
        s.detections += 1
        s.risk_counts[payload["risk_level"]] = s.risk_counts.get(payload["risk_level"], 0) + 1
        s.cost_min += payload["cost_min"]
        s.cost_max += payload["cost_max"]
        d.extra["risk_level"] = payload["risk_level"]
        publish("detection.created", {"detection": payload})
        publish("inspection.updated", self._progress(s))
        kpi.touch(s.is_demo)

    def _progress(self, s: Session) -> dict:
        return {
            "inspection_id": s.inspection_id,
            "status": "paused" if s.paused else "active",
            "detection_count": s.detections,
            "duration_s": round(s.active_time, 1),
            "frames_processed": s.frames,
            "sections_inspected": list(s.sections),
            "risk_counts": dict(s.risk_counts),
            "cost_min": round(s.cost_min),
            "cost_max": round(s.cost_max),
        }

    def _run(self, s: Session) -> None:
        src = s.source
        interval = 1.0 / (src.fps or 25.0)
        paced = src.kind in ("upload", "simulation")
        label = SOURCE_LABELS[src.kind]
        last_tick = time.monotonic()
        last_meta = 0.0
        last_frame: Optional[np.ndarray] = None
        consecutive_fail = 0
        fps_times: List[float] = []
        last_progress = 0.0
        risk_cfg = get_value_safe("risk")
        unwatched_since: Optional[float] = None
        try:
            while not s.stop_event.is_set():
                loop_start = time.monotonic()
                # Safety: simulation sessions end when nobody is watching (closed browser tab).
                if src.kind == "simulation":
                    if ws_manager.clients:
                        unwatched_since = None
                    elif unwatched_since is None:
                        unwatched_since = loop_start
                    elif loop_start - unwatched_since > SIM_UNWATCHED_TIMEOUT_S:
                        s.stop_reason = "no_viewers"
                        break
                if s.paused:
                    if last_frame is not None:
                        f = last_frame.copy()
                        draw_hud(f, s.inspection_id, label, s.recording, True)
                        self._publish(f)
                    time.sleep(0.2)
                    last_tick = time.monotonic()
                    continue

                ok, frame = src.read()
                if not ok or frame is None:
                    if src.kind == "upload":
                        s.stop_reason = "end_of_video"
                        break
                    if src.kind in LIVE_KINDS:
                        # Live link dropped: the grabber reconnects; keep the session alive and tell the UI.
                        now_m = time.monotonic()
                        if last_frame is not None and now_m - last_meta > 0.5:
                            last_meta = now_m
                            f = last_frame.copy()
                            cv2.rectangle(f, (0, 0), (f.shape[1], 40), (0, 0, 0), -1)
                            cv2.putText(f, "SIGNAL LOST - RECONNECTING...", (12, 28), cv2.FONT_HERSHEY_SIMPLEX, 0.8,
                                        (0, 200, 255), 2, cv2.LINE_AA)
                            self._publish(f)
                            publish("frame", {**self._frame_meta(s, src, 0.0), "connected": False})
                        last_tick = time.monotonic()  # do not count dead air as inspection time
                        continue
                    consecutive_fail += 1
                    if consecutive_fail > 50:
                        raise VideoSourceError("Video source stopped delivering frames.")
                    time.sleep(0.05)
                    continue
                consecutive_fail = 0
                fps_times.append(time.monotonic())
                if len(fps_times) > 30:
                    fps_times.pop(0)
                if len(fps_times) > 1 and fps_times[-1] > fps_times[0]:
                    s.source_fps = (len(fps_times) - 1) / (fps_times[-1] - fps_times[0])

                h, w = frame.shape[:2]
                if w > MAX_W:
                    frame = cv2.resize(frame, (MAX_W, int(h * MAX_W / w)))
                s.frames += 1
                now = time.monotonic()
                s.active_time += now - last_tick
                last_tick = now
                t_video = src.position_s()

                every = max(1, ai_config.infer_every)
                run_infer = src.kind == "simulation" or s.frames % every == 1 or every == 1
                if run_infer:
                    ctx = {"ground_truth": src.ground_truth()} if isinstance(src, SimulatedSource) else None
                    try:
                        dets = s.detector.detect(frame, ctx)
                        dets = [d for d in dets if d.confidence >= ai_config.confidence]
                        # AI detections must persist across consecutive inferences before they are shown or
                        # recorded (kills one-frame flicker false alarms). Simulated ground truth is exempt.
                        s.last_dets = dets if src.kind == "simulation" else self._confirm(s, dets, time.monotonic())
                    except Exception as e:  # noqa: BLE001
                        log.exception("detector failed")
                        publish("error", {"message": f"Detector error: {e}"})
                        s.last_dets = []
                    fh, fw = frame.shape[:2]
                    for d in s.last_dets:
                        # quick (context-free) risk level for the on-frame label; persisted ones get the full score
                        if "risk_level" not in d.extra:
                            d.extra["risk_level"] = risk_engine.score_detection(
                                {"category": d.category, "confidence": d.confidence, "section": s.current_section,
                                 "bbox": {"w": d.w / fw, "h": d.h / fh}}, risk_cfg)["level"]
                        if self._is_new(s, d, t_video):
                            self._persist(s, d, frame, t_video)

                annotated = frame.copy()
                draw_detections(annotated, s.last_dets)
                draw_hud(annotated, s.inspection_id, label, s.recording, False)
                if src.synthetic:
                    SimulatedSource.watermark(annotated)
                last_frame = frame

                if s.recording:
                    if s.writer is None:
                        self._start_writer(s, annotated)
                        publish(
                            "recording.status",
                            {"inspection_id": s.inspection_id, "recording": s.recording, "recording_url": s.recording_url},
                        )
                    if s.writer is not None:
                        s.writer.write(annotated)

                self._publish(annotated)

                if now - last_meta > 0.5:
                    last_meta = now
                    publish("frame", self._frame_meta(s, src, t_video))
                if now - last_progress > 1.0:
                    last_progress = now
                    with session_scope() as db:
                        repo.update_inspection_progress(
                            db, s.inspection_id, frames_processed=s.frames, duration_s=round(s.active_time, 1),
                            sections_inspected=list(s.sections),
                        )
                    publish("inspection.updated", self._progress(s))

                if paced:
                    spent = time.monotonic() - loop_start
                    if spent < interval:
                        time.sleep(interval - spent)
            if s.stop_reason == "shutdown":
                s.status, s.error = "aborted", "Backend shut down while the inspection was running."
            elif s.stop_reason == "no_viewers":
                s.status, s.error = "aborted", f"Simulation stopped: no dashboard connected for {SIM_UNWATCHED_TIMEOUT_S:.0f} s."
            else:
                s.status = "completed"
        except Exception as e:  # noqa: BLE001
            log.exception("inspection failed")
            s.status = "failed"
            s.error = str(e)
        finally:
            src.close()
            self._close_writer(s)
            s.recording = False
            s.stop_event.set()
            with session_scope() as db:
                repo.finish_inspection(
                    db,
                    s.inspection_id,
                    status=s.status,
                    duration_s=s.active_time,
                    frames=s.frames,
                    sections=s.sections,
                    recording_url=s.recording_url,
                    error=s.error,
                )
            inspection = None
            try:
                with session_scope() as db:
                    insp = repo.get_inspection(db, s.inspection_id)
                    inspection = repo.inspection_payload(db, insp) if insp else None
            except Exception:  # noqa: BLE001
                log.exception("could not load finished inspection")
            publish(
                "inspection.ended",
                {
                    "inspection_id": s.inspection_id,
                    "status": s.status,
                    "reason": s.stop_reason,
                    "error": s.error,
                    "detections": s.detections,
                    "inspection": inspection,
                },
            )
            kpi.touch(s.is_demo)

    @staticmethod
    def _frame_meta(s: Session, src: VideoSource, t_video: float) -> dict:
        return {
            "inspection_id": s.inspection_id,
            "frame": s.frames,
            "video_time_s": round(t_video, 2),
            "elapsed_s": round(s.active_time, 1),
            "fps": round(s.source_fps or src.fps, 1),
            "inference_fps": getattr(s.detector, "fps", 0.0),
            "inference_ms": getattr(s.detector, "last_ms", 0.0),
            "detections": s.detections,
            "section": s.current_section,
            "connected": src.connected,
            "reconnects": src.reconnects,
            "risk_counts": dict(s.risk_counts),
            "cost_min": round(s.cost_min),
            "cost_max": round(s.cost_max),
        }


runner = InspectionRunner()


def get_value_safe(key: str) -> dict:
    try:
        with session_scope() as db:
            return get_value(db, key)
    except Exception:  # noqa: BLE001
        from app.services.risk import DEFAULT_RISK_CONFIG

        return DEFAULT_RISK_CONFIG
