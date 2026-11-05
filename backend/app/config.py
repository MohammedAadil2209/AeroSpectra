"""Central configuration. Values can be overridden with environment variables."""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent

EVIDENCE_DIR = Path(os.getenv("AEROSPECTRA_EVIDENCE_DIR", BACKEND_DIR / "evidence"))
UPLOAD_DIR = Path(os.getenv("AEROSPECTRA_UPLOAD_DIR", BACKEND_DIR / "uploads"))
RECORDING_DIR = Path(os.getenv("AEROSPECTRA_RECORDING_DIR", BACKEND_DIR / "recordings"))
MODEL_DIR = Path(os.getenv("AEROSPECTRA_MODEL_DIR", BACKEND_DIR / "models"))

# SQLite by default. Any SQLAlchemy URL works, e.g.
# postgresql+psycopg://user:pass@localhost:5432/aerospectra
DATABASE_URL = os.getenv("AEROSPECTRA_DATABASE_URL", f"sqlite:///{BACKEND_DIR / 'aerospectra.db'}")

# YOLO weights. Detection is only reported as "AI" when this file exists AND loads.
YOLO_MODEL_PATH = Path(os.getenv("AEROSPECTRA_YOLO_MODEL", MODEL_DIR / "aerospectra-defects.pt"))
YOLO_CONFIDENCE = float(os.getenv("AEROSPECTRA_YOLO_CONFIDENCE", "0.35"))
# Scene gate: COCO model suppresses "defects" on people / everyday objects (faces, hands, clothing...).
SCENE_GATE_PATH = MODEL_DIR / "coco-gate.pt"
SCENE_GATE = os.getenv("AEROSPECTRA_SCENE_GATE", "1") not in ("0", "false", "no")
# A finding must be seen in this many consecutive inference frames before it is shown/recorded.
CONFIRM_HITS = int(os.getenv("AEROSPECTRA_CONFIRM_HITS", "2"))
# "auto" -> CUDA (half precision) when available, else CPU. Or force "cpu" / "cuda:0".
YOLO_DEVICE = os.getenv("AEROSPECTRA_YOLO_DEVICE", "auto")
MODEL_CARD_PATH = MODEL_DIR / "model_card.json"
# Maps model class names -> AeroSpectra categories. Unknown classes are ignored.
YOLO_CLASS_MAP = {
    "crack": "crack",
    "cracks": "crack",
    "dent": "dent",
    "dents": "dent",
    "corrosion": "corrosion",
    "rust": "corrosion",
    # Single-class AeroSpectra model (merged public datasets) and generic damage names.
    "defect": "defect",
    "damage": "defect",
    "scratch": "defect",
    "missing-rivet": "defect",
    "missing_rivet": "defect",
    "paint-off": "defect",
    "paint_peel": "defect",
}

# Demo dataset shared with the frontend (single source of truth).
DEMO_SEED_PATH = Path(os.getenv("AEROSPECTRA_DEMO_SEED", PROJECT_DIR / "shared" / "demo-seed.json"))

CORS_ORIGINS = os.getenv(
    "AEROSPECTRA_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")

# Default live camera URI (device index such as "0", or a verified RTSP/HTTP URL).
DEFAULT_CAMERA_URI = os.getenv("AEROSPECTRA_CAMERA_URI", "0")
# Default drone RTSP stream (UDP first, automatic TCP fallback).
DEFAULT_RTSP_URI = os.getenv("AEROSPECTRA_RTSP_URI", "rtsp://192.168.1.1:7070/webcam")

# Inference runs every Nth frame to keep the pipeline real-time on a laptop CPU.
INFERENCE_EVERY_N_FRAMES = int(os.getenv("AEROSPECTRA_INFER_EVERY", "2"))
STREAM_JPEG_QUALITY = int(os.getenv("AEROSPECTRA_JPEG_QUALITY", "80"))

APP_VERSION = "1.1.0"
REPAIR_PHOTO_DIR = EVIDENCE_DIR / "repairs"

for d in (REPAIR_PHOTO_DIR, EVIDENCE_DIR, UPLOAD_DIR, RECORDING_DIR, MODEL_DIR):
    d.mkdir(parents=True, exist_ok=True)
