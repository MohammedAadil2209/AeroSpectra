"""Defect detectors.

YoloDetector       - real inference with Ultralytics YOLO. Only active when the weights
                     file exists AND loads. Never faked.
SimulatedDetector  - emits ground-truth boxes for synthetic defects painted by
                     SimulatedSource. Results are tagged origin="simulated".
NullDetector       - no model available: frames are streamed, nothing is detected.
"""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from typing import List, Optional

import numpy as np

from app.config import YOLO_CLASS_MAP, YOLO_CONFIDENCE, YOLO_MODEL_PATH

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

    def __init__(self, model) -> None:
        self.model = model
        self.name = f"YOLO ({YOLO_MODEL_PATH.name})"
        self._lock = threading.Lock()
        names = getattr(model, "names", {}) or {}
        self.class_names = {int(k): str(v).lower() for k, v in dict(names).items()}

    def detect(self, frame, context=None):
        with self._lock:
            results = self.model.predict(frame, conf=YOLO_CONFIDENCE, verbose=False)
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
        return out


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
                model = YOLO(str(YOLO_MODEL_PATH))
                self._yolo = YoloDetector(model)
                mapped = sorted({YOLO_CLASS_MAP[n] for n in self._yolo.class_names.values() if n in YOLO_CLASS_MAP})
                self.status = "online" if mapped else "degraded"
                self.detail = (
                    f"Loaded {YOLO_MODEL_PATH.name}; classes mapped: {', '.join(mapped) or 'none'}."
                )
            except Exception as e:  # noqa: BLE001
                log.exception("YOLO load failed")
                self.status = "unavailable"
                self.detail = f"Failed to load weights: {e}"

    @property
    def yolo(self) -> Optional[YoloDetector]:
        self.load()
        return self._yolo

    def detector_for(self, source_kind: str) -> Detector:
        if source_kind == "simulation":
            return SimulatedDetector()
        return self.yolo or NullDetector()


models = ModelRegistry()
