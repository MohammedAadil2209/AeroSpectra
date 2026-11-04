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
YOLO_CONFIDENCE = float(os.getenv("AEROSPECTRA_YOLO_CONFIDENCE", "0.40"))
# Maps model class names -> AeroSpectra categories. Unknown classes are ignored.
YOLO_CLASS_MAP = {
    "crack": "crack",
    "cracks": "crack",
    "dent": "dent",
    "dents": "dent",
    "corrosion": "corrosion",
    "rust": "corrosion",
}

# Demo dataset shared with the frontend (single source of truth).
DEMO_SEED_PATH = Path(os.getenv("AEROSPECTRA_DEMO_SEED", PROJECT_DIR / "shared" / "demo-seed.json"))

CORS_ORIGINS = os.getenv(
    "AEROSPECTRA_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")

# Default live camera URI (device index such as "0", or a verified RTSP/HTTP URL).
DEFAULT_CAMERA_URI = os.getenv("AEROSPECTRA_CAMERA_URI", "0")

# Inference runs every Nth frame to keep the pipeline real-time on a laptop CPU.
INFERENCE_EVERY_N_FRAMES = int(os.getenv("AEROSPECTRA_INFER_EVERY", "3"))
STREAM_JPEG_QUALITY = int(os.getenv("AEROSPECTRA_JPEG_QUALITY", "80"))

APP_VERSION = "1.0.0"

for d in (EVIDENCE_DIR, UPLOAD_DIR, RECORDING_DIR, MODEL_DIR):
    d.mkdir(parents=True, exist_ok=True)
