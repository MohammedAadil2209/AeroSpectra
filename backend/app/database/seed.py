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
