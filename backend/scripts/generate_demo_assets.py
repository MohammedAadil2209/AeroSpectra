"""Generate the fictional DEMO dataset + synthetic evidence images.

Outputs (single source of truth for both backend seed and frontend offline mode):
  shared/demo-seed.json
  frontend/public/demo/evidence/*.jpg

Timestamps are stored as hour offsets relative to "now" so the demo always looks current.
Run:  .venv/bin/python scripts/generate_demo_assets.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.services.triage import triage_priority  # noqa: E402
from app.video.synthetic import SyntheticSkinStrip, draw_simulated_watermark  # noqa: E402

OUT_JSON = ROOT / "shared" / "demo-seed.json"
OUT_IMG = ROOT / "frontend" / "public" / "demo" / "evidence"
SECTIONS = ["Nose & Cockpit", "Left Wing", "Left Engine", "Right Wing", "Right Engine", "Fuselage", "Tail", "Stabilizers"]
CATS = ["crack", "dent", "corrosion"]

AIRCRAFT = [
    ("DEMO-101", "DM-AS101", "A320neo", "Demo Airways (fictional)", "Hangar 2 · Bay A"),
    ("DEMO-102", "DM-AS102", "A321neo", "Demo Airways (fictional)", "Hangar 2 · Bay B"),
    ("DEMO-103", "DM-AS103", "B737-800", "Sample Air Cargo (fictional)", "Apron 4"),
    ("DEMO-104", "DM-AS104", "B787-9", "Demo Airways (fictional)", "Hangar 1"),
    ("DEMO-105", "DM-AS105", "ATR 72-600", "Regional Demo Link (fictional)", "Apron 2"),
]

NOTES = {
    "crack": "Demo note: linear indication near fastener row. Recommend detailed visual + NDT by certified staff.",
    "dent": "Demo note: smooth depression visible under raking light. Measure depth against SRM limits.",
    "corrosion": "Demo note: surface oxidation with pitting. Clean and re-assess extent.",
}


def evidence_image(cat: str, seed: int, path: Path) -> dict:
    strip = SyntheticSkinStrip(frame_w=960, frame_h=540, n_frames_wide=1, defects=0, seed=seed)
    rng = np.random.default_rng(seed)
    cx = int(rng.uniform(330, 630))
    cy = int(rng.uniform(190, 350))
    x0, y0, x1, y1 = getattr(strip, f"_paint_{cat}")(cx, cy)
    frame = strip.frame_at(0, 0)
    draw_simulated_watermark(frame, "DEMO EVIDENCE - SYNTHETIC IMAGERY")
    cv2.imwrite(str(path), frame, [cv2.IMWRITE_JPEG_QUALITY, 82])
    w, h = 960, 540
    return {"x": round(x0 / w, 4), "y": round(y0 / h, 4), "w": round((x1 - x0) / w, 4),
            "h": round((y1 - y0) / h, 4), "frame_w": w, "frame_h": h}


def main() -> None:
    rng = np.random.default_rng(20261104)
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    for old in OUT_IMG.glob("*.jpg"):
        old.unlink()

    aircraft = [
        {"id": a, "registration": r, "model": m, "operator": o, "base": b, "is_demo": True}
        for a, r, m, o, b in AIRCRAFT
    ]
    inspections, detections = [], []
    det_n = 0
    # 18 inspections across the last 28 days
    offsets = sorted(rng.uniform(6, 28 * 24, 18).round(1).tolist(), reverse=True)
    for n, off in enumerate(offsets, start=1):
        ac = aircraft[int(rng.integers(0, len(aircraft)))]
        iid = f"INS-DEMO-{n:03d}"
        dur = round(float(rng.uniform(420, 1500)), 0)
        status = "aborted" if n == 7 else "completed"
        source = ["simulation", "upload", "simulation", "camera"][n % 4]
        k = int(rng.integers(3, 8)) if status == "completed" else 1
        secs = SECTIONS if status == "completed" else SECTIONS[:3]
        inspections.append({
            "id": iid, "aircraft_id": ac["id"], "source": source,
            "source_detail": f"{source} (demo record)",
            "status": status, "detection_mode": "simulated",
            "started_offset_h": off, "duration_s": dur,
            "frames_processed": int(dur * 25), "sections_inspected": secs,
            "recording_url": None,
            "notes": "Fictional demonstration inspection.",
            "error": "Demo: mission aborted - simulated low battery." if status == "aborted" else None,
            "is_demo": True,
        })
        recent = off < 72  # last 3 days still mostly pending
        for _ in range(k):
            det_n += 1
            did = f"DET-DEMO-{det_n:03d}"
            cat = CATS[int(rng.choice(3, p=[0.36, 0.30, 0.34]))]
            conf = round(float(rng.uniform(0.55, 0.98)), 3)
            t = round(float(rng.uniform(5, dur - 5)), 1)
            if recent:
                rs = str(rng.choice(["pending", "pending", "pending", "reviewed"]))
            else:
                rs = str(rng.choice(["confirmed", "false_positive", "reviewed", "pending", "confirmed"],
                                    p=[0.38, 0.2, 0.17, 0.1, 0.15]))
            img = f"{did}.jpg"
            bbox = evidence_image(cat, 1000 + det_n, OUT_IMG / img)
            detections.append({
                "id": did, "inspection_id": iid, "aircraft_id": ac["id"],
                "category": cat, "confidence": conf,
                "detected_offset_h": round(off - t / 3600, 4), "video_time_s": t,
                "bbox": bbox, "section": str(rng.choice(secs)),
                "priority": triage_priority(cat, conf),
                "evidence_url": f"/demo/evidence/{img}",
                "origin": "simulated", "model_name": "Demo dataset (no AI model)",
                "review_status": rs,
                "reviewer": None if rs == "pending" else "Demo Reviewer",
                "reviewer_notes": "" if rs == "pending" else (
                    "Demo note: confirmed as false indication (reflection/paint)." if rs == "false_positive" else NOTES[cat]),
                "reviewed_offset_h": None if rs == "pending" else round(max(0.5, off - 6), 2),
                "is_demo": True,
            })

    OUT_JSON.write_text(json.dumps({
        "_note": "FICTIONAL DEMONSTRATION DATA. Not real aircraft, inspections or AI results.",
        "aircraft": aircraft, "inspections": inspections, "detections": detections,
    }, indent=1))
    print(f"wrote {len(aircraft)} aircraft, {len(inspections)} inspections, {len(detections)} detections")


if __name__ == "__main__":
    main()
