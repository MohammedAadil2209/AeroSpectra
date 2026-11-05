"""Build a demo MP4 from the held-out TEST images (each shown ~1.2 s with a slow pan/zoom)."""
import random
import sys
from pathlib import Path

import cv2

ROOT = Path(__file__).resolve().parents[2]
src = sorted((ROOT / "data_prep" / "merged" / "test" / "images").iterdir())
out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "results" / "test_clip.mp4"
n = int(sys.argv[2]) if len(sys.argv) > 2 else 30
random.seed(3)
pick = random.sample(src, min(n, len(src)))
W, H, FPS = 1280, 720, 25
vw = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
for ip in pick:
    im = cv2.imread(str(ip))
    if im is None:
        continue
    h, w = im.shape[:2]
    s = min(W / w, H / h)
    im = cv2.resize(im, (int(w * s), int(h * s)))
    for f in range(30):  # 1.2 s, gentle zoom
        z = 1.0 + 0.06 * f / 30
        zi = cv2.resize(im, None, fx=z, fy=z)
        canvas = cv2.copyMakeBorder(zi, 0, 0, 0, 0, cv2.BORDER_CONSTANT)
        frame = cv2.resize(canvas[: int(im.shape[0]), : int(im.shape[1])], (im.shape[1], im.shape[0]))
        bg = cv2.GaussianBlur(cv2.resize(im, (W, H)), (51, 51), 0)
        y0, x0 = (H - frame.shape[0]) // 2, (W - frame.shape[1]) // 2
        bg[y0:y0 + frame.shape[0], x0:x0 + frame.shape[1]] = frame
        vw.write(bg)
vw.release()
print("wrote", out, len(pick), "images")
