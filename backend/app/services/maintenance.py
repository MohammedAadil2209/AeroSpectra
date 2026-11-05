"""Defect maintenance lifecycle (state machine).

Detected -> Confirmed -> Work order raised -> Repair in progress -> Repaired -> Verified & Cleared
plus False positive / Deferred (both require a reason). Every transition is stored as a
MaintenanceEvent (who, when, notes, actual cost & labour, optional after-repair photo).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

STATUSES = ["detected", "confirmed", "work_order", "repair_in_progress", "repaired", "cleared", "false_positive", "deferred"]
LABELS = {
    "detected": "Detected",
    "confirmed": "Confirmed",
    "work_order": "Work order raised",
    "repair_in_progress": "Repair in progress",
    "repaired": "Repaired",
    "cleared": "Verified & Cleared",
    "false_positive": "False positive",
    "deferred": "Deferred",
}
TRANSITIONS = {
    "detected": {"confirmed", "false_positive", "deferred"},
    "confirmed": {"work_order", "deferred", "false_positive"},
    "work_order": {"repair_in_progress", "deferred"},
    "repair_in_progress": {"repaired", "deferred"},
    "repaired": {"cleared", "repair_in_progress"},  # verification can send it back
    "cleared": set(),
    "false_positive": {"detected"},  # reopen
    "deferred": {"confirmed", "work_order", "detected"},
}
REASON_REQUIRED = {"false_positive", "deferred"}
OPEN_STATUSES = {"detected", "confirmed", "work_order", "repair_in_progress", "repaired", "deferred"}


class TransitionError(ValueError):
    pass


def allowed(from_status: str) -> list:
    return sorted(TRANSITIONS.get(from_status, set()), key=STATUSES.index)


def validate(from_status: str, to_status: str, reason: str = "") -> None:
    if to_status not in STATUSES:
        raise TransitionError(f"Unknown status '{to_status}'.")
    if to_status not in TRANSITIONS.get(from_status, set()):
        raise TransitionError(
            f"Cannot move from '{LABELS.get(from_status, from_status)}' to '{LABELS[to_status]}'. "
            f"Allowed: {', '.join(LABELS[s] for s in allowed(from_status)) or 'none (final)'}."
        )
    if to_status in REASON_REQUIRED and not (reason or "").strip():
        raise TransitionError(f"A reason is required for '{LABELS[to_status]}'.")


def apply(det, to_status: str, actor: str = "", notes: str = "", reason: str = "",
          actual_cost: Optional[float] = None, actual_labour_hours: Optional[float] = None,
          photo_url: Optional[str] = None, force: bool = False) -> dict:
    """Mutates ORM detection `det`; returns the event fields to persist (caller creates MaintenanceEvent)."""
    from_status = det.maintenance_status or "detected"
    if not force:
        validate(from_status, to_status, reason)
    now = datetime.utcnow()
    det.maintenance_status = to_status
    if actual_cost is not None:
        det.actual_cost = float(actual_cost)
    if actual_labour_hours is not None:
        det.actual_labour_hours = float(actual_labour_hours)
    if photo_url:
        det.repair_photo_url = photo_url
    # keep the human-review status consistent with the lifecycle
    if to_status == "false_positive":
        det.review_status = "false_positive"
        det.reviewed_at = now
    elif to_status in ("confirmed", "work_order", "repair_in_progress", "repaired", "cleared"):
        det.review_status = "confirmed"
        det.reviewed_at = det.reviewed_at or now
    elif to_status == "detected" and det.review_status == "false_positive":
        det.review_status = "pending"
        det.reviewed_at = None
    if actor:
        det.reviewer = det.reviewer or actor
    if to_status == "cleared":
        det.cleared_at, det.cleared_by = now, actor or "unknown"
    return {
        "detection_id": det.id,
        "aircraft_id": det.aircraft_id,
        "from_status": from_status,
        "to_status": to_status,
        "actor": actor or "unknown",
        "at": now,
        "notes": notes or "",
        "reason": reason or "",
        "actual_cost": actual_cost,
        "actual_labour_hours": actual_labour_hours,
        "photo_url": photo_url,
        "is_demo": det.is_demo,
    }


def status_from_review(review_status: str, current: str) -> Optional[str]:
    """Map a review-drawer decision to a lifecycle status (only for early stages)."""
    if current not in ("detected", "confirmed", "false_positive"):
        return None
    if review_status == "confirmed" and current != "confirmed":
        return "confirmed"
    if review_status == "false_positive" and current != "false_positive":
        return "false_positive"
    if review_status == "pending" and current in ("confirmed", "false_positive"):
        return "detected"
    return None
