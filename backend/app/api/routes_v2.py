"""v1.1 endpoints: AI runtime config, risk engine, cost & ROI, maintenance lifecycle."""
from __future__ import annotations

import uuid
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import REPAIR_PHOTO_DIR
from app.database import repository as repo
from app.database.session import get_db
from app.detection.detectors import ai_config, models
from app.schemas.api import AIConfigIn, SettingIn, TransitionIn
from app.services import cost as cost_engine
from app.services import maintenance as mx
from app.services import risk as risk_engine
from app.services.events import kpi, publish
from app.services.settings_store import audit_log, deep_merge, get_setting, get_value, put_setting

router = APIRouter(prefix="/api")
Scope = Literal["demo", "real"]
SettingKey = Literal["risk", "cost"]


# ---------------------------------------------------------------- AI runtime
@router.get("/ai")
def ai_info():
    models.load()
    return {**models.info(), "model_card": models.model_card()}


@router.post("/ai")
def ai_update(body: AIConfigIn):
    if body.confidence is not None:
        ai_config.confidence = float(body.confidence)
    if body.infer_every is not None:
        ai_config.infer_every = int(body.infer_every)
    info = models.info()
    publish("ai.updated", {"ai": info})
    return info


@router.get("/ai/model-card")
def model_card():
    card = models.model_card()
    if card is None:
        raise HTTPException(404, "No model_card.json (model not trained/deployed yet).")
    return card


@router.post("/ai/reload")
def ai_reload():
    models.reload()
    info = models.info()
    publish("ai.updated", {"ai": info})
    return info


# ---------------------------------------------------------------- settings (risk / cost)
@router.get("/settings/{key}")
def read_setting(key: SettingKey, db: Session = Depends(get_db)):
    return get_setting(db, key)


@router.get("/settings/{key}/audit")
def read_audit(key: SettingKey, db: Session = Depends(get_db)):
    return audit_log(db, key)


@router.put("/settings/{key}")
def write_setting(key: SettingKey, body: SettingIn, db: Session = Depends(get_db)):
    saved = put_setting(db, key, body.value, actor=body.actor, note=body.note)
    if key == "risk":
        res = repo.rescore_all(db)
    else:
        repo.recost_all(db)
        res = {"changed": 0}
    db.commit()
    publish("settings.updated", {"key": key, "version": saved["version"], "updated_by": saved["updated_by"]})
    publish("risk.updated", {"version": saved["version"], "key": key, "changed": res.get("changed", 0),
                             "counts": res.get("counts")})
    kpi.touch(True)
    kpi.touch(False)
    return saved


class RiskPreviewIn(BaseModel):
    value: dict
    scope: Scope = "demo"
    broadcast: bool = True


@router.post("/risk/preview")
def risk_preview(body: RiskPreviewIn, db: Session = Depends(get_db)):
    """Re-score every current + historical detection with UNSAVED weights (live slider preview)."""
    cfg = deep_merge(risk_engine.DEFAULT_RISK_CONFIG, deep_merge(get_value(db, "risk"), body.value))
    res = repo.risk_preview(db, cfg, body.scope == "demo")
    if body.broadcast:
        publish("risk.updated", {"preview": True, "scope": body.scope, "counts": res["counts"]})
    return res


@router.get("/risk/presets")
def risk_presets():
    return {"presets": risk_engine.PRESETS, "defaults": risk_engine.DEFAULT_RISK_CONFIG,
            "recommendations": risk_engine.RECOMMENDATIONS, "disclaimer": risk_engine.DISCLAIMER}


@router.post("/risk/rescore")
def risk_rescore(db: Session = Depends(get_db)):
    res = repo.rescore_all(db)
    db.commit()
    publish("risk.updated", {"changed": res["changed"], "counts": res["counts"]})
    kpi.touch(True)
    kpi.touch(False)
    return res


# ---------------------------------------------------------------- cost & ROI
@router.get("/roi")
def roi(fleet: int = 20, inspections_per_month: Optional[float] = None, db: Session = Depends(get_db)):
    cfg = get_value(db, "cost")
    return {**cost_engine.roi(cfg, fleet, inspections_per_month),
            "revenue_projection": cost_engine.revenue_projection(cfg), "assumptions": cfg}


@router.get("/inspections/{inspection_id}/costs")
def inspection_costs(inspection_id: str, db: Session = Depends(get_db)):
    insp = repo.get_inspection(db, inspection_id)
    if not insp:
        raise HTTPException(404, "Inspection not found")
    return {**cost_engine.inspection_totals(insp.detections), "currency": get_value(db, "cost")["currency"],
            "label": "Estimate, based on editable assumptions"}


# ---------------------------------------------------------------- maintenance
@router.get("/maintenance/statuses")
def maintenance_statuses():
    return {"statuses": mx.STATUSES, "labels": mx.LABELS,
            "transitions": {k: mx.allowed(k) for k in mx.STATUSES}, "reason_required": sorted(mx.REASON_REQUIRED)}


@router.post("/detections/{detection_id}/transition")
def transition(detection_id: str, body: TransitionIn, db: Session = Depends(get_db)):
    det = repo.get_detection(db, detection_id)
    if not det:
        raise HTTPException(404, "Detection not found")
    try:
        ev = repo.transition(db, det, body.to_status, actor=body.actor, notes=body.notes, reason=body.reason,
                             actual_cost=body.actual_cost, actual_labour_hours=body.actual_labour_hours,
                             photo_url=body.photo_url)
    except mx.TransitionError as e:
        raise HTTPException(422, str(e))
    db.commit()
    out = repo.detection_payload(det)
    publish("maintenance.updated", {"detection": out, "event": repo.event_payload(ev)})
    publish("defect.updated", {"detection": out})
    kpi.touch(det.is_demo)
    return {"detection": out, "event": repo.event_payload(ev)}


@router.get("/detections/{detection_id}/events")
def detection_events(detection_id: str, db: Session = Depends(get_db)):
    return repo.maintenance_events(db, detection_id=detection_id)


@router.post("/detections/{detection_id}/photo")
def upload_repair_photo(detection_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    import os
    import shutil

    det = repo.get_detection(db, detection_id)
    if not det:
        raise HTTPException(404, "Detection not found")
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in {".jpg", ".jpeg", ".png", ".webp"}:
        raise HTTPException(415, "Use a JPG, PNG or WEBP photo.")
    name = f"{detection_id}-after-{uuid.uuid4().hex[:6]}{ext}"
    with (REPAIR_PHOTO_DIR / name).open("wb") as f:
        shutil.copyfileobj(file.file, f)
    url = f"/evidence/repairs/{name}"
    det.repair_photo_url = url
    db.commit()
    out = repo.detection_payload(det)
    publish("defect.updated", {"detection": out})
    return {"photo_url": url, "detection": out}


# ---------------------------------------------------------------- direct drone (cooingdv / RC UFO)
_last_drone_probe: dict = {}


class DroneTestIn(BaseModel):
    ip: Optional[str] = None


class DroneCameraIn(BaseModel):
    lens: Literal["front", "bottom"]
    ip: Optional[str] = None


@router.get("/drone/status")
def drone_status(ip: Optional[str] = None):
    """Live link status while a drone_direct inspection runs; otherwise the last test result + detected IP."""
    from app.services.inspection_runner import runner
    from app.video.drone_link import detect_drone_ip

    src = runner.drone_source()
    if src is not None:
        st = src.link.status()
        return {**st, "active": True, "connected": src.connected, "reconnects": src.reconnects,
                "state": "streaming" if src.connected else "reconnecting"}
    det = detect_drone_ip(ip)
    last = {k: v for k, v in _last_drone_probe.items() if k != "preview_jpeg"}
    return {"active": False, "connected": False, "state": "idle", "detected_ip": det["ip"], "ip_source": det["source"],
            "warnings": det["warnings"], "gateways": det["gateways"], "last_test": last or None}


@router.post("/drone/test")
async def drone_test(body: DroneTestIn = DroneTestIn()):
    """Heartbeat + grab one frame (<= 8 s). Returns a JPEG preview (base64) and link info."""
    import asyncio
    import base64

    import cv2

    from app.services.inspection_runner import runner
    from app.video.drone_link import probe

    if runner.drone_source() is not None:
        raise HTTPException(409, "The drone is in use by the active inspection (one client at a time).")
    res = await asyncio.get_running_loop().run_in_executor(None, probe, body.ip, 8.0)
    frame = res.pop("frame", None)
    if frame is not None:
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
        res["preview_jpeg"] = "data:image/jpeg;base64," + base64.b64encode(buf.tobytes()).decode() if ok else None
    _last_drone_probe.clear()
    _last_drone_probe.update(res)
    publish("drone.status", {k: v for k, v in res.items() if k != "preview_jpeg"})
    return res


@router.post("/drone/camera")
def drone_camera(body: DroneCameraIn):
    """Select the front / bottom lens (0x06 0x01 / 0x06 0x02 on UDP 7099)."""
    from app.services.inspection_runner import runner
    from app.video.drone_link import DroneLink

    src = runner.drone_source()
    if src is not None:
        reopened = src.switch_camera(body.lens)
        return {"lens": body.lens, "reopened_stream": reopened, "active": True}
    link = DroneLink(body.ip)
    link.start()
    try:
        link.switch_camera(body.lens)
    finally:
        link.stop()
    return {"lens": body.lens, "reopened_stream": False, "active": False, "ip": link.ip}


@router.get("/aircraft/{aircraft_id}/maintenance")
def aircraft_maintenance(aircraft_id: str, db: Session = Depends(get_db)):
    if not repo.get_aircraft(db, aircraft_id):
        raise HTTPException(404, "Aircraft not found")
    return {**repo.aircraft_maintenance(db, aircraft_id), "currency": get_value(db, "cost")["currency"]}
