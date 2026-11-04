"""Pydantic response/request schemas (API contract, mirrored in frontend/src/types)."""
from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

Category = Literal["crack", "dent", "corrosion"]
ReviewStatus = Literal["pending", "reviewed", "confirmed", "false_positive"]
SourceType = Literal["camera", "upload", "simulation"]


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
    ai_model: ComponentStatus
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
