"""Risk engine: 0-100 ADVISORY risk score + level for every potential defect.

score = 100 * sum(w_i * f_i) / sum(w_i), each factor f_i in [0, 1]:
  severity    defect-type severity table           (crack > corrosion > dent > generic defect)
  size        bbox area fraction / size_ref         (bigger = riskier, capped at 1)
  section     aircraft-section criticality table   (engine / wing root highest)
  confidence  AI confidence
  cluster     other findings in the same inspection + section within cluster_window_s
  recurrence  findings on the same aircraft + section in OTHER (earlier) inspections

The breakdown stores each factor's value, weight and points so the UI can show
"why this score". This is a triage aid for engineers, NOT an airworthiness decision.
"""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, Iterable, List

DEFAULT_RISK_CONFIG: dict = {
    "weights": {"severity": 30, "size": 15, "section": 20, "confidence": 15, "cluster": 10, "recurrence": 10},
    "thresholds": {"medium": 55, "high": 65, "critical": 75},
    "severity": {"crack": 1.0, "corrosion": 0.75, "dent": 0.55, "defect": 0.5},
    "section_criticality": {
        "Left Engine": 1.0,
        "Right Engine": 1.0,
        "Wing Root": 1.0,
        "Left Wing": 0.85,
        "Right Wing": 0.85,
        "Fuselage": 0.85,
        "Nose & Cockpit": 0.75,
        "Tail": 0.7,
        "Stabilizers": 0.7,
        "Unassigned": 0.5,
    },
    "size_ref": 0.05,  # bbox covering >= 5% of the frame counts as "large"
    "cluster_ref": 3,  # 3+ neighbours = full cluster factor
    "cluster_window_s": 10.0,
    "recurrence_ref": 2,  # 2+ prior findings in that section = full recurrence factor
}

LEVELS = ("low", "medium", "high", "critical")
RECOMMENDATIONS = {
    "critical": "ADVISORY: Engineer inspection required before next flight. Raise a work order and consider detailed NDT.",
    "high": "ADVISORY: Schedule an engineer inspection at the earliest maintenance opportunity; consider NDT.",
    "medium": "ADVISORY: Add to the next planned maintenance check; monitor for growth.",
    "low": "ADVISORY: Record and monitor during routine inspections.",
}
DISCLAIMER = "Advisory triage score for human review. Not an airworthiness or maintenance-release decision."

PRESETS = {
    "conservative": {
        "weights": {"severity": 30, "size": 15, "section": 25, "confidence": 5, "cluster": 12, "recurrence": 13},
        "thresholds": {"medium": 45, "high": 55, "critical": 66},
    },
    "balanced": {"weights": dict(DEFAULT_RISK_CONFIG["weights"]), "thresholds": dict(DEFAULT_RISK_CONFIG["thresholds"])},
    "aggressive": {
        "weights": {"severity": 30, "size": 15, "section": 15, "confidence": 25, "cluster": 8, "recurrence": 7},
        "thresholds": {"medium": 60, "high": 72, "critical": 82},
    },
}


def level_for(score: float, cfg: dict) -> str:
    t = cfg["thresholds"]
    if score >= t["critical"]:
        return "critical"
    if score >= t["high"]:
        return "high"
    if score >= t["medium"]:
        return "medium"
    return "low"


def score_detection(det: dict, cfg: dict, neighbours: int = 0, prior: int = 0) -> dict:
    """det needs: category, confidence, bbox{w,h}, section. Returns {score, level, breakdown, recommendation}."""
    bbox = det.get("bbox") or {}
    area = max(0.0, float(bbox.get("w", 0)) * float(bbox.get("h", 0)))
    sev_table = cfg["severity"]
    sec_table = cfg["section_criticality"]
    factors = {
        "severity": float(sev_table.get(det.get("category") or "defect", sev_table.get("defect", 0.5))),
        "size": min(1.0, area / max(1e-6, float(cfg["size_ref"]))),
        "section": float(sec_table.get(det.get("section") or "Unassigned", sec_table.get("Unassigned", 0.5))),
        "confidence": max(0.0, min(1.0, float(det.get("confidence") or 0))),
        "cluster": min(1.0, neighbours / max(1.0, float(cfg["cluster_ref"]))),
        "recurrence": min(1.0, prior / max(1.0, float(cfg["recurrence_ref"]))),
    }
    weights = {k: max(0.0, float(cfg["weights"].get(k, 0))) for k in factors}
    total_w = sum(weights.values()) or 1.0
    breakdown: Dict[str, dict] = {}
    score = 0.0
    for k, f in factors.items():
        pts = 100.0 * weights[k] * f / total_w
        score += pts
        breakdown[k] = {"value": round(f, 3), "weight": weights[k], "points": round(pts, 1)}
    breakdown["_context"] = {"neighbours": neighbours, "prior_findings": prior, "area_pct": round(area * 100, 2)}
    score = round(min(100.0, score), 1)
    level = level_for(score, cfg)
    return {"score": score, "level": level, "breakdown": breakdown, "recommendation": RECOMMENDATIONS[level]}


def _t(d) -> float:
    return float(getattr(d, "video_time_s", 0) or 0)


def context_counts(target, peers: Iterable, cfg: dict) -> tuple:
    """(neighbours, prior) for detection `target` against peers (same aircraft+section expected)."""
    win = float(cfg["cluster_window_s"])
    neigh = prior = 0
    for p in peers:
        if p.id == target.id or p.review_status == "false_positive" or p.aircraft_id != target.aircraft_id:
            continue
        if p.section != target.section:
            continue
        if p.inspection_id == target.inspection_id:
            if abs(_t(p) - _t(target)) <= win:
                neigh += 1
        elif p.detected_at and target.detected_at and p.detected_at < target.detected_at:
            prior += 1
    return neigh, prior


def _as_input(d) -> dict:
    return {"category": d.category, "confidence": d.confidence, "bbox": d.bbox, "section": d.section}


def apply_to(det, cfg: dict, neighbours: int, prior: int) -> dict:
    r = score_detection(_as_input(det), cfg, neighbours, prior)
    det.risk_score, det.risk_level, det.risk_breakdown = r["score"], r["level"], r["breakdown"]
    return r


def _groups(detections: List) -> Dict[tuple, list]:
    groups: Dict[tuple, list] = defaultdict(list)
    for d in detections:
        groups[(d.aircraft_id, d.section)].append(d)
    return groups


def rescore(detections: List, cfg: dict) -> int:
    """Re-score ORM detections in place. Returns how many changed score or level."""
    groups = _groups(detections)
    changed = 0
    for d in detections:
        n, p = context_counts(d, groups[(d.aircraft_id, d.section)], cfg)
        old = (d.risk_score, d.risk_level)
        apply_to(d, cfg, n, p)
        changed += old != (d.risk_score, d.risk_level)
    return changed


def preview(detections: List, cfg: dict) -> List[dict]:
    """Score without mutating (live preview while dragging sliders)."""
    groups = _groups(detections)
    out = []
    for d in detections:
        n, p = context_counts(d, groups[(d.aircraft_id, d.section)], cfg)
        r = score_detection(_as_input(d), cfg, n, p)
        out.append({"id": d.id, "risk_score": r["score"], "risk_level": r["level"], "category": d.category,
                    "section": d.section, "aircraft_id": d.aircraft_id, "is_demo": d.is_demo})
    return out


def summarize(scored: Iterable[dict]) -> dict:
    counts = {lv: 0 for lv in LEVELS}
    for s in scored:
        counts[s["risk_level"]] = counts.get(s["risk_level"], 0) + 1
    return counts
