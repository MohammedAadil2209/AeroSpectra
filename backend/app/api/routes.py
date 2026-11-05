"""REST + streaming endpoints. Thin layer: validation -> repository/service -> schema."""
from __future__ import annotations

import shutil
import time
import uuid
from datetime import date, datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import APP_VERSION, DEFAULT_CAMERA_URI, UPLOAD_DIR
from app.database import repository as repo
from app.database.session import get_db
from app.detection.detectors import models
from app.schemas.api import (
    AircraftOut,
    AnalyticsOut,
    CameraTestIn,
    CameraTestOut,
    DetectionOut,
    HealthOut,
    InspectionDetailOut,
    InspectionOut,
    ReviewIn,
    StartInspectionIn,
    StopInspectionIn,
    UploadOut,
)
from app.services.inspection_runner import InspectionConflict, runner
from app.video.sources import VideoSourceError, probe_video, test_camera
from app.services.events import kpi, publish
from app.websocket.manager import ws_manager

router = APIRouter(prefix="/api")
Scope = Literal["demo", "real"]
_last_camera_test: dict = {"status": "not_configured", "detail": "Camera not tested yet. Use Settings > Test camera."}


def _is_demo(scope: Scope) -> bool:
    return scope == "demo"


def _inspection_out(db: Session, insp, count: Optional[int] = None) -> dict:
    data = InspectionOut.model_validate(insp).model_dump()
    if count is None:
        count = repo.detection_counts(db, [insp.id]).get(insp.id, 0)
    data["detection_count"] = count
    return data


# ---------------------------------------------------------------- health
@router.get("/health", response_model=HealthOut)
def health(db: Session = Depends(get_db)):
    try:
        db.execute(text("SELECT 1"))
        db_status = {"status": "online", "detail": db.bind.dialect.name if db.bind else "sql"}
    except Exception as e:  # noqa: BLE001
        db_status = {"status": "offline", "detail": str(e)}
    models.load()
    snap = runner.snapshot()
    camera = dict(_last_camera_test)
    if snap and snap["source"] in ("camera", "drone_direct"):
        live = snap.get("connected", True)
        camera = {"status": "online" if live else "degraded",
                  "detail": ("Streaming from the drone (direct Wi-Fi)." if snap["source"] == "drone_direct" else "Streaming from live camera.")
                  if live else "Link lost - reconnecting..."}
    return {
        "status": "ok",
        "version": APP_VERSION,
        "time": datetime.utcnow(),
        "database": db_status,
        "ai_model": {"status": models.status, "detail": models.detail, **models.info()},
        "camera": camera,
        "active_inspection_id": runner.active_id,
        "websocket_clients": len(ws_manager.clients),
    }


# ---------------------------------------------------------------- aircraft
class AircraftIn(BaseModel):
    id: str
    registration: str
    model: str
    operator: str = ""
    base: str = ""


@router.get("/aircraft", response_model=list[AircraftOut])
def list_aircraft(scope: Scope = "demo", db: Session = Depends(get_db)):
    return repo.list_aircraft(db, _is_demo(scope))


@router.post("/aircraft", response_model=AircraftOut, status_code=201)
def create_aircraft(body: AircraftIn, db: Session = Depends(get_db)):
    """Register a REAL aircraft (demo aircraft only come from the demo seed)."""
    aid = body.id.strip().upper()
    if not aid:
        raise HTTPException(422, "Aircraft ID is required.")
    if repo.get_aircraft(db, aid):
        raise HTTPException(409, f"Aircraft {aid} already exists.")
    from app.models.entities import Aircraft

    a = Aircraft(id=aid, registration=body.registration.strip(), model=body.model.strip(),
                 operator=body.operator.strip(), base=body.base.strip(), is_demo=False)
    db.add(a)
    db.commit()
    return repo.aircraft_summary(db, a)


@router.get("/aircraft/{aircraft_id}", response_model=AircraftOut)
def get_aircraft(aircraft_id: str, db: Session = Depends(get_db)):
    a = repo.get_aircraft(db, aircraft_id)
    if not a:
        raise HTTPException(404, "Aircraft not found")
    return repo.aircraft_summary(db, a)


# ---------------------------------------------------------------- inspections
@router.get("/inspections", response_model=list[InspectionOut])
def list_inspections(
    scope: Scope = "demo",
    aircraft_id: Optional[str] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    rows = repo.list_inspections(db, _is_demo(scope), aircraft_id, status)
    counts = repo.detection_counts(db, [r.id for r in rows])
    return [_inspection_out(db, r, counts.get(r.id, 0)) for r in rows]


@router.get("/inspections/active")
def active_inspection():
    return {"active": runner.snapshot()}


@router.post("/inspections/start", response_model=InspectionOut, status_code=201)
def start_inspection(body: StartInspectionIn, db: Session = Depends(get_db)):
    try:
        iid = runner.start(
            aircraft_id=body.aircraft_id,
            source_kind=body.source,
            camera_uri=body.camera_uri or (DEFAULT_CAMERA_URI if body.source == "camera" else None),
            upload_id=body.upload_id,
            record=body.record,
            notes=body.notes,
        )
    except InspectionConflict as e:
        raise HTTPException(409, str(e))
    except (VideoSourceError, ValueError) as e:
        if body.source in ("camera", "drone_direct"):
            _last_camera_test.update(status="offline", detail=str(e))
        raise HTTPException(400, str(e))
    insp = repo.get_inspection(db, iid)
    return _inspection_out(db, insp, 0)


@router.post("/inspections/stop")
def stop_inspection(body: StopInspectionIn = StopInspectionIn()):
    active = runner.active_id
    if not active:
        raise HTTPException(409, "No inspection is running.")
    if body.inspection_id and body.inspection_id != active:
        raise HTTPException(409, f"Inspection {body.inspection_id} is not the active inspection ({active}).")
    runner.stop("user")
    return {"stopped": active}


@router.post("/inspections/pause")
def pause_inspection():
    if not runner.pause():
        raise HTTPException(409, "No inspection is running.")
    return {"paused": runner.active_id}


@router.post("/inspections/resume")
def resume_inspection():
    if not runner.resume():
        raise HTTPException(409, "No inspection is running.")
    return {"resumed": runner.active_id}


class RecordingIn(BaseModel):
    recording: bool


@router.post("/inspections/recording")
def set_recording(body: RecordingIn):
    try:
        return runner.set_recording(body.recording)
    except InspectionConflict as e:
        raise HTTPException(409, str(e))


class SectionIn(BaseModel):
    section: str


@router.post("/inspections/section")
def set_section(body: SectionIn):
    if not runner.active_id:
        raise HTTPException(409, "No inspection is running.")
    runner.set_section(body.section)
    return {"section": body.section}


@router.get("/inspections/{inspection_id}", response_model=InspectionDetailOut)
def get_inspection(inspection_id: str, db: Session = Depends(get_db)):
    insp = repo.get_inspection(db, inspection_id)
    if not insp:
        raise HTTPException(404, "Inspection not found")
    data = _inspection_out(db, insp, len(insp.detections))
    data["aircraft"] = repo.aircraft_summary(db, insp.aircraft)
    data["detections"] = [repo.detection_payload(d) for d in insp.detections]
    return data


# ---------------------------------------------------------------- detections
@router.get("/detections", response_model=list[DetectionOut])
def list_detections(
    scope: Scope = "demo",
    category: Optional[str] = None,
    review_status: Optional[str] = None,
    aircraft_id: Optional[str] = None,
    inspection_id: Optional[str] = None,
    min_confidence: Optional[float] = Query(None, ge=0, le=1),
    max_confidence: Optional[float] = Query(None, ge=0, le=1),
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    q: Optional[str] = None,
    db: Session = Depends(get_db),
):
    to_dt = lambda d: datetime(d.year, d.month, d.day) if d else None  # noqa: E731
    rows = repo.list_detections(
        db, _is_demo(scope), category, review_status, aircraft_id, inspection_id,
        min_confidence, max_confidence, to_dt(date_from), to_dt(date_to), q,
    )
    return [repo.detection_payload(d) for d in rows]


@router.get("/detections/{detection_id}", response_model=DetectionOut)
def get_detection(detection_id: str, db: Session = Depends(get_db)):
    d = repo.get_detection(db, detection_id)
    if not d:
        raise HTTPException(404, "Detection not found")
    return repo.detection_payload(d)


@router.patch("/detections/{detection_id}/review", response_model=DetectionOut)
def review_detection(detection_id: str, body: ReviewIn, db: Session = Depends(get_db)):
    d = repo.review_detection(db, detection_id, body.review_status, body.reviewer, body.reviewer_notes, body.category)
    if not d:
        raise HTTPException(404, "Detection not found")
    db.commit()
    out = repo.detection_payload(d)
    publish("defect.updated", {"detection": out})
    publish("maintenance.updated", {"detection": out, "event": None})
    kpi.touch(d.is_demo)
    return out


# ---------------------------------------------------------------- analytics
@router.get("/analytics", response_model=AnalyticsOut)
def analytics(scope: Scope = "demo", db: Session = Depends(get_db)):
    return repo.analytics(db, _is_demo(scope))


# ---------------------------------------------------------------- video
ALLOWED_EXT = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}


@router.post("/video/upload", response_model=UploadOut, status_code=201)
def upload_video(file: UploadFile = File(...)):
    import os

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(415, f"Unsupported file type '{ext}'. Use {', '.join(sorted(ALLOWED_EXT))}.")
    upload_id = f"UPL-{uuid.uuid4().hex[:8].upper()}"
    dest = UPLOAD_DIR / f"{upload_id}{ext}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    try:
        meta = probe_video(dest)
    except VideoSourceError as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, str(e))
    return {"upload_id": upload_id, "filename": file.filename, "size_bytes": dest.stat().st_size, **meta}


@router.post("/video/camera/test", response_model=CameraTestOut)
def camera_test(body: CameraTestIn):
    if runner.snapshot() and runner.snapshot()["source"] == "camera":
        raise HTTPException(409, "Camera is in use by the active inspection.")
    res = test_camera(body.camera_uri)
    _last_camera_test.update(
        status="online" if res["ok"] else "offline", detail=f"{body.camera_uri}: {res['message']}"
    )
    return {"camera_uri": body.camera_uri, "width": 0, "height": 0, **res}


@router.get("/video/stream")
def video_stream():
    """MJPEG stream of annotated frames from the active inspection."""
    if not runner.active_id:
        raise HTTPException(409, "No active inspection - start one to stream video.")

    def gen():
        seq = -1
        idle_since = time.monotonic()
        while True:
            seq_new, jpeg = runner.wait_frame(seq, timeout=1.0)
            if jpeg is not None and seq_new != seq:
                seq = seq_new
                idle_since = time.monotonic()
                yield b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n"
            elif not runner.active_id and time.monotonic() - idle_since > 2:
                break

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-store"})
