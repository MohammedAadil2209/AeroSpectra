"""Typed real-time event bus over the /ws/inspection WebSocket.

Event names (frontend: src/types WsEvent):
  inspection.started   {inspection}
  inspection.updated   {inspection_id, status, detection_count, duration_s, frames, ...}  (~1 Hz while live)
  inspection.ended     {inspection_id, status, reason, error, detections}
  frame                {inspection_id, frame, elapsed_s, fps, inference_fps, section, connected, ...}
  detection.created    {detection}
  defect.updated       {detection}           (review, re-classification, cost/risk change)
  maintenance.updated  {detection, event}
  risk.updated         {version, changed, counts, preview?}
  settings.updated     {key, version, updated_by}
  kpi.updated          {scope, analytics}     (throttled: max ~2/s per scope)
  ai.updated           {ai}                   (confidence / device / fps changes)
  recording.status     {inspection_id, recording, recording_url}
  error                {message}
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Dict

from app.websocket.manager import ws_manager

log = logging.getLogger("aerospectra.events")


def publish(event: str, data: dict) -> None:
    ws_manager.emit(event, data)


class _KpiThrottle:
    """Coalesces bursts of data changes into one analytics push per scope."""

    def __init__(self, min_interval: float = 0.5) -> None:
        self.min_interval = min_interval
        self._pending: Dict[bool, bool] = {}
        self._last: Dict[bool, float] = {}
        self._lock = threading.Lock()

    def touch(self, is_demo: bool) -> None:
        if not ws_manager.clients:
            return
        with self._lock:
            if self._pending.get(is_demo):
                return
            self._pending[is_demo] = True
            wait = max(0.0, self.min_interval - (time.monotonic() - self._last.get(is_demo, 0.0)))
        t = threading.Timer(wait, self._fire, args=(is_demo,))
        t.daemon = True
        t.start()

    def _fire(self, is_demo: bool) -> None:
        try:
            from app.database import repository as repo
            from app.database.session import session_scope

            with session_scope() as db:
                data = repo.analytics(db, is_demo)
            publish("kpi.updated", {"scope": "demo" if is_demo else "real", "analytics": data})
        except Exception:  # noqa: BLE001
            log.exception("kpi push failed")
        finally:
            with self._lock:
                self._pending[is_demo] = False
                self._last[is_demo] = time.monotonic()


kpi = _KpiThrottle()
