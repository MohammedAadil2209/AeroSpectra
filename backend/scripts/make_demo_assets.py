"""Presentation assets from the held-out TEST split (never trained on):
results/demo_images/<class>/*.jpg  (8 per class)  and  results/demo_clip_mc.mp4 (crack/dent/corrosion mix).
"""
import random
import shutil
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "data_prep" / "merged_mc" / "test"
OUT = ROOT / "results" / "demo_images"
NAMES = ["crack", "dent", "corrosion"]
by_cls = {n: [] for n in NAMES}
for lp in sorted((DATA / "labels").glob("*.txt")):
    cls = {int(l.split()[0]) for l in lp.read_text().splitlines() if l.strip()}
    if len(cls) == 1:  # single-class images make the clearest demo
        c = cls.pop()
        img = next((DATA / "images").glob(lp.stem + ".*"), None)
        if img:
            by_cls[NAMES[c]].append(img)
random.seed(5)
if OUT.exists():
    shutil.rmtree(OUT)
picked = []
for n, lst in by_cls.items():
    (OUT / n).mkdir(parents=True)
    sel = random.sample(lst, min(8, len(lst)))
    for i, p in enumerate(sel):
        shutil.copy(p, OUT / n / f"{n}_{i + 1}{p.suffix.lower()}")
    picked.append((n, sel))
    print(n, len(lst), "available ->", len(sel))

W, H, FPS = 1280, 720, 25
vw = cv2.VideoWriter(str(ROOT / "results" / "demo_clip_mc.mp4"), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
order = [p for i in range(8) for _, sel in picked for p in sel[i:i + 1]]  # interleave crack, dent, corrosion
for p in order:
    im = cv2.imread(str(p))
    h, w = im.shape[:2]
    s = min(W / w, H / h)
    im = cv2.resize(im, (int(w * s), int(h * s)))
    bg = cv2.GaussianBlur(cv2.resize(im, (W, H)), (51, 51), 0)
    y0, x0 = (H - im.shape[0]) // 2, (W - im.shape[1]) // 2
    bg[y0:y0 + im.shape[0], x0:x0 + im.shape[1]] = im
    for _ in range(int(FPS * 1.6)):
        vw.write(bg)
vw.release()
print("clip:", ROOT / "results" / "demo_clip_mc.mp4", len(order), "images")
