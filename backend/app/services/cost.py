"""Cost estimation & ROI. Every output is an ESTIMATE based on editable assumptions (Settings > Cost).

Per detection:  repair cost range (parts/materials + labour_hours * labour_rate) by defect type x risk level.
Per inspection: sum of its detections.
ROI:            manual vs drone inspection cost/time, ground-time value, AOG hours avoided by early detection,
                subscription cost, payback period, ROI %, and an AeroSpectra revenue projection.
"""
from __future__ import annotations

from typing import Dict, Iterable, Optional

_LEVEL_MULT = {"low": 1.0, "medium": 2.0, "high": 4.0, "critical": 8.0}
_BASE = {  # (parts min, parts max, labour hours) at "low" risk, INR
    "crack": (15000, 40000, 4.0),
    "corrosion": (10000, 30000, 3.0),
    "dent": (8000, 25000, 2.5),
    "defect": (8000, 30000, 3.0),
}


def _default_repair_table() -> Dict[str, Dict[str, dict]]:
    out: Dict[str, Dict[str, dict]] = {}
    for cat, (lo, hi, h) in _BASE.items():
        out[cat] = {}
        for lv, m in _LEVEL_MULT.items():
            out[cat][lv] = {"min": round(lo * m), "max": round(hi * m), "labour_h": round(h * (1 + (m - 1) * 0.5), 1)}
    return out


DEFAULT_COST_CONFIG: dict = {
    "currency": "INR",
    "currency_symbol": "₹",
    "labour_rate": 2500,  # per engineer-hour
    "aog_cost_per_hour": 500000,  # aircraft-on-ground cost per hour (narrow-body estimate)
    "ground_time_value_fraction": 0.02,  # share of AOG rate that a saved hour of scheduled ground time is worth
    "repair": _default_repair_table(),
    "manual_inspection": {"hours": 6.0, "crew": 3, "other_cost": 15000},  # per aircraft visual walk-around + lift
    "drone_inspection": {"hours": 1.0, "crew": 1, "other_cost": 4000},
    "early_detection_aog_hours_avoided_per_aircraft_month": 0.1,  # estimate
    "inspections_per_aircraft_month": 2,
    "setup_cost": 600000,  # drone kit + onboarding, one-time
    "subscription_tiers": [
        {"name": "Starter", "max_aircraft": 10, "price_per_aircraft_month": 25000},
        {"name": "Professional", "max_aircraft": 50, "price_per_aircraft_month": 20000},
        {"name": "Enterprise", "max_aircraft": 100000, "price_per_aircraft_month": 15000},
    ],
}


def estimate(category: str, level: str, cfg: dict) -> dict:
    table = cfg["repair"].get(category) or cfg["repair"]["defect"]
    row = table.get(level) or table["low"]
    labour_cost = row["labour_h"] * cfg["labour_rate"]
    return {
        "cost_min": round(row["min"] + labour_cost),
        "cost_max": round(row["max"] + labour_cost),
        "labour_hours": row["labour_h"],
        "currency": cfg["currency"],
    }


def apply_to(det, cfg: dict) -> dict:
    e = estimate(det.category, det.risk_level or "low", cfg)
    det.cost_min, det.cost_max, det.labour_hours = e["cost_min"], e["cost_max"], e["labour_hours"]
    return e


def inspection_totals(detections: Iterable) -> dict:
    lo = hi = h = 0.0
    act = 0.0
    n = 0
    for d in detections:
        if d.review_status == "false_positive" or d.maintenance_status == "false_positive":
            continue
        n += 1
        lo += d.cost_min or 0
        hi += d.cost_max or 0
        h += d.labour_hours or 0
        act += d.actual_cost or 0
    return {"count": n, "cost_min": round(lo), "cost_max": round(hi), "labour_hours": round(h, 1), "actual_cost": round(act)}


def tier_for(fleet: int, cfg: dict) -> dict:
    for t in sorted(cfg["subscription_tiers"], key=lambda t: t["max_aircraft"]):
        if fleet <= t["max_aircraft"]:
            return t
    return cfg["subscription_tiers"][-1]


def roi(cfg: dict, fleet_size: int, inspections_per_month: Optional[float] = None) -> dict:
    fleet = max(1, int(fleet_size))
    ipm = float(inspections_per_month if inspections_per_month is not None else cfg["inspections_per_aircraft_month"])
    rate = cfg["labour_rate"]
    m, dr = cfg["manual_inspection"], cfg["drone_inspection"]
    manual_cost = m["hours"] * m["crew"] * rate + m["other_cost"]
    drone_cost = dr["hours"] * dr["crew"] * rate + dr["other_cost"]
    hours_saved = max(0.0, m["hours"] - dr["hours"])
    ground_value = hours_saved * cfg["aog_cost_per_hour"] * cfg["ground_time_value_fraction"]
    per_insp = (manual_cost - drone_cost) + ground_value
    insp_month = fleet * ipm
    aog_h = fleet * cfg["early_detection_aog_hours_avoided_per_aircraft_month"]
    aog_value = aog_h * cfg["aog_cost_per_hour"]
    gross_month = insp_month * per_insp + aog_value
    tier = tier_for(fleet, cfg)
    sub_month = fleet * tier["price_per_aircraft_month"]
    net_month = gross_month - sub_month
    setup = cfg["setup_cost"]
    annual_net = net_month * 12
    payback = (setup / net_month) if net_month > 0 else None
    roi_pct = ((annual_net - setup) / (setup + sub_month * 12) * 100) if (setup + sub_month) > 0 else None
    return {
        "label": "Estimate, based on editable assumptions",
        "currency": cfg["currency"],
        "fleet_size": fleet,
        "inspections_per_month": round(insp_month, 1),
        "per_inspection": {
            "manual_cost": round(manual_cost),
            "drone_cost": round(drone_cost),
            "direct_saving": round(manual_cost - drone_cost),
            "manual_hours": m["hours"],
            "drone_hours": dr["hours"],
            "hours_saved": hours_saved,
            "ground_time_value": round(ground_value),
            "total_saving": round(per_insp),
        },
        "aog_hours_avoided_month": round(aog_h, 1),
        "aog_value_month": round(aog_value),
        "gross_savings_month": round(gross_month),
        "subscription_tier": tier["name"],
        "subscription_month": round(sub_month),
        "net_savings_month": round(net_month),
        "net_savings_year": round(annual_net),
        "setup_cost": setup,
        "payback_months": round(payback, 1) if payback is not None else None,
        "roi_pct": round(roi_pct, 1) if roi_pct is not None else None,
        "monthly_series": [
            {"month": i, "cumulative_net": round(net_month * i - setup)} for i in range(0, 13)
        ],
    }


def revenue_projection(cfg: dict, scenarios=(10, 50, 100, 250, 500, 1000)) -> list:
    out = []
    for n in scenarios:
        t = tier_for(n, cfg)
        mrr = n * t["price_per_aircraft_month"]
        out.append({"aircraft": n, "tier": t["name"], "mrr": round(mrr), "arr": round(mrr * 12)})
    return out
