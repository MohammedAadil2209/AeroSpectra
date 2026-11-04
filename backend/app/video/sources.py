"""Modular video input.

Every source yields BGR frames via `read()` and declares `kind`:
  camera     - real hardware via OpenCV (device index or a *verified* stream URL)
  upload     - a user-uploaded video file (reliable demo fallback)
  simulation - procedurally generated synthetic skin imagery (clearly watermarked)

Elilvendan B2 / WiFi UFO note: the stream protocol of that app is NOT verified.
Do not assume RTSP/HTTP. A practical bridge is Android screen-mirroring
(scrcpy) captured by OBS Virtual Camera, which then appears as a device index.
"""
from __future__ import annotations

import time
from pathlib import Path
from typing import Optional, Tuple, Union

import cv2
import numpy as np

from app.video.synthetic import SyntheticSkinStrip, draw_simulated_watermark


class VideoSourceError(RuntimeError):
    pass


class VideoSource:
    kind = "base"
    fps: float = 25.0
    #: True when frames come from synthetic generation (never real hardware)
    synthetic = False

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


def _open_capture(uri: str, timeout_ms: int = 5000) -> cv2.VideoCapture:
    """Open a device index or URL; URLs get a bounded open/read timeout."""
    target = _parse_uri(uri)
    if isinstance(target, int):
        return cv2.VideoCapture(target)
    return cv2.VideoCapture(
        target,
        cv2.CAP_FFMPEG,
        [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, timeout_ms, cv2.CAP_PROP_READ_TIMEOUT_MSEC, timeout_ms],
    )


class CameraSource(VideoSource):
    kind = "camera"

    def __init__(self, uri: str) -> None:
        self.uri = uri
        self.cap: Optional[cv2.VideoCapture] = None
        self._t0 = 0.0

    def open(self) -> None:
        self.cap = _open_capture(self.uri)
        if not self.cap.isOpened():
            raise VideoSourceError(
                f"Could not open camera source '{self.uri}'. Check the device index or stream URL "
                "(the drone stream protocol must be verified before use)."
            )
        ok, _ = self.cap.read()
        if not ok:
            self.cap.release()
            raise VideoSourceError(f"Camera '{self.uri}' opened but returned no frames.")
        fps = self.cap.get(cv2.CAP_PROP_FPS)
        self.fps = fps if 1 <= fps <= 120 else 25.0
        self._t0 = time.monotonic()

    def read(self):
        assert self.cap is not None
        return self.cap.read()

    def position_s(self) -> float:
        return time.monotonic() - self._t0

    def close(self) -> None:
        if self.cap is not None:
            self.cap.release()

    def describe(self) -> str:
        return f"camera:{self.uri}"


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
            return {"ok": False, "message": f"Could not open '{uri}'."}
        while time.monotonic() - t0 < timeout_s:
            ok, frame = cap.read()
            if ok and frame is not None:
                h, w = frame.shape[:2]
                return {"ok": True, "width": w, "height": h, "message": f"Receiving frames ({w}x{h})."}
        return {"ok": False, "message": "Source opened but delivered no frames before timeout."}
    finally:
        cap.release()
