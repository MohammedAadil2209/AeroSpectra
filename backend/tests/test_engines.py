"""Unit tests: risk engine, cost engine, maintenance state machine, settings audit."""
from __future__ import annotations

import copy
import os
import sys
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# isolated DB for the settings/repository tests
_tmp = tempfile.mkdtemp()
os.environ["AEROSPECTRA_DATABASE_URL"] = f"sqlite:///{Path(_tmp) / 'test.db'}"

from app.services import cost, maintenance as mx, risk  # noqa: E402

CFG = copy.deepcopy(risk.DEFAULT_RISK_CONFIG)


def det(**kw):
    base = dict(category="defect", confidence=0.5, bbox={"w": 0.05, "h": 0.05}, section="Fuselage")
    base.update(kw)
    return base


# ---------------------------------------------------------------- risk
def test_score_in_range_and_breakdown_sums():
    r = risk.score_detection(det(), CFG)
    assert 0 <= r["score"] <= 100
    pts = sum(v["points"] for k, v in r["breakdown"].items() if not k.startswith("_"))
    assert abs(pts - r["score"]) < 0.6
    assert r["recommendation"].startswith("ADVISORY")


def test_severity_ordering_crack_gt_corrosion_gt_dent():
    s = {c: risk.score_detection(det(category=c), CFG)["score"] for c in ("crack", "corrosion", "dent", "defect")}
    assert s["crack"] > s["corrosion"] > s["dent"]
    assert s["crack"] > s["defect"]


def test_size_section_confidence_cluster_recurrence_increase_score():
    base = risk.score_detection(det(), CFG)["score"]
    assert risk.score_detection(det(bbox={"w": 0.4, "h": 0.4}), CFG)["score"] > base
    assert risk.score_detection(det(section="Left Engine"), CFG)["score"] > base
    assert risk.score_detection(det(confidence=0.95), CFG)["score"] > base
    assert risk.score_detection(det(), CFG, neighbours=3)["score"] > base
    assert risk.score_detection(det(), CFG, prior=2)["score"] > base


def test_levels_and_thresholds():
    assert risk.level_for(10, CFG) == "low"
    assert risk.level_for(CFG["thresholds"]["medium"], CFG) == "medium"
    assert risk.level_for(CFG["thresholds"]["high"], CFG) == "high"
    assert risk.level_for(99, CFG) == "critical"
    worst = risk.score_detection(det(category="crack", confidence=0.99, bbox={"w": 0.5, "h": 0.5},
                                     section="Left Engine"), CFG, neighbours=5, prior=5)
    assert worst["level"] == "critical" and worst["score"] >= 95


def test_weights_change_score():
    cfg = copy.deepcopy(CFG)
    cfg["weights"] = {k: 0 for k in cfg["weights"]}
    cfg["weights"]["confidence"] = 1
    assert risk.score_detection(det(confidence=0.42), cfg)["score"] == pytest.approx(42.0, abs=0.1)


def _obj(i, insp, t, section="Fuselage", aircraft="A1", when=None, review="pending"):
    return SimpleNamespace(id=i, inspection_id=insp, video_time_s=t, section=section, aircraft_id=aircraft,
                           detected_at=when or datetime(2026, 1, 1), review_status=review, category="crack",
                           confidence=0.8, bbox={"w": 0.05, "h": 0.05}, is_demo=False,
                           risk_score=0.0, risk_level="low", risk_breakdown={})


def test_cluster_and_recurrence_context():
    old = _obj("o1", "I0", 3, when=datetime(2025, 1, 1))
    a = _obj("a", "I1", 10)
    b = _obj("b", "I1", 14)
    far = _obj("c", "I1", 100)
    fp = _obj("d", "I1", 11, review="false_positive")
    other_sec = _obj("e", "I1", 10, section="Tail")
    n, p = risk.context_counts(a, [old, a, b, far, fp, other_sec], CFG)
    assert n == 1  # only b (within 10 s, same section, not FP)
    assert p == 1  # old inspection, same aircraft+section, earlier


def test_rescore_mutates_and_preview_does_not():
    items = [_obj("a", "I1", 1), _obj("b", "I1", 2)]
    pv = risk.preview(items, CFG)
    assert items[0].risk_score == 0.0 and pv[0]["risk_score"] > 0
    risk.rescore(items, CFG)
    assert items[0].risk_score == pv[0]["risk_score"]


# ---------------------------------------------------------------- cost
CC = copy.deepcopy(cost.DEFAULT_COST_CONFIG)


def test_cost_estimate_grows_with_risk_level():
    vals = [cost.estimate("crack", lv, CC)["cost_max"] for lv in ("low", "medium", "high", "critical")]
    assert vals == sorted(vals) and vals[0] < vals[-1]
    e = cost.estimate("crack", "low", CC)
    assert e["cost_min"] == CC["repair"]["crack"]["low"]["min"] + CC["repair"]["crack"]["low"]["labour_h"] * CC["labour_rate"]
    assert e["cost_min"] < e["cost_max"]


def test_unknown_category_falls_back_to_defect():
    assert cost.estimate("weird", "low", CC) == cost.estimate("defect", "low", CC)


def test_inspection_totals_skip_false_positives():
    d1 = SimpleNamespace(review_status="pending", maintenance_status="detected", cost_min=100, cost_max=200,
                         labour_hours=1, actual_cost=None)
    d2 = SimpleNamespace(review_status="false_positive", maintenance_status="false_positive", cost_min=999,
                         cost_max=999, labour_hours=9, actual_cost=None)
    t = cost.inspection_totals([d1, d2])
    assert t == {"count": 1, "cost_min": 100, "cost_max": 200, "labour_hours": 1, "actual_cost": 0}


def test_roi_math():
    r = cost.roi(CC, 20)
    pi = r["per_inspection"]
    assert pi["direct_saving"] == pi["manual_cost"] - pi["drone_cost"] > 0
    assert r["net_savings_month"] == r["gross_savings_month"] - r["subscription_month"]
    assert r["net_savings_year"] == r["net_savings_month"] * 12
    assert r["payback_months"] == pytest.approx(CC["setup_cost"] / r["net_savings_month"], abs=0.1)
    assert r["label"].startswith("Estimate")
    assert cost.tier_for(5, CC)["name"] == "Starter" and cost.tier_for(500, CC)["name"] == "Enterprise"


def test_roi_negative_net_has_no_payback():
    cc = copy.deepcopy(CC)
    cc["subscription_tiers"] = [{"name": "X", "max_aircraft": 10 ** 6, "price_per_aircraft_month": 10 ** 9}]
    r = cost.roi(cc, 3)
    assert r["net_savings_month"] < 0 and r["payback_months"] is None


# ---------------------------------------------------------------- maintenance
def mdet(status="detected"):
    return SimpleNamespace(id="D1", aircraft_id="A1", is_demo=False, maintenance_status=status, review_status="pending",
                           reviewed_at=None, reviewer=None, actual_cost=None, actual_labour_hours=None,
                           repair_photo_url=None, cleared_at=None, cleared_by=None)


def test_full_happy_path_to_cleared():
    d = mdet()
    for st in ("confirmed", "work_order", "repair_in_progress", "repaired"):
        mx.apply(d, st, actor="eng1")
    ev = mx.apply(d, "cleared", actor="insp2", actual_cost=55000, actual_labour_hours=6, photo_url="/x.jpg")
    assert d.maintenance_status == "cleared" and d.cleared_by == "insp2" and d.cleared_at
    assert d.actual_cost == 55000 and d.repair_photo_url == "/x.jpg" and d.review_status == "confirmed"
    assert ev["from_status"] == "repaired" and ev["to_status"] == "cleared"


def test_illegal_transitions_rejected():
    with pytest.raises(mx.TransitionError):
        mx.apply(mdet(), "cleared")
    with pytest.raises(mx.TransitionError):
        mx.apply(mdet("cleared"), "detected")
    with pytest.raises(mx.TransitionError):
        mx.apply(mdet(), "nonsense")


def test_reason_required_for_false_positive_and_deferred():
    with pytest.raises(mx.TransitionError):
        mx.apply(mdet(), "false_positive")
    with pytest.raises(mx.TransitionError):
        mx.apply(mdet("confirmed"), "deferred", reason="  ")
    d = mdet()
    mx.apply(d, "false_positive", reason="Reflection on paint")
    assert d.review_status == "false_positive"
    mx.apply(d, "detected")  # reopen
    assert d.review_status == "pending"


def test_verification_can_send_back_to_repair():
    d = mdet("repaired")
    mx.apply(d, "repair_in_progress", notes="Sealant not cured")
    assert d.maintenance_status == "repair_in_progress"


def test_review_mapping():
    assert mx.status_from_review("confirmed", "detected") == "confirmed"
    assert mx.status_from_review("false_positive", "detected") == "false_positive"
    assert mx.status_from_review("pending", "confirmed") == "detected"
    assert mx.status_from_review("confirmed", "work_order") is None  # later stages untouched


# ---------------------------------------------------------------- settings audit (DB)
def test_settings_versioning_and_audit():
    from app.database.session import init_db, session_scope
    from app.services.settings_store import audit_log, get_setting, put_setting

    init_db()
    with session_scope() as db:
        assert get_setting(db, "risk")["version"] == 0
        s1 = put_setting(db, "risk", {"weights": {"severity": 50}}, actor="alice")
        assert s1["version"] == 1 and s1["value"]["weights"]["severity"] == 50
        s2 = put_setting(db, "risk", {"weights": {"severity": 50}}, actor="bob")  # no-op
        assert s2["version"] == 1
        s3 = put_setting(db, "risk", {"weights": {"severity": 40}}, actor="bob")
        assert s3["version"] == 2 and s3["updated_by"] == "bob"
        log = audit_log(db, "risk")
        assert log[0]["changed_by"] == "bob" and log[0]["changes"]["weights.severity"] == [50, 40]
