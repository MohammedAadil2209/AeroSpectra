"""Modular video input.

Every source yields BGR frames via `read()` and declares `kind`:
  camera     - real hardware via OpenCV (device index such as OBS Virtual Camera, or RTSP/HTTP URL)
  upload     - a user-uploaded video file (reliable demo fallback)
  simulation - procedurally generated synthetic skin imagery (clearly watermarked)

Drone stream: RTSP (default rtsp://192.168.1.1:7070/webcam) is opened over UDP first and falls
back to TCP automatically. Alternative bridge: Android screen-mirroring (scrcpy) captured by
OBS Virtual Camera, which then appears as a device index.
"""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from typing import Optional, Tuple, Union

import cv2
import numpy as np

from app.video.synthetic import SyntheticSkinStrip, draw_simulated_watermark

log = logging.getLogger("aerospectra.video")
_FFMPEG_ENV_LOCK = threading.Lock()


class VideoSourceError(RuntimeError):
    pass


class VideoSource:
    kind = "base"
    fps: float = 25.0
    #: True when frames come from synthetic generation (never real hardware)
    synthetic = False
    #: live sources report link state (camera)
    connected = True
    reconnects = 0

    def open(self) -> None:  # pragma: no cover - interface
        raise NotImplementedError

    def read(self) -> Tuple[bool, Optional[np.ndarray]]:  # pragma: no cover
        raise NotImplementedError

    def position_s(self) -> float:
        return 0.0

    def close(self) -> None:
        pass

    def describe(self) -> str:
        return self.kind


def _parse_uri(uri: str) -> Union[int, str]:
    uri = uri.strip()
    return int(uri) if uri.isdigit() else uri


def _open_url(target: str, timeout_ms: int, transport: Optional[str]) -> cv2.VideoCapture:
    with _FFMPEG_ENV_LOCK:  # the FFmpeg options env var is process-global
        opts = "fflags;nobuffer|flags;low_delay"
        if transport:
            opts = f"rtsp_transport;{transport}|" + opts
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = opts
        cap = cv2.VideoCapture(
            target,
            cv2.CAP_FFMPEG,
            [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms, cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms],
        )
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:  # noqa: BLE001
        pass
    return cap


class _Cap:
    """Tiny wrapper so we can remember which RTSP transport worked."""

    def __init__(self, cap: cv2.VideoCapture, transport: str = "") -> None:
        self.cap = cap
        self.transport = transport

    def __getattr__(self, item):
        return getattr(self.cap, item)


def _open_capture(uri: str, timeout_ms: int = 5000) -> _Cap:
    """Open a device index or URL. RTSP tries UDP first, then falls back to TCP automatically."""
    target = _parse_uri(uri)
    if isinstance(target, int):
        cap = cv2.VideoCapture(target, cv2.CAP_DSHOW) if os.name == "nt" else cv2.VideoCapture(target)
        if not cap.isOpened() and os.name == "nt":
            cap = cv2.VideoCapture(target)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:  # noqa: BLE001
            pass
        return _Cap(cap)
    if target.lower().startswith("rtsp"):
        cap = None
        for transport in ("udp", "tcp"):
            cap = _open_url(target, timeout_ms, transport)
            if cap.isOpened():
                ok, _ = cap.read()
                if ok:
                    log.info("RTSP %s opened over %s", target, transport.upper())
                    return _Cap(cap, transport)
            cap.release()
            log.info("RTSP %s: %s failed, trying next transport", target, transport.upper())
        return _Cap(cap)  # type: ignore[arg-type]
    return _Cap(_open_url(target, timeout_ms, None))


class CameraSource(VideoSource):
    """Live camera / drone stream.

    A grabber thread reads continuously and keeps ONLY the newest frame, so a slow consumer never
    builds up lag. If the stream drops, the grabber reconnects with back-off while the inspection
    session stays alive (connected / reconnects are reported to the UI).
    """

    kind = "camera"

    def __init__(self, uri: str) -> None:
        self.uri = uri
        self.cap: Optional[_Cap] = None
        self._t0 = 0.0
        self._lock = threading.Lock()
        self._frame: Optional[np.ndarray] = None
        self._seq = 0
        self._read_seq = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self.connected = False
        self.reconnects = 0
        self.transport = ""

    def open(self) -> None:
        self.cap = _open_capture(self.uri)
        if not self.cap.isOpened():
            raise VideoSourceError(
                f"Could not open camera source '{self.uri}'. Check the device index or stream URL "
                "(RTSP tried UDP and TCP)."
            )
        ok, frame = self.cap.read()
        if not ok:
            self.cap.release()
            raise VideoSourceError(f"Camera '{self.uri}' opened but returned no frames.")
        fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.fps = fps if 1 <= fps <= 120 else 25.0
        self.transport = self.cap.transport
        self._frame, self._seq, self.connected = frame, 1, True
        self._t0 = time.monotonic()
        self._thread = threading.Thread(target=self._grab_loop, name="camera-grabber", daemon=True)
        self._thread.start()

    def _grab_loop(self) -> None:
        fails = 0
        while not self._stop.is_set():
            cap = self.cap
            ok, frame = cap.read() if cap is not None else (False, None)
            if ok and frame is not None:
                fails = 0
                with self._lock:
                    self._frame = frame
                    self._seq += 1
                self.connected = True
                continue
            fails += 1
            if fails < 25:
                time.sleep(0.02)
                continue
            # stream dropped -> reconnect with back-off, keep the session alive
            self.connected = False
            if cap is not None:
                cap.release()
            delay = 1.0
            while not self._stop.is_set():
                log.warning("camera %s dropped; reconnecting", self.uri)
                newcap = _open_capture(self.uri)
                if newcap.isOpened():
                    self.cap = newcap
                    self.transport = newcap.transport or self.transport
                    self.reconnects += 1
                    fails = 0
                    break
                newcap.release()
                self._stop.wait(delay)
                delay = min(5.0, delay * 1.5)

    def read(self):
        """Newest frame only; waits up to 1 s for a new one."""
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline and not self._stop.is_set():
            with self._lock:
                if self._seq != self._read_seq and self._frame is not None:
                    self._read_seq = self._seq
                    return True, self._frame
            time.sleep(0.003)
        return False, None

    def position_s(self) -> float:
        return time.monotonic() - self._t0

    def close(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        if self.cap is not None:
            self.cap.release()

    def describe(self) -> str:
        return f"camera:{self.uri}" + (f" ({self.transport.upper()})" if self.transport else "")


class DroneDirectSource(VideoSource):
    """Direct Wi-Fi video from a cooingdv / RC UFO drone (heartbeat on UDP 7099 + RTSP 7070).

    * The heartbeat starts automatically on open() and stops on close().
    * A grabber thread keeps ONLY the newest frame (stale frames are dropped -> low latency for the AI).
    * If no frame arrives for > STALL_S, the heartbeat is restarted and RTSP reopened with back-off;
      the inspection session stays alive (`connected=False` -> "Reconnecting..." on the feed).
    """

    kind = "drone_direct"
    STALL_S = 2.0

    def __init__(self, ip: Optional[str] = None) -> None:
        from app.video.drone_link import DroneLink

        self.link = DroneLink(ip)
        self.cap: Optional[cv2.VideoCapture] = None
        self._lock = threading.Lock()
        self._frame: Optional[np.ndarray] = None
        self._seq = 0
        self._read_seq = 0
        self._stop = threading.Event()
        self._reopen_now = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._t0 = 0.0
        self.connected = False
        self.reconnects = 0

    def open(self) -> None:
        from app.video.drone_link import DroneError

        self.link.start()
        self.link.wait_for_reply(1.0)
        try:
            cap, info = self.link.open_capture(timeout_ms=2500)
        except DroneError as e:
            self.link.stop()
            raise VideoSourceError(f"Drone not reachable: {e}") from e
        self.cap = cap
        self.fps = info["fps"]
        self._frame, self._seq, self.connected = info["frame"], 1, True
        self._t0 = time.monotonic()
        self._thread = threading.Thread(target=self._grab_loop, name="drone-grabber", daemon=True)
        self._thread.start()

    def _grab_loop(self) -> None:
        from app.video.drone_link import DroneError

        last_ok = time.monotonic()
        while not self._stop.is_set():
            cap = self.cap
            ok, frame = cap.read() if cap is not None else (False, None)
            if ok and frame is not None and not self._reopen_now.is_set():
                with self._lock:
                    self._frame = frame
                    self._seq += 1
                last_ok = time.monotonic()
                self.connected = True
                continue
            if not self._reopen_now.is_set() and time.monotonic() - last_ok < self.STALL_S:
                time.sleep(0.02)
                continue
            # stalled (> 2 s) or lens switch: restart heartbeat + reopen RTSP, keep the session alive
            self.connected = False
            switching = self._reopen_now.is_set()
            self._reopen_now.clear()
            if cap is not None:
                cap.release()
                self.cap = None
            delay = 0.5 if switching else 1.0
            while not self._stop.is_set():
                if not switching:
                    log.warning("drone video stalled; restarting heartbeat and reopening RTSP")
                    self.link.restart()
                try:
                    newcap, _info = self.link.open_capture(timeout_ms=2500)
                    self.cap = newcap
                    self.reconnects += 0 if switching else 1
                    last_ok = time.monotonic()
                    break
                except DroneError as e:
                    log.info("drone reconnect failed: %s", str(e)[:160])
                    switching = False
                    self._stop.wait(delay)
                    delay = min(5.0, delay * 1.5)

    def read(self):
        """Newest frame only; waits up to 1 s for a new one."""
        deadline = time.monotonic() + 1.0
        while time.monotonic() < deadline and not self._stop.is_set():
            with self._lock:
                if self._seq != self._read_seq and self._frame is not None:
                    self._read_seq = self._seq
                    return True, self._frame
            time.sleep(0.003)
        return False, None

    def switch_camera(self, lens: str) -> bool:
        """Front/bottom lens; reopens the stream when the drone needs it (switch mode 2)."""
        reopen = self.link.switch_camera(lens)
        if reopen:
            self._reopen_now.set()
        return reopen

    def position_s(self) -> float:
        return time.monotonic() - self._t0

    def close(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=3)
        if self.cap is not None:
            self.cap.release()
        self.link.stop()

    def describe(self) -> str:
        t = self.link.transport.upper()
        return f"drone:{self.link.ip}" + (f" (RTSP/{t})" if t else "")


class FileSource(VideoSource):
    kind = "upload"

    def __init__(self, path: Path, realtime: bool = True) -> None:
        self.path = path
        self.cap: Optional[cv2.VideoCapture] = None
        self.realtime = realtime

    def open(self) -> None:
        if not self.path.exists():
            raise VideoSourceError(f"Uploaded video not found: {self.path.name}")
        self.cap = cv2.VideoCapture(str(self.path))
        if not self.cap.isOpened():
            raise VideoSourceError(f"OpenCV could not decode '{self.path.name}'. Try MP4 (H.264).")
        fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.fps = fps if 1 <= fps <= 120 else 25.0

    def read(self):
        assert self.cap is not None
        return self.cap.read()

    def position_s(self) -> float:
        assert self.cap is not None
        return self.cap.get(cv2.CAP_PROP_POS_MSEC) / 1000.0

    def close(self) -> None:
        if self.cap is not None:
            self.cap.release()

    def describe(self) -> str:
        return f"upload:{self.path.name}"


class SimulatedSource(VideoSource):
    """Synthetic drone pass along a fuselage panel. Loops with fresh defects each pass."""

    kind = "simulation"
    synthetic = True

    def __init__(self, fps: float = 25.0, speed_px_s: float = 260.0, seed: Optional[int] = None) -> None:
        self.fps = fps
        self.speed = speed_px_s
        self.seed = seed
        self.strip: Optional[SyntheticSkinStrip] = None
        self.offset = 0.0
        self.t = 0.0
        self.pass_index = 0

    def open(self) -> None:
        self._new_strip()

    def _new_strip(self) -> None:
        seed = None if self.seed is None else self.seed + self.pass_index
        self.strip = SyntheticSkinStrip(seed=seed)
        self.offset = 0.0

    def read(self):
        assert self.strip is not None
        dt = 1.0 / self.fps
        self.t += dt
        self.offset += self.speed * dt
        if self.offset >= self.strip.max_offset:
            self.pass_index += 1
            self._new_strip()
        frame = self.strip.frame_at(self.offset, self.t)
        return True, frame

    def position_s(self) -> float:
        return self.t

    def ground_truth(self):
        assert self.strip is not None
        return [(self.pass_index, d, box) for d, box in self.strip.visible_defects(self.offset)]

    @staticmethod
    def watermark(frame: np.ndarray) -> None:
        draw_simulated_watermark(frame)


def probe_video(path: Path) -> dict:
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        raise VideoSourceError("OpenCV could not open this file. Use MP4/H.264, MOV or AVI.")
    frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 0) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    ok, _ = cap.read()
    cap.release()
    if not ok:
        raise VideoSourceError("File opened but no frames could be decoded.")
    return {"frames": frames, "fps": fps, "width": w, "height": h, "duration_s": frames / fps if fps else 0}


def test_camera(uri: str, timeout_s: float = 6.0) -> dict:
    cap = _open_capture(uri)
    t0 = time.monotonic()
    try:
        if not cap.isOpened():
            extra = " (tried RTSP over UDP and TCP)" if uri.strip().lower().startswith("rtsp") else ""
            return {"ok": False, "message": f"Could not open '{uri}'{extra}."}
        while time.monotonic() - t0 < timeout_s:
            ok, frame = cap.read()
            if ok and frame is not None:
                h, w = frame.shape[:2]
                via = f" via RTSP/{cap.transport.upper()}" if cap.transport else ""
                return {"ok": True, "width": w, "height": h, "message": f"Receiving frames ({w}x{h}){via}."}
        return {"ok": False, "message": "Source opened but delivered no frames before timeout."}
    finally:
        cap.release()
