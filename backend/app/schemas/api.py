"""Pydantic response/request schemas (API contract, mirrored in frontend/src/types)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Category = Literal["crack", "dent", "corrosion", "defect"]
RiskLevel = Literal["low", "medium", "high", "critical"]
MaintenanceStatus = Literal["detected", "confirmed", "work_order", "repair_in_progress", "repaired", "cleared", "false_positive", "deferred"]
ReviewStatus = Literal["pending", "reviewed", "confirmed", "false_positive"]
SourceType = Literal["camera", "upload", "simulation", "drone_direct"]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class AircraftOut(ORMModel):
    id: str
    registration: str
    model: str
    operator: str
    base: str
    is_demo: bool
    inspection_count: int = 0
    finding_count: int = 0
    open_finding_count: int = 0
    last_inspection_at: Optional[datetime] = None


class DetectionOut(ORMModel):
    id: str
    inspection_id: str
    aircraft_id: str
    category: Category
    confidence: float
    detected_at: datetime
    video_time_s: float
    bbox: Dict[str, float]
    section: str
    priority: str
    evidence_url: Optional[str]
    origin: str
    model_name: str
    review_status: ReviewStatus
    reviewer: Optional[str]
    reviewer_notes: str
    reviewed_at: Optional[datetime]
    is_demo: bool
    risk_score: float = 0.0
    risk_level: RiskLevel = "low"
    risk_breakdown: Dict[str, Any] = {}
    recommendation: str = ""
    cost_min: float = 0.0
    cost_max: float = 0.0
    labour_hours: float = 0.0
    maintenance_status: MaintenanceStatus = "detected"
    actual_cost: Optional[float] = None
    actual_labour_hours: Optional[float] = None
    repair_photo_url: Optional[str] = None
    cleared_at: Optional[datetime] = None
    cleared_by: Optional[str] = None
    original_category: Optional[str] = None
    thumb_url: Optional[str] = None


class InspectionOut(ORMModel):
    id: str
    aircraft_id: str
    source: SourceType
    source_detail: str
    status: str
    detection_mode: str
    started_at: datetime
    ended_at: Optional[datetime]
    duration_s: float
    frames_processed: int
    sections_inspected: List[str]
    recording_url: Optional[str]
    notes: str
    error: Optional[str]
    is_demo: bool
    detection_count: int = 0


class InspectionDetailOut(InspectionOut):
    aircraft: AircraftOut
    detections: List[DetectionOut]


class StartInspectionIn(BaseModel):
    aircraft_id: str
    source: SourceType
    camera_uri: Optional[str] = Field(None, description="Device index or verified stream URL")
    upload_id: Optional[str] = None
    record: bool = False
    notes: str = ""


class StopInspectionIn(BaseModel):
    inspection_id: Optional[str] = None


class ReviewIn(BaseModel):
    review_status: ReviewStatus
    reviewer: Optional[str] = None
    reviewer_notes: Optional[str] = None
    # reviewer may re-classify a generic "defect" (or any category)
    category: Optional[Category] = None


class TransitionIn(BaseModel):
    to_status: MaintenanceStatus
    actor: str = ""
    notes: str = ""
    reason: str = ""
    actual_cost: Optional[float] = None
    actual_labour_hours: Optional[float] = None
    photo_url: Optional[str] = None


class SettingIn(BaseModel):
    value: Dict[str, Any]
    actor: str = ""
    note: str = ""
    persist: bool = True


class AIConfigIn(BaseModel):
    confidence: Optional[float] = Field(None, ge=0.05, le=0.95)
    infer_every: Optional[int] = Field(None, ge=1, le=10)


class UploadOut(BaseModel):
    upload_id: str
    filename: str
    size_bytes: int
    frames: int
    fps: float
    width: int
    height: int
    duration_s: float


class CameraTestIn(BaseModel):
    camera_uri: str


class CameraTestOut(BaseModel):
    ok: bool
    camera_uri: str
    width: int = 0
    height: int = 0
    message: str


class ComponentStatus(BaseModel):
    status: Literal["online", "offline", "degraded", "not_configured", "unavailable"]
    detail: str


class HealthOut(BaseModel):
    status: str
    version: str
    time: datetime
    database: ComponentStatus
    ai_model: Dict[str, Any]
    camera: ComponentStatus
    active_inspection_id: Optional[str]
    websocket_clients: int


class AnalyticsOut(BaseModel):
    scope: str
    total_inspections: int
    completed_inspections: int
    active_inspections: int
    total_detections: int
    high_priority: int
    pending_reviews: int
    reviewed: int
    confirmed: int
    false_positives: int
    by_category: Dict[str, int]
    by_status: Dict[str, int]
    by_section: Dict[str, int]
    trend: List[Dict[str, object]]
    confidence_histogram: List[Dict[str, object]]
    by_risk: Dict[str, int] = {}
    by_maintenance: Dict[str, int] = {}
    open_defects: int = 0
    cleared_defects: int = 0
    open_vs_cleared_trend: List[Dict[str, object]] = []
    estimated_cost_min: float = 0.0
    estimated_cost_max: float = 0.0
    actual_cost: float = 0.0
    currency: str = "INR"
