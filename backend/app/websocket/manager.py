"""WebSocket connection manager. Thread-safe broadcast from the inspection worker thread.

Server -> client event types:
  connection          {status, active_inspection}
  inspection_started  {inspection}
  inspection_paused   {inspection_id}
  inspection_resumed  {inspection_id}
  inspection_stopped  {inspection_id, status, reason}
  recording_status    {inspection_id, recording, recording_url}
  frame               {inspection_id, frame, video_time_s, fps}  (metadata ~2 Hz; pixels via MJPEG)
  detection           {detection}
  error               {message}
Client -> server:
  ping                -> pong
  telemetry           {section}  (simulation section hint from the 3D mission)
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any, Optional, Set

from fastapi import WebSocket

log = logging.getLogger("aerospectra.ws")


def _default(o: Any):
    if isinstance(o, datetime):
        return o.isoformat() + "Z"
    raise TypeError(type(o))


class ConnectionManager:
    def __init__(self) -> None:
        self.clients: Set[WebSocket] = set()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self.loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)

    async def _broadcast(self, text: str) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_text(text)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send(self, ws: WebSocket, event: str, data: dict) -> None:
        await ws.send_text(json.dumps({"type": event, "data": data}, default=_default))

    def emit(self, event: str, data: dict) -> None:
        """Callable from any thread."""
        if not self.loop or not self.clients:
            return
        text = json.dumps({"type": event, "data": data, "ts": datetime.utcnow()}, default=_default)
        try:
            asyncio.run_coroutine_threadsafe(self._broadcast(text), self.loop)
        except RuntimeError:
            log.debug("event loop closed; dropping %s", event)


ws_manager = ConnectionManager()
