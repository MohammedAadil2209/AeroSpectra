"""ORM entities.

`is_demo` separates fictional demonstration records from real inspection records.
They live in the same tables but every query is scoped by it, so they never mix.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.session import Base


class Aircraft(Base):
    __tablename__ = "aircraft"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    registration: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(64))
    operator: Mapped[str] = mapped_column(String(64), default="")
    base: Mapped[str] = mapped_column(String(64), default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    inspections: Mapped[List["Inspection"]] = relationship(back_populates="aircraft")


class Inspection(Base):
    __tablename__ = "inspections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    aircraft_id: Mapped[str] = mapped_column(ForeignKey("aircraft.id"), index=True)
    # camera | upload | simulation
    source: Mapped[str] = mapped_column(String(16))
    source_detail: Mapped[str] = mapped_column(String(256), default="")
    # active | paused | completed | aborted | failed
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    # ai (YOLO loaded) | simulated (synthetic ground truth) | none (no model)
    detection_mode: Mapped[str] = mapped_column(String(16), default="none")
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    frames_processed: Mapped[int] = mapped_column(Integer, default=0)
    sections_inspected: Mapped[list] = mapped_column(JSON, default=list)
    recording_url: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    aircraft: Mapped[Aircraft] = relationship(back_populates="inspections")
    detections: Mapped[List["Detection"]] = relationship(
        back_populates="inspection", order_by="Detection.video_time_s"
    )


class Detection(Base):
    __tablename__ = "detections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    inspection_id: Mapped[str] = mapped_column(ForeignKey("inspections.id"), index=True)
    aircraft_id: Mapped[str] = mapped_column(ForeignKey("aircraft.id"), index=True)
    category: Mapped[str] = mapped_column(String(16), index=True)  # crack | dent | corrosion
    confidence: Mapped[float] = mapped_column(Float)
    detected_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    video_time_s: Mapped[float] = mapped_column(Float, default=0.0)
    # Normalised [0..1] relative to frame: x, y, w, h  + source frame size
    bbox: Mapped[dict] = mapped_column(JSON)
    section: Mapped[str] = mapped_column(String(48), default="Unassigned")
    # Triage priority (rule-based, see services/triage.py) - NOT a certified severity.
    priority: Mapped[str] = mapped_column(String(8), default="low", index=True)  # high|medium|low
    evidence_url: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    # ai | simulated
    origin: Mapped[str] = mapped_column(String(16), default="ai")
    model_name: Mapped[str] = mapped_column(String(64), default="")
    # pending | reviewed | confirmed | false_positive
    review_status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    reviewer: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    reviewer_notes: Mapped[str] = mapped_column(Text, default="")
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    inspection: Mapped[Inspection] = relationship(back_populates="detections")
