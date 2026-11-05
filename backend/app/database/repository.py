"""Data-access layer. API routes and services call these functions; no SQL lives in routes."""
from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import Aircraft, Detection, Inspection, MaintenanceEvent
from app.services import cost as cost_engine
from app.services import maintenance as mx
from app.services import risk as risk_engine
from app.services.settings_store import get_value


def new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8].upper()}"


# ---------------------------------------------------------------- aircraft
def list_aircraft(db: Session, is_demo: bool) -> List[dict]:
    rows = db.scalars(select(Aircraft).where(Aircraft.is_demo == is_demo).order_by(Aircraft.id)).all()
    return [aircraft_summary(db, a) for a in rows]


def get_aircraft(db: Session, aircraft_id: str) -> Optional[Aircraft]:
    return db.get(Aircraft, aircraft_id)


def aircraft_summary(db: Session, a: Aircraft) -> dict:
    insp_count, last = db.execute(
        select(func.count(Inspection.id), func.max(Inspection.started_at)).where(
            Inspection.aircraft_id == a.id
        )
    ).one()
    finding_count = db.scalar(
        select(func.count(Detection.id)).where(
            Detection.aircraft_id == a.id, Detection.review_status != "false_positive"
        )
    )
    open_count = db.scalar(
        select(func.count(Detection.id)).where(
            Detection.aircraft_id == a.id, Detection.review_status == "pending"
        )
    )
    return {
        "id": a.id,
        "registration": a.registration,
        "model": a.model,
        "operator": a.operator,
        "base": a.base,
        "is_demo": a.is_demo,
        "inspection_count": insp_count or 0,
        "finding_count": finding_count or 0,
        "open_finding_count": open_count or 0,
        "last_inspection_at": last,
    }


def ensure_real_aircraft(db: Session, aircraft_id: str) -> Aircraft:
    """Real inspections need a real aircraft record. Create a placeholder if unknown."""
    a = db.get(Aircraft, aircraft_id)
    if a is None:
        a = Aircraft(id=aircraft_id, registration=aircraft_id, model="Unspecified", is_demo=False)
        db.add(a)
        db.flush()
    return a


# ---------------------------------------------------------------- inspections
def list_inspections(
    db: Session, is_demo: bool, aircraft_id: Optional[str] = None, status: Optional[str] = None
) -> List[Inspection]:
    q = select(Inspection).where(Inspection.is_demo == is_demo)
    if aircraft_id:
        q = q.where(Inspection.aircraft_id == aircraft_id)
    if status:
        q = q.where(Inspection.status == status)
    return list(db.scalars(q.order_by(Inspection.started_at.desc())).all())


def detection_counts(db: Session, inspection_ids: Sequence[str]) -> Dict[str, int]:
    if not inspection_ids:
        return {}
    rows = db.execute(
        select(Detection.inspection_id, func.count(Detection.id))
        .where(Detection.inspection_id.in_(inspection_ids))
        .group_by(Detection.inspection_id)
    ).all()
    return {r[0]: r[1] for r in rows}


def get_inspection(db: Session, inspection_id: str) -> Optional[Inspection]:
    return db.scalars(
        select(Inspection)
        .where(Inspection.id == inspection_id)
        .options(selectinload(Inspection.detections), selectinload(Inspection.aircraft))
    ).first()


def create_inspection(db: Session, **fields) -> Inspection:
    insp = Inspection(id=new_id("INS"), **fields)
    db.add(insp)
    db.flush()
    return insp


def finish_inspection(
    db: Session,
    inspection_id: str,
    status: str,
    duration_s: float,
    frames: int,
    sections: List[str],
    recording_url: Optional[str],
    error: Optional[str] = None,
) -> None:
    insp = db.get(Inspection, inspection_id)
    if not insp:
        return
    insp.status = status
    insp.ended_at = datetime.utcnow()
    insp.duration_s = round(duration_s, 1)
    insp.frames_processed = frames
    insp.sections_inspected = sections
    if recording_url:
        insp.recording_url = recording_url
    if error:
        insp.error = error


def update_inspection_progress(db: Session, inspection_id: str, **fields) -> None:
    insp = db.get(Inspection, inspection_id)
    if insp:
        for k, v in fields.items():
            setattr(insp, k, v)


def mark_orphaned_inspections(db: Session) -> int:
    """Inspections left 'active' by a crashed/restarted server are marked aborted."""
    rows = db.scalars(select(Inspection).where(Inspection.status.in_(["active", "paused"]), Inspection.is_demo == False)).all()  # noqa: E712
    for r in rows:
        r.status = "aborted"
        r.error = r.error or "Backend restarted while inspection was running."
        r.ended_at = r.ended_at or datetime.utcnow()
    return len(rows)


# ---------------------------------------------------------------- detections
def list_detections(
    db: Session,
    is_demo: bool,
    category: Optional[str] = None,
    review_status: Optional[str] = None,
    aircraft_id: Optional[str] = None,
    inspection_id: Optional[str] = None,
    min_confidence: Optional[float] = None,
    max_confidence: Optional[float] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    q: Optional[str] = None,
    limit: int = 1000,
) -> List[Detection]:
    stmt = select(Detection).where(Detection.is_demo == is_demo)
    if category:
        stmt = stmt.where(Detection.category == category)
    if review_status:
        stmt = stmt.where(Detection.review_status == review_status)
    if aircraft_id:
        stmt = stmt.where(Detection.aircraft_id == aircraft_id)
    if inspection_id:
        stmt = stmt.where(Detection.inspection_id == inspection_id)
    if min_confidence is not None:
        stmt = stmt.where(Detection.confidence >= min_confidence)
    if max_confidence is not None:
        stmt = stmt.where(Detection.confidence <= max_confidence)
    if date_from:
        stmt = stmt.where(Detection.detected_at >= date_from)
    if date_to:
        stmt = stmt.where(Detection.detected_at < date_to + timedelta(days=1))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            Detection.id.ilike(like)
            | Detection.aircraft_id.ilike(like)
            | Detection.inspection_id.ilike(like)
            | Detection.section.ilike(like)
        )
    return list(db.scalars(stmt.order_by(Detection.detected_at.desc()).limit(limit)).all())


def get_detection(db: Session, detection_id: str) -> Optional[Detection]:
    return db.get(Detection, detection_id)


def add_detection(db: Session, **fields) -> Detection:
    fields.setdefault("id", new_id("DET"))
    det = Detection(**fields)
    db.add(det)
    db.flush()
    return det


def review_detection(
    db: Session, detection_id: str, status: str, reviewer: Optional[str], notes: Optional[str],
    category: Optional[str] = None,
) -> Optional[Detection]:
    det = db.get(Detection, detection_id)
    if not det:
        return None
    if category and category != det.category:
        det.original_category = det.original_category or det.category
        det.category = category
        score_detection(db, det)
    target = mx.status_from_review(status, det.maintenance_status or "detected")
    if target:
        ev = mx.apply(det, target, actor=reviewer or "", notes=notes or "Set from review drawer", force=True)
        db.add(MaintenanceEvent(id=new_id("MXE"), **ev))
    det.review_status = status
    if reviewer is not None:
        det.reviewer = reviewer
    if notes is not None:
        det.reviewer_notes = notes
    det.reviewed_at = None if status == "pending" else datetime.utcnow()
    db.flush()
    return det


# ---------------------------------------------------------------- analytics
def analytics(db: Session, is_demo: bool) -> dict:
    inspections = db.scalars(select(Inspection).where(Inspection.is_demo == is_demo)).all()
    detections = db.scalars(select(Detection).where(Detection.is_demo == is_demo)).all()

    by_cat = Counter({"crack": 0, "dent": 0, "corrosion": 0, "defect": 0})
    by_risk = Counter({lv: 0 for lv in risk_engine.LEVELS})
    by_mx = Counter({k: 0 for k in mx.STATUSES})
    est_lo = est_hi = act = 0.0
    by_status = Counter({"pending": 0, "reviewed": 0, "confirmed": 0, "false_positive": 0})
    by_section: Counter = Counter()
    hist = Counter()
    for d in detections:
        by_cat[d.category] += 1
        by_status[d.review_status] += 1
        by_section[d.section] += 1
        bucket = min(9, int(d.confidence * 10))
        hist[bucket] += 1
        by_mx[d.maintenance_status or "detected"] += 1
        if d.review_status != "false_positive" and d.maintenance_status != "false_positive":
            by_risk[d.risk_level or "low"] += 1
            est_lo += d.cost_min or 0
            est_hi += d.cost_max or 0
            act += d.actual_cost or 0

    # Daily trend over the span of the data (max 30 days)
    trend_map: Dict[str, dict] = defaultdict(
        lambda: {"inspections": 0, "crack": 0, "dent": 0, "corrosion": 0, "defect": 0}
    )
    oc_map: Dict[str, dict] = defaultdict(lambda: {"detected": 0, "cleared": 0})
    for i in inspections:
        trend_map[i.started_at.date().isoformat()]["inspections"] += 1
    for d in detections:
        trend_map[d.detected_at.date().isoformat()][d.category] += 1
        if d.review_status != "false_positive":
            oc_map[d.detected_at.date().isoformat()]["detected"] += 1
        if d.cleared_at:
            oc_map[d.cleared_at.date().isoformat()]["cleared"] += 1
    trend = [{"date": k, **v} for k, v in sorted(trend_map.items())][-30:]
    open_running = 0
    oc_trend = []
    for k, v in sorted(oc_map.items()):
        open_running += v["detected"] - v["cleared"]
        oc_trend.append({"date": k, "new": v["detected"], "cleared": v["cleared"], "open": open_running})
    open_n = sum(by_mx[st] for st in mx.OPEN_STATUSES)

    return {
        "scope": "demo" if is_demo else "real",
        "total_inspections": len(inspections),
        "completed_inspections": sum(1 for i in inspections if i.status == "completed"),
        "active_inspections": sum(1 for i in inspections if i.status in ("active", "paused")),
        "total_detections": len(detections),
        "high_priority": sum(
            1 for d in detections if d.priority == "high" and d.review_status != "false_positive"
        ),
        "pending_reviews": by_status["pending"],
        "reviewed": by_status["reviewed"],
        "confirmed": by_status["confirmed"],
        "false_positives": by_status["false_positive"],
        "by_category": dict(by_cat),
        "by_status": dict(by_status),
        "by_section": dict(by_section.most_common()),
        "trend": trend,
        "confidence_histogram": [
            {"range": f"{b * 10}-{b * 10 + 10}%", "count": hist[b]} for b in range(2, 10)
        ],
        "by_risk": dict(by_risk),
        "by_maintenance": dict(by_mx),
        "open_defects": open_n,
        "cleared_defects": by_mx["cleared"],
        "open_vs_cleared_trend": oc_trend[-30:],
        "estimated_cost_min": round(est_lo),
        "estimated_cost_max": round(est_hi),
        "actual_cost": round(act),
        "currency": get_value(db, "cost")["currency"],
    }


# ---------------------------------------------------------------- payloads
def detection_payload(det: Detection) -> dict:
    from app.schemas.api import DetectionOut

    out = DetectionOut.model_validate(det).model_dump()
    out["recommendation"] = risk_engine.RECOMMENDATIONS.get(det.risk_level or "low", "")
    return out


def inspection_payload(db: Session, insp: Inspection) -> dict:
    from app.schemas.api import InspectionOut

    data = InspectionOut.model_validate(insp).model_dump()
    data["detection_count"] = detection_counts(db, [insp.id]).get(insp.id, 0)
    return data


# ---------------------------------------------------------------- risk + cost
def score_detection(db: Session, det: Detection, risk_cfg: Optional[dict] = None, cost_cfg: Optional[dict] = None) -> dict:
    """Compute risk (with clustering/recurrence context from the DB) and cost for one detection."""
    risk_cfg = risk_cfg or get_value(db, "risk")
    cost_cfg = cost_cfg or get_value(db, "cost")
    peers = db.scalars(
        select(Detection).where(
            Detection.aircraft_id == det.aircraft_id, Detection.section == det.section, Detection.id != det.id
        )
    ).all()
    n, p = risk_engine.context_counts(det, peers, risk_cfg)
    r = risk_engine.apply_to(det, risk_cfg, n, p)
    cost_engine.apply_to(det, cost_cfg)
    return r


def rescore_all(db: Session, is_demo: Optional[bool] = None, risk_cfg: Optional[dict] = None) -> dict:
    risk_cfg = risk_cfg or get_value(db, "risk")
    cost_cfg = get_value(db, "cost")
    stmt = select(Detection)
    if is_demo is not None:
        stmt = stmt.where(Detection.is_demo == is_demo)
    dets = list(db.scalars(stmt).all())
    changed = risk_engine.rescore(dets, risk_cfg)
    for d in dets:
        cost_engine.apply_to(d, cost_cfg)
    db.flush()
    live = ({"risk_level": d.risk_level} for d in dets if d.review_status != "false_positive")
    return {"changed": changed, "total": len(dets), "counts": risk_engine.summarize(live)}


def recost_all(db: Session) -> int:
    cfg = get_value(db, "cost")
    dets = list(db.scalars(select(Detection)).all())
    for d in dets:
        cost_engine.apply_to(d, cfg)
    db.flush()
    return len(dets)


def risk_preview(db: Session, risk_cfg: dict, is_demo: bool) -> dict:
    dets = list(db.scalars(select(Detection).where(Detection.is_demo == is_demo)).all())
    scored = risk_engine.preview(dets, risk_cfg)
    live = [sc for sc, d in zip(scored, dets) if d.review_status != "false_positive"]
    return {"counts": risk_engine.summarize(live), "detections": scored}


# ---------------------------------------------------------------- maintenance
def transition(db: Session, det: Detection, to_status: str, **kw) -> MaintenanceEvent:
    ev = mx.apply(det, to_status, **kw)
    row = MaintenanceEvent(id=new_id("MXE"), **ev)
    db.add(row)
    db.flush()
    return row


def event_payload(e: MaintenanceEvent) -> dict:
    return {c.name: getattr(e, c.name) for c in e.__table__.columns}


def maintenance_events(db: Session, detection_id: Optional[str] = None, aircraft_id: Optional[str] = None) -> List[dict]:
    stmt = select(MaintenanceEvent)
    if detection_id:
        stmt = stmt.where(MaintenanceEvent.detection_id == detection_id)
    if aircraft_id:
        stmt = stmt.where(MaintenanceEvent.aircraft_id == aircraft_id)
    return [event_payload(e) for e in db.scalars(stmt.order_by(MaintenanceEvent.at.desc())).all()]


def aircraft_maintenance(db: Session, aircraft_id: str) -> dict:
    dets = list(
        db.scalars(select(Detection).where(Detection.aircraft_id == aircraft_id).order_by(Detection.detected_at)).all()
    )
    events = maintenance_events(db, aircraft_id=aircraft_id)
    timeline = [
        {"kind": "detected", "at": d.detected_at, "detection_id": d.id, "category": d.category, "section": d.section,
         "risk_level": d.risk_level, "inspection_id": d.inspection_id, "cost_min": d.cost_min, "cost_max": d.cost_max}
        for d in dets
    ]
    timeline += [{"kind": "transition", **e} for e in events]
    timeline.sort(key=lambda x: x["at"] or datetime.min, reverse=True)
    sections: Dict[str, dict] = defaultdict(lambda: {"total": 0, "open": 0, "cleared": 0, "inspections": set()})
    for d in dets:
        if d.review_status == "false_positive":
            continue
        sec = sections[d.section]
        sec["total"] += 1
        sec["inspections"].add(d.inspection_id)
        if d.maintenance_status == "cleared":
            sec["cleared"] += 1
        elif d.maintenance_status in mx.OPEN_STATUSES:
            sec["open"] += 1
    by_section = [
        {"section": k, "total": v["total"], "open": v["open"], "cleared": v["cleared"],
         "inspections": len(v["inspections"]), "recurring": len(v["inspections"]) > 1}
        for k, v in sorted(sections.items(), key=lambda kv: -kv[1]["total"])
    ]
    live = [d for d in dets if d.review_status != "false_positive"]
    return {
        "aircraft_id": aircraft_id,
        "timeline": timeline,
        "by_section": by_section,
        "estimated_cost_min": round(sum(d.cost_min or 0 for d in live)),
        "estimated_cost_max": round(sum(d.cost_max or 0 for d in live)),
        "actual_cost": round(sum(d.actual_cost or 0 for d in live)),
        "estimated_labour_hours": round(sum(d.labour_hours or 0 for d in live), 1),
        "actual_labour_hours": round(sum(d.actual_labour_hours or 0 for d in live), 1),
        "estimate_vs_actual": [
            {"detection_id": d.id, "category": d.category, "section": d.section,
             "estimate_min": d.cost_min, "estimate_max": d.cost_max, "actual": d.actual_cost}
            for d in live if d.actual_cost is not None
        ],
        "open": sum(1 for d in live if d.maintenance_status in mx.OPEN_STATUSES),
        "cleared": sum(1 for d in live if d.maintenance_status == "cleared"),
    }


def sync_maintenance_from_review(db: Session) -> int:
    """One-time alignment for pre-v1.1 records: lifecycle status follows the existing review decision."""
    rows = db.scalars(select(Detection).where(Detection.maintenance_status.in_(["detected", None]))).all()
    n = 0
    for d in rows:
        if d.review_status == "confirmed":
            d.maintenance_status = "confirmed"
            n += 1
        elif d.review_status == "false_positive":
            d.maintenance_status = "false_positive"
            n += 1
        elif d.maintenance_status is None:
            d.maintenance_status = "detected"
    return n
