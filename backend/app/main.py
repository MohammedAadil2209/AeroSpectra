"""AeroSpectra backend entrypoint.

Run:  .venv/bin/uvicorn app.main:app --reload --port 8000
"""
from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.routes import router
from app.api.routes_v2 import router as router_v2
from app.config import APP_VERSION, CORS_ORIGINS, EVIDENCE_DIR, RECORDING_DIR
from app.database import repository as repo
from app.database.seed import seed_demo, seed_demo_maintenance
from app.database.session import init_db, session_scope
from app.detection.detectors import models
from app.services.inspection_runner import runner
from app.websocket.manager import ws_manager

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_demo()
    with session_scope() as db:
        repo.mark_orphaned_inspections(db)
        repo.sync_maintenance_from_review(db)
        res = repo.rescore_all(db)
        logging.getLogger("aerospectra").info("Risk engine scored %d detections", res["total"])
    seed_demo_maintenance()
    ws_manager.bind_loop(asyncio.get_running_loop())
    await asyncio.get_running_loop().run_in_executor(None, models.load)
    logging.getLogger("aerospectra").info("AI model status: %s - %s", models.status, models.detail)
    yield
    runner.stop("shutdown")


app = FastAPI(
    title="AeroSpectra API",
    version=APP_VERSION,
    description="AI-assisted aircraft visual inspection backend. Detections are potential defects that require human review.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
app.include_router(router_v2)
app.mount("/evidence", StaticFiles(directory=EVIDENCE_DIR), name="evidence")
app.mount("/recordings", StaticFiles(directory=RECORDING_DIR), name="recordings")


@app.websocket("/ws/inspection")
async def ws_inspection(ws: WebSocket):
    await ws_manager.connect(ws)
    await ws_manager.send(ws, "connection", {"status": "connected", "active_inspection": runner.snapshot(),
                                             "ai_model": models.status, "ai": models.info()})
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            kind = msg.get("type")
            if kind == "ping":
                await ws_manager.send(ws, "pong", {"active_inspection": runner.snapshot()})
            elif kind == "telemetry":
                section = (msg.get("data") or {}).get("section")
                if section:
                    runner.set_section(str(section))
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(ws)


@app.get("/")
def root():
    return {"name": "AeroSpectra API", "version": APP_VERSION, "docs": "/docs"}
