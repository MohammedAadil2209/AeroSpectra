"""Versioned JSON settings with an audit trail (who changed what, when).

Keys: "risk" (risk engine weights/thresholds/tables), "cost" (cost & ROI assumptions).
Stored values are deep-merged over the code defaults, so new options appear automatically.
"""
from __future__ import annotations

import copy
from datetime import datetime
from typing import Any, Dict

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.entities import AppSetting, SettingAudit


def _defaults(key: str) -> dict:
    if key == "risk":
        from app.services.risk import DEFAULT_RISK_CONFIG
        return copy.deepcopy(DEFAULT_RISK_CONFIG)
    if key == "cost":
        from app.services.cost import DEFAULT_COST_CONFIG
        return copy.deepcopy(DEFAULT_COST_CONFIG)
    raise KeyError(key)


def deep_merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def _diff(old: Any, new: Any, path: str = "") -> Dict[str, list]:
    if isinstance(old, dict) and isinstance(new, dict):
        out: Dict[str, list] = {}
        for k in set(old) | set(new):
            out.update(_diff(old.get(k), new.get(k), f"{path}.{k}" if path else str(k)))
        return out
    return {} if old == new else {path: [old, new]}


def get_setting(db: Session, key: str) -> dict:
    row = db.get(AppSetting, key)
    value = deep_merge(_defaults(key), row.value if row else {})
    return {
        "key": key,
        "value": value,
        "version": row.version if row else 0,
        "updated_by": row.updated_by if row else "system",
        "updated_at": row.updated_at if row else None,
    }


def get_value(db: Session, key: str) -> dict:
    return get_setting(db, key)["value"]


def put_setting(db: Session, key: str, value: dict, actor: str = "", note: str = "") -> dict:
    current = get_setting(db, key)
    merged = deep_merge(_defaults(key), value)
    changes = _diff(current["value"], merged)
    row = db.get(AppSetting, key)
    if row is None:
        row = AppSetting(key=key, value=merged, version=1, updated_by=actor or "unknown", updated_at=datetime.utcnow())
        db.add(row)
    else:
        if not changes:
            return get_setting(db, key)
        row.value = merged
        row.version += 1
        row.updated_by = actor or "unknown"
        row.updated_at = datetime.utcnow()
    db.add(SettingAudit(key=key, version=row.version, changed_by=actor or "unknown", changes=changes, note=note))
    db.flush()
    return get_setting(db, key)


def audit_log(db: Session, key: str, limit: int = 50) -> list:
    rows = db.scalars(
        select(SettingAudit).where(SettingAudit.key == key).order_by(SettingAudit.id.desc()).limit(limit)
    ).all()
    return [
        {"version": r.version, "changed_by": r.changed_by, "changed_at": r.changed_at, "changes": r.changes, "note": r.note}
        for r in rows
    ]
