"""Defect detectors.

YoloDetector       - real inference with Ultralytics YOLO. Only active when the weights
                     file exists AND loads. Never faked.
SimulatedDetector  - emits ground-truth boxes for synthetic defects painted by
                     SimulatedSource. Results are tagged origin="simulated".
NullDetector       - no model available: frames are streamed, nothing is detected.
"""
from __future__ import annotations

import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from app.config import (
    CONFIRM_HITS,
    INFERENCE_EVERY_N_FRAMES,
    MODEL_CARD_PATH,
    SCENE_GATE,
    SCENE_GATE_PATH,
    YOLO_CLASS_MAP,
    YOLO_CONFIDENCE,
    YOLO_DEVICE,
    YOLO_MODEL_PATH,
)

log = logging.getLogger("aerospectra.detection")


@dataclass
class RawDetection:
    category: str
    confidence: float
    # pixel box in frame coordinates
    x: float
    y: float
    w: float
    h: float
    origin: str = "ai"
    track_key: Optional[str] = None  # stable identity if known (simulation)
    extra: dict = field(default_factory=dict)


class RuntimeAIConfig:
    """Live-tunable inference settings (applied to the running pipeline immediately)."""

    def __init__(self) -> None:
        self.confidence = YOLO_CONFIDENCE
        self.infer_every = max(1, INFERENCE_EVERY_N_FRAMES)
        self.scene_gate = SCENE_GATE
        self.confirm_hits = max(1, CONFIRM_HITS)

    def as_dict(self) -> dict:
        return {"confidence": round(self.confidence, 3), "infer_every": self.infer_every,
                "scene_gate": self.scene_gate, "confirm_hits": self.confirm_hits}


ai_config = RuntimeAIConfig()


class Detector:
    mode = "none"  # ai | simulated | none
    name = "none"

    def detect(self, frame: np.ndarray, context: Optional[dict] = None) -> List[RawDetection]:
        return []


class NullDetector(Detector):
    mode = "none"
    name = "No model loaded"


class SimulatedDetector(Detector):
    mode = "simulated"
    name = "Simulated ground truth (no AI model)"

    def detect(self, frame, context=None):
        out: List[RawDetection] = []
        for pass_idx, d, (x, y, w, h) in (context or {}).get("ground_truth", []):
            out.append(
                RawDetection(
                    category=d.category,
                    confidence=d.confidence,
                    x=x, y=y, w=w, h=h,
                    origin="simulated",
                    track_key=f"{pass_idx}:{d.uid}",
                )
            )
        return out


class YoloDetector(Detector):
    mode = "ai"

    def __init__(self, model, device: str, half: bool, device_name: str) -> None:
        self.model = model
        self.name = f"YOLO ({YOLO_MODEL_PATH.name})"
        self.device, self.half, self.device_name = device, half, device_name
        self._lock = threading.Lock()
        names = getattr(model, "names", {}) or {}
        self.class_names = {int(k): str(v).lower() for k, v in dict(names).items()}
        self.last_ms = 0.0
        self._times: list = []
        self.gate: Optional["SceneGate"] = None

    @property
    def fps(self) -> float:
        """Inference throughput (model calls/s) over the last ~30 calls."""
        if len(self._times) < 2:
            return 0.0
        span = self._times[-1] - self._times[0]
        return round((len(self._times) - 1) / span, 1) if span > 0 else 0.0

    def detect(self, frame, context=None):
        t0 = time.perf_counter()
        with self._lock:
            results = self.model.predict(frame, conf=ai_config.confidence, verbose=False,
                                         device=self.device, half=self.half, imgsz=640)
        self.last_ms = round((time.perf_counter() - t0) * 1000, 1)
        self._times = (self._times + [time.monotonic()])[-30:]
        out: List[RawDetection] = []
        for r in results:
            boxes = getattr(r, "boxes", None)
            if boxes is None:
                continue
            for xyxy, conf, cls in zip(boxes.xyxy.cpu().numpy(), boxes.conf.cpu().numpy(), boxes.cls.cpu().numpy()):
                cat = YOLO_CLASS_MAP.get(self.class_names.get(int(cls), ""))
                if not cat:
                    continue
                x0, y0, x1, y1 = [float(v) for v in xyxy]
                out.append(RawDetection(cat, float(conf), x0, y0, x1 - x0, y1 - y0, origin="ai"))
        if out and self.gate is not None and ai_config.scene_gate:
            out = self.gate.filter(frame, out, self.device, self.half)
        return out


class SceneGate:
    """Suppresses 'defects' that sit on people or everyday objects (faces, hands, clothing, phones, chairs...).

    Runs a COCO-pretrained YOLO (backend/models/coco-gate.pt). A defect box is dropped when it overlaps a
    detected non-aircraft object by >= 35 % of its own area, or its centre lies inside that object.
    Aircraft (COCO 'airplane') never suppress anything.
    """

    AIRPLANE = 4

    def __init__(self, model) -> None:
        self.model = model
        self.suppressed = 0
        self.last_objects: List[str] = []
        self._lock = threading.Lock()
        names = getattr(model, "names", {}) or {}
        self.names = {int(k): str(v) for k, v in dict(names).items()}

    def filter(self, frame, dets: List[RawDetection], device: str, half: bool) -> List[RawDetection]:
        with self._lock:
            r = self.model.predict(frame, conf=0.30, verbose=False, device=device, half=half, imgsz=640)[0]
        objs = []
        for xyxy, cls in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.cls.cpu().numpy()):
            if int(cls) != self.AIRPLANE:
                objs.append(([float(v) for v in xyxy], self.names.get(int(cls), str(int(cls)))))
        self.last_objects = sorted({n for _, n in objs})
        if not objs:
            return dets
        keep: List[RawDetection] = []
        for d in dets:
            cx, cy = d.x + d.w / 2, d.y + d.h / 2
            area = max(1.0, d.w * d.h)
            hit = None
            for (x0, y0, x1, y1), name in objs:
                ix = max(0.0, min(d.x + d.w, x1) - max(d.x, x0))
                iy = max(0.0, min(d.y + d.h, y1) - max(d.y, y0))
                if (ix * iy) / area >= 0.35 or (x0 <= cx <= x1 and y0 <= cy <= y1):
                    hit = name
                    break
            if hit is None:
                keep.append(d)
            else:
                self.suppressed += 1
        return keep


class ModelRegistry:
    """Loads the YOLO model once, lazily, and reports honest status."""

    def __init__(self) -> None:
        self._yolo: Optional[YoloDetector] = None
        self.status = "not_configured"
        self.detail = ""
        self._attempted = False
        self._lock = threading.Lock()

    def load(self) -> None:
        with self._lock:
            if self._attempted:
                return
            self._attempted = True
            if not YOLO_MODEL_PATH.exists():
                self.status = "not_configured"
                self.detail = (
                    f"No model weights at backend/models/{YOLO_MODEL_PATH.name}. "
                    "AI inference is disabled; simulation mode uses synthetic ground truth."
                )
                return
            try:
                from ultralytics import YOLO  # type: ignore
            except Exception:  # noqa: BLE001
                self.status = "unavailable"
                self.detail = "Weights found but 'ultralytics' is not installed (pip install -r requirements-ai.txt)."
                return
            try:
                device, half, device_name = _pick_device()
                model = YOLO(str(YOLO_MODEL_PATH))
                self._yolo = YoloDetector(model, device, half, device_name)
                try:  # warm-up so the first live frame is not slow
                    model.predict(np.zeros((640, 640, 3), np.uint8), device=device, half=half, verbose=False)
                except Exception:  # noqa: BLE001
                    log.warning("warm-up failed", exc_info=True)
                if SCENE_GATE_PATH.exists():
                    try:
                        self._yolo.gate = SceneGate(YOLO(str(SCENE_GATE_PATH)))
                        self._yolo.gate.model.predict(np.zeros((640, 640, 3), np.uint8), device=device, half=half, verbose=False)
                    except Exception:  # noqa: BLE001
                        log.warning("scene gate failed to load; continuing without it", exc_info=True)
                mapped = sorted({YOLO_CLASS_MAP[n] for n in self._yolo.class_names.values() if n in YOLO_CLASS_MAP})
                self.status = "online" if mapped else "degraded"
                self.detail = (
                    f"Loaded {YOLO_MODEL_PATH.name} on {device_name}{' (FP16)' if half else ''}; "
                    f"classes mapped: {', '.join(mapped) or 'none'}"
                    f"{'; scene gate on' if self._yolo.gate else ''}."
                )
            except Exception as e:  # noqa: BLE001
                log.exception("YOLO load failed")
                self.status = "unavailable"
                self.detail = f"Failed to load weights: {e}"

    def info(self) -> dict:
        y = self._yolo
        return {
            "status": self.status,
            "detail": self.detail,
            "model": YOLO_MODEL_PATH.name if y else None,
            "device": y.device_name if y else None,
            "half": y.half if y else False,
            "inference_fps": y.fps if y else 0.0,
            "inference_ms": y.last_ms if y else 0.0,
            "classes": sorted(set(y.class_names.values())) if y else [],
            "gate_loaded": bool(y and y.gate),
            "gate_suppressed": y.gate.suppressed if y and y.gate else 0,
            "gate_objects": y.gate.last_objects if y and y.gate else [],
            **ai_config.as_dict(),
        }

    @staticmethod
    def model_card() -> Optional[dict]:
        try:
            return json.loads(MODEL_CARD_PATH.read_text())
        except Exception:  # noqa: BLE001
            return None

    def reload(self) -> None:
        with self._lock:
            self._attempted = False
            self._yolo = None
        self.load()

    @property
    def yolo(self) -> Optional[YoloDetector]:
        self.load()
        return self._yolo

    def detector_for(self, source_kind: str) -> Detector:
        if source_kind == "simulation":
            return SimulatedDetector()
        return self.yolo or NullDetector()


def _pick_device():
    """CUDA + FP16 when available (and not overridden), otherwise CPU."""
    want = (YOLO_DEVICE or "auto").lower()
    try:
        import torch  # type: ignore

        if want != "cpu" and torch.cuda.is_available():
            idx = 0 if want in ("auto", "cuda") else int(want.split(":")[-1])
            return f"cuda:{idx}", True, torch.cuda.get_device_name(idx)
    except Exception:  # noqa: BLE001
        log.warning("torch CUDA probe failed; using CPU", exc_info=True)
    import platform

    return "cpu", False, f"CPU ({platform.processor() or platform.machine()})"


models = ModelRegistry()
