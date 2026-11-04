"""Draw detection overlays on frames (OpenCV, BGR)."""
from __future__ import annotations

from typing import Iterable

import cv2
import numpy as np

from app.detection.detectors import RawDetection

# Palette (BGR) - matches frontend category colours (validated for CVD separation):
# crack #D3263A, dent #4F9BD4, corrosion #AF911A
COLORS = {
    "crack": (58, 38, 211),
    "dent": (212, 155, 79),
    "corrosion": (26, 145, 175),
}


def draw_detections(frame: np.ndarray, dets: Iterable[RawDetection]) -> None:
    for d in dets:
        color = COLORS.get(d.category, (255, 255, 255))
        x0, y0 = int(d.x), int(d.y)
        x1, y1 = int(d.x + d.w), int(d.y + d.h)
        cv2.rectangle(frame, (x0, y0), (x1, y1), color, 2, cv2.LINE_AA)
        # corner ticks
        t = max(10, int(min(d.w, d.h) * 0.18))
        for (cx, cy, dx, dy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
            cv2.line(frame, (cx, cy), (cx + dx * t, cy), color, 4, cv2.LINE_AA)
            cv2.line(frame, (cx, cy), (cx, cy + dy * t), color, 4, cv2.LINE_AA)
        tag = "SIM" if d.origin == "simulated" else "AI"
        label = f"{tag} {d.category.upper()} {d.confidence * 100:.0f}%"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
        ly = max(th + 8, y0)
        cv2.rectangle(frame, (x0, ly - th - 8), (x0 + tw + 10, ly), color, -1)
        cv2.putText(frame, label, (x0 + 5, ly - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 255, 255), 1, cv2.LINE_AA)


def draw_hud(frame: np.ndarray, inspection_id: str, source_label: str, recording: bool, paused: bool) -> None:
    """Session info in a bottom bar (keeps the top of the frame clear for UI overlays)."""
    h, w = frame.shape[:2]
    cv2.rectangle(frame, (0, h - 34), (w, h), (73, 48, 0), -1)  # #003049 (BGR)
    text = f"{inspection_id} | {source_label}"
    (tw, _), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1)
    x = w - tw - 14 - (64 if recording else 0)
    cv2.putText(frame, text, (x, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (213, 240, 253), 1, cv2.LINE_AA)
    if recording:
        cv2.circle(frame, (w - 62, h - 17), 6, (31, 18, 193), -1, cv2.LINE_AA)
        cv2.putText(frame, "REC", (w - 50, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (213, 240, 253), 1, cv2.LINE_AA)
    if paused:
        cv2.putText(frame, "PAUSED", (w // 2 - 50, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (230, 240, 250), 2, cv2.LINE_AA)
