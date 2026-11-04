"""Data-access layer. API routes and services call these functions; no SQL lives in routes."""
from __future__ import annotations

import uuid
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.entities import Aircraft, Detection, Inspection


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
    db: Session, detection_id: str, status: str, reviewer: Optional[str], notes: Optional[str]
) -> Optional[Detection]:
    det = db.get(Detection, detection_id)
    if not det:
        return None
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

    by_cat = Counter({"crack": 0, "dent": 0, "corrosion": 0})
    by_status = Counter({"pending": 0, "reviewed": 0, "confirmed": 0, "false_positive": 0})
    by_section: Counter = Counter()
    hist = Counter()
    for d in detections:
        by_cat[d.category] += 1
        by_status[d.review_status] += 1
        by_section[d.section] += 1
        bucket = min(9, int(d.confidence * 10))
        hist[bucket] += 1

    # Daily trend over the span of the data (max 30 days)
    trend_map: Dict[str, dict] = defaultdict(
        lambda: {"inspections": 0, "crack": 0, "dent": 0, "corrosion": 0}
    )
    for i in inspections:
        trend_map[i.started_at.date().isoformat()]["inspections"] += 1
    for d in detections:
        trend_map[d.detected_at.date().isoformat()][d.category] += 1
    trend = [{"date": k, **v} for k, v in sorted(trend_map.items())][-30:]

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
            {"range": f"{b * 10}-{b * 10 + 10}%", "count": hist[b]} for b in range(4, 10)
        ],
    }
