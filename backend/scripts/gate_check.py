"""Measure false alarms on non-aircraft images (people, rooms, objects) with and without the scene gate.

usage: python scripts/gate_check.py [weights] [conf]
Uses COCO128 images (data_prep/neg/coco128) that were NOT used for... (note: they are in the merged training
set as negatives; for an unbiased number pass a folder of your own photos as 3rd arg).
"""
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from ultralytics import YOLO  # noqa: E402

from app.detection.detectors import RawDetection, SceneGate  # noqa: E402

weights = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "backend" / "models" / "aerospectra-defects.pt")
conf = float(sys.argv[2]) if len(sys.argv) > 2 else 0.35
folder = Path(sys.argv[3]) if len(sys.argv) > 3 else ROOT / "data_prep" / "neg" / "coco128" / "images" / "train2017"
model = YOLO(weights)
gate = SceneGate(YOLO(str(ROOT / "backend" / "models" / "coco-gate.pt")))
imgs = sorted(folder.glob("*.jpg"))[:128] + sorted(folder.glob("*.JPEG"))[:128] + sorted(folder.glob("*.png"))[:128]
raw_imgs = gated_imgs = raw_boxes = gated_boxes = 0
for p in imgs:
    im = cv2.imread(str(p))
    r = model.predict(im, conf=conf, verbose=False, device=0, half=True)[0]
    dets = [RawDetection(model.names[int(c)], float(s), x0, y0, x1 - x0, y1 - y0)
            for (x0, y0, x1, y1), s, c in zip(r.boxes.xyxy.cpu().numpy(), r.boxes.conf.cpu().numpy(), r.boxes.cls.cpu().numpy())]
    kept = gate.filter(im, dets, 0, True) if dets else []
    raw_imgs += bool(dets)
    gated_imgs += bool(kept)
    raw_boxes += len(dets)
    gated_boxes += len(kept)
n = len(imgs)
print(f"{n} non-aircraft images, conf>={conf}: false-alarm images {raw_imgs} ({raw_imgs/n:.0%}) -> with scene gate {gated_imgs} ({gated_imgs/n:.0%}); "
      f"boxes {raw_boxes} -> {gated_boxes}")
