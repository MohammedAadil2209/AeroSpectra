"""Procedural aircraft-skin imagery for SIMULATION mode and demo evidence.

Generates a long strip of brushed aluminium panel with seams, rivet rows and
painted-in synthetic defects (crack / dent / corrosion) at known positions.
Because the defect positions are known, the simulated detector can emit
ground-truth boxes - which exercises the whole pipeline (boxes, evidence,
DB, WebSocket, review) without pretending a trained model exists.

Everything produced here is SYNTHETIC and labelled as such.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional, Tuple

import cv2
import numpy as np

CATEGORIES = ("crack", "dent", "corrosion")


@dataclass
class SyntheticDefect:
    uid: int
    category: str
    x: int
    y: int
    w: int
    h: int
    confidence: float


class SyntheticSkinStrip:
    def __init__(
        self,
        frame_w: int = 1280,
        frame_h: int = 720,
        n_frames_wide: int = 7,
        defects: int = 6,
        seed: Optional[int] = None,
    ) -> None:
        self.rng = np.random.default_rng(seed)
        self.frame_w, self.frame_h = frame_w, frame_h
        self.width = frame_w * n_frames_wide
        self.height = frame_h
        self.defects: List[SyntheticDefect] = []
        self.image = self._base_panel()
        self._place_defects(defects)
        self._vignette = self._make_vignette()

    # ------------------------------------------------------------ base surface
    def _base_panel(self) -> np.ndarray:
        h, w, rng = self.height, self.width, self.rng
        # brushed metal: horizontal-blurred noise + low-frequency light falloff
        noise = rng.normal(0, 1, (h, w)).astype(np.float32)
        brushed = cv2.blur(noise, (61, 1)) * 18.0
        lowfreq = cv2.resize(
            rng.normal(0, 1, (6, max(2, w // 300))).astype(np.float32),
            (w, h),
            interpolation=cv2.INTER_CUBIC,
        ) * 9.0
        ys = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
        sheen = (1 - ys**2) * 14.0
        gray = np.clip(168 + brushed + lowfreq + sheen, 0, 255)
        img = np.dstack([gray * 1.04, gray * 1.0, gray * 0.95])  # cool aluminium tint (BGR)
        img = np.clip(img, 0, 255).astype(np.uint8)

        # lap joints (horizontal) and butt seams (vertical)
        joints_y = [int(h * 0.16), int(h * 0.84)]
        for jy in joints_y:
            cv2.line(img, (0, jy), (w, jy), (118, 116, 112), 2, cv2.LINE_AA)
            cv2.line(img, (0, jy + 2), (w, jy + 2), (205, 203, 198), 1, cv2.LINE_AA)
        seam_spacing = int(self.frame_w * 0.85)
        seams_x = list(range(seam_spacing // 2, w, seam_spacing))
        for sx in seams_x:
            cv2.line(img, (sx, 0), (sx, h), (120, 118, 114), 2, cv2.LINE_AA)
            cv2.line(img, (sx + 2, 0), (sx + 2, h), (206, 204, 199), 1, cv2.LINE_AA)

        # rivet rows
        pitch = 34
        for jy in joints_y:
            for ry in (jy - 16, jy + 18):
                for rx in range(12, w, pitch):
                    self._rivet(img, rx, ry)
        for sx in seams_x:
            for ry in range(joints_y[0] + 40, joints_y[1] - 20, pitch):
                self._rivet(img, sx - 14, ry)
                self._rivet(img, sx + 16, ry)
        return img

    @staticmethod
    def _rivet(img: np.ndarray, x: int, y: int) -> None:
        cv2.circle(img, (x, y), 6, (128, 126, 122), -1, cv2.LINE_AA)
        cv2.circle(img, (x, y), 6, (95, 93, 90), 1, cv2.LINE_AA)
        cv2.circle(img, (x - 2, y - 2), 2, (225, 224, 220), -1, cv2.LINE_AA)

    # ------------------------------------------------------------ defects
    def _place_defects(self, n: int) -> None:
        rng = self.rng
        margin = self.frame_w // 2
        slots = np.linspace(margin, self.width - margin, n)
        for i, cx in enumerate(slots):
            cx = int(cx + rng.uniform(-120, 120))
            cy = int(rng.uniform(self.height * 0.30, self.height * 0.70))
            cat = CATEGORIES[(i + int(rng.integers(0, 3))) % 3]
            conf = float(np.round(rng.uniform(0.62, 0.97), 3))
            box = getattr(self, f"_paint_{cat}")(cx, cy)
            x0, y0, x1, y1 = box
            self.defects.append(SyntheticDefect(i, cat, x0, y0, x1 - x0, y1 - y0, conf))

    def _paint_crack(self, cx: int, cy: int) -> Tuple[int, int, int, int]:
        rng = self.rng
        pts = [(cx, cy)]
        ang = rng.uniform(-0.6, 0.6) + (math.pi if rng.random() < 0.5 else 0)
        length = int(rng.uniform(90, 170))
        x, y = float(cx), float(cy)
        for _ in range(length // 4):
            ang += rng.normal(0, 0.35)
            x += math.cos(ang) * 4
            y += math.sin(ang) * 4
            pts.append((int(x), int(y)))
        all_pts = list(pts)
        arr = np.array(pts, np.int32)
        cv2.polylines(self.image, [arr], False, (52, 50, 48), 2, cv2.LINE_AA)
        cv2.polylines(self.image, [arr + 1], False, (210, 210, 206), 1, cv2.LINE_AA)
        # branches
        for _ in range(int(rng.integers(1, 3))):
            sx, sy = pts[int(rng.integers(len(pts) // 3, len(pts)))]
            ang2 = ang + rng.choice([-1, 1]) * rng.uniform(0.5, 1.1)
            bx, by = float(sx), float(sy)
            branch = [(sx, sy)]
            for _ in range(int(rng.integers(5, 12))):
                ang2 += rng.normal(0, 0.3)
                bx += math.cos(ang2) * 4
                by += math.sin(ang2) * 4
                branch.append((int(bx), int(by)))
            cv2.polylines(self.image, [np.array(branch, np.int32)], False, (70, 68, 66), 1, cv2.LINE_AA)
            all_pts += branch
        a = np.array(all_pts)
        pad = 14
        return a[:, 0].min() - pad, a[:, 1].min() - pad, a[:, 0].max() + pad, a[:, 1].max() + pad

    def _paint_dent(self, cx: int, cy: int) -> Tuple[int, int, int, int]:
        rng = self.rng
        rx, ry = int(rng.uniform(55, 85)), int(rng.uniform(40, 65))
        x0, y0, x1, y1 = cx - rx, cy - ry, cx + rx, cy + ry
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        nx, ny = (xx - cx) / rx, (yy - cy) / ry
        r2 = nx**2 + ny**2
        inside = r2 < 1
        # light from top-left: concave dent -> shadow top-left, highlight bottom-right
        shade = (nx * 0.7 + ny * 0.7) * (1 - r2) * 85.0
        shade[~inside] = 0
        shade = cv2.GaussianBlur(shade, (0, 0), 3)
        patch = self.image[y0:y1, x0:x1].astype(np.float32)
        patch += shade[..., None]
        self.image[y0:y1, x0:x1] = np.clip(patch, 0, 255).astype(np.uint8)
        # paint scuff at centre
        cv2.ellipse(self.image, (cx, cy), (rx // 4, ry // 5), 15, 0, 360, (150, 148, 146), 1, cv2.LINE_AA)
        pad = 8
        return x0 - pad, y0 - pad, x1 + pad, y1 + pad

    def _paint_corrosion(self, cx: int, cy: int) -> Tuple[int, int, int, int]:
        rng = self.rng
        r = int(rng.uniform(50, 85))
        x0, y0, x1, y1 = cx - r, cy - r, cx + r, cy + r
        size = (y1 - y0, x1 - x0)
        n = cv2.resize(rng.random((10, 10)).astype(np.float32), (size[1], size[0]), interpolation=cv2.INTER_CUBIC)
        n2 = cv2.GaussianBlur(rng.random(size).astype(np.float32), (0, 0), 2.5)
        yy, xx = np.mgrid[0 : size[0], 0 : size[1]].astype(np.float32)
        d = np.sqrt((xx - r) ** 2 + (yy - r) ** 2) / r
        field = n * 0.65 + n2 * 0.35 - d * 0.75
        mask = (field > 0.08).astype(np.float32)
        mask = cv2.GaussianBlur(mask, (0, 0), 1.2)
        brown = np.array([42, 78, 128], np.float32)  # BGR rust/oxide
        white = np.array([190, 196, 198], np.float32)  # aluminium oxide bloom
        mix = np.where((n2 > 0.55)[..., None], white, brown)
        patch = self.image[y0:y1, x0:x1].astype(np.float32)
        patch = patch * (1 - mask[..., None] * 0.65) + mix * mask[..., None] * 0.65
        # pitting
        for _ in range(int(r * 0.9)):
            px, py = int(rng.uniform(0, size[1])), int(rng.uniform(0, size[0]))
            if mask[py, px] > 0.5:
                cv2.circle(patch, (px, py), int(rng.integers(1, 3)), (30, 40, 55), -1, cv2.LINE_AA)
        self.image[y0:y1, x0:x1] = np.clip(patch, 0, 255).astype(np.uint8)
        ys, xs = np.where(mask > 0.3)
        if len(xs) == 0:
            return x0, y0, x1, y1
        pad = 8
        return x0 + xs.min() - pad, y0 + ys.min() - pad, x0 + xs.max() + pad, y0 + ys.max() + pad

    # ------------------------------------------------------------ framing
    def _make_vignette(self) -> np.ndarray:
        h, w = self.frame_h, self.frame_w
        ys = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
        xs = np.linspace(-1, 1, w, dtype=np.float32)[None, :]
        v = 1 - 0.28 * (xs**2 + ys**2)
        return np.clip(v, 0.55, 1)[..., None]

    @property
    def max_offset(self) -> int:
        return self.width - self.frame_w

    def frame_at(self, offset: float, t: float) -> np.ndarray:
        """Crop a frame at horizontal offset with mild drone-like jitter."""
        off = int(np.clip(offset, 0, self.max_offset))
        jitter_y = int(6 * math.sin(t * 1.7))
        crop = self.image[:, off : off + self.frame_w]
        if jitter_y:
            crop = np.roll(crop, jitter_y, axis=0)
        frame = (crop.astype(np.float32) * self._vignette).astype(np.uint8)
        return frame

    def visible_defects(self, offset: float, central_fraction: float = 0.7) -> List[Tuple[SyntheticDefect, Tuple[int, int, int, int]]]:
        """Defects whose box is fully inside the central region of the current frame."""
        off = int(offset)
        lo = off + self.frame_w * (1 - central_fraction) / 2
        hi = off + self.frame_w * (1 + central_fraction) / 2
        out = []
        for d in self.defects:
            if d.x >= lo and d.x + d.w <= hi:
                out.append((d, (d.x - off, d.y, d.w, d.h)))
        return out


def draw_simulated_watermark(frame: np.ndarray, label: str = "SIMULATED FEED - SYNTHETIC IMAGERY") -> None:
    h, w = frame.shape[:2]
    (tw, _), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.6, 1)
    cv2.rectangle(frame, (0, h - 34), (tw + 28, h), (73, 48, 0), -1)  # #003049 in BGR
    cv2.putText(frame, label, (14, h - 11), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (213, 240, 253), 1, cv2.LINE_AA)
