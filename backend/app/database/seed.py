"""Load the fictional demo dataset (shared/demo-seed.json) into the DB once."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select

from app.config import DEMO_SEED_PATH
from app.database.session import session_scope
from app.models.entities import Aircraft, Detection, Inspection

log = logging.getLogger("aerospectra.seed")


def _at(now: datetime, hours_ago):
    return None if hours_ago is None else now - timedelta(hours=float(hours_ago))


def seed_demo(force: bool = False) -> int:
    if not DEMO_SEED_PATH.exists():
        log.warning("Demo seed not found at %s; demo scope will be empty", DEMO_SEED_PATH)
        return 0
    with session_scope() as db:
        existing = db.scalar(select(func.count(Aircraft.id)).where(Aircraft.is_demo == True))  # noqa: E712
        if existing and not force:
            return 0
        if force:
            db.execute(delete(Detection).where(Detection.is_demo == True))  # noqa: E712
            db.execute(delete(Inspection).where(Inspection.is_demo == True))  # noqa: E712
            db.execute(delete(Aircraft).where(Aircraft.is_demo == True))  # noqa: E712
        data = json.loads(DEMO_SEED_PATH.read_text())
        now = datetime.utcnow()
        for a in data["aircraft"]:
            db.add(Aircraft(**a))
        for i in data["inspections"]:
            i = dict(i)
            started = _at(now, i.pop("started_offset_h"))
            db.add(Inspection(**i, started_at=started, ended_at=started + timedelta(seconds=i["duration_s"])))
        for d in data["detections"]:
            d = dict(d)
            detected = _at(now, d.pop("detected_offset_h"))
            reviewed = _at(now, d.pop("reviewed_offset_h"))
            db.add(Detection(**d, detected_at=detected, reviewed_at=reviewed))
        log.info("Seeded demo dataset: %d detections", len(data["detections"]))
        return len(data["detections"])


def seed_demo_maintenance() -> int:
    """Fictional maintenance history for DEMO detections (work orders, repairs, clearances), once."""
    from app.database.repository import new_id
    from app.models.entities import MaintenanceEvent
    from app.services import maintenance as mx

    with session_scope() as db:
        if db.scalar(select(func.count(MaintenanceEvent.id)).where(MaintenanceEvent.is_demo == True)):  # noqa: E712
            return 0
        dets = db.scalars(
            select(Detection).where(Detection.is_demo == True, Detection.review_status == "confirmed")  # noqa: E712
            .order_by(Detection.detected_at)
        ).all()
        n = 0
        crews = ["Eng. R. Iyer (demo)", "Eng. S. Khan (demo)", "Insp. M. Rao (demo)"]
        for i, d in enumerate(dets):
            frac = i / max(1, len(dets))
            if frac < 0.45:
                path = ["work_order", "repair_in_progress", "repaired", "cleared"]
            elif frac < 0.65:
                path = ["work_order", "repair_in_progress"]
            elif frac < 0.8:
                path = ["work_order"]
            else:
                continue
            t = d.detected_at
            d.maintenance_status = "confirmed"
            for k, st in enumerate(path):
                t = t + timedelta(hours=6 + 10 * k)
                actual = None
                hours = None
                if st in ("repaired",):
                    mid = ((d.cost_min or 20000) + (d.cost_max or 60000)) / 2
                    actual = round(mid * (0.75 + 0.5 * ((i * 37) % 100) / 100), -2)
                    hours = round((d.labour_hours or 4) * (0.8 + 0.4 * ((i * 53) % 100) / 100), 1)
                ev = mx.apply(d, st, actor=crews[(i + k) % 3], notes=f"WO-DEMO-{1000 + i}" if st == "work_order" else "",
                              actual_cost=actual, actual_labour_hours=hours, force=True)
                ev["at"] = t
                if st == "cleared":
                    d.cleared_at = t
                db.add(MaintenanceEvent(id=new_id("MXE"), **ev))
                n += 1
        log.info("Seeded %d demo maintenance events", n)
        return n
