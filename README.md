# AeroSpectra

**DETECT. VISUALIZE. DOCUMENT.** — AI-powered aircraft visual inspection and defect monitoring platform (T-Hub BuildX Hackathon).

```
DRONE CAMERA → VIDEO INPUT → PYTHON / OPENCV → YOLO DETECTION → FASTAPI → REACT DASHBOARD → DEFECT RECORDS
```

Two connected capabilities in one web app:
1. **AI-assisted visual inspection** — video input (live camera / uploaded video / simulation), OpenCV pipeline, YOLO hook,
   bounding boxes, confidence, evidence storage, human review, PDF reports.
2. **Autonomous drone inspection simulation** — interactive 3D quadcopter flying an elongated oval route around a stationary airliner.

> Detections are **potential defects** for human review — not certified maintenance diagnoses.

---

## Quick start

Requirements: Node 20+, Python 3.9+.

```bash
# 1. Backend (FastAPI on :8000)
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000

# 2. Frontend (Vite on :5173) — new terminal
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**. The Vite dev server proxies `/api`, `/ws`, `/evidence`, `/recordings` to the backend.
The frontend still works without the backend (demo dataset + 3D simulator), with clear "backend offline" notices.

Production build: `cd frontend && npm run build` → `frontend/dist/`.

### Demo script (≈3 min)
1. **Overview** → system status, KPIs, trend, defect distribution (Demo data badge visible).
2. **START NEW INSPECTION** → *Simulation* → aircraft `DEMO-101` → *Open inspection console*.
3. **Start Inspection** → synthetic feed streams with bounding boxes, the 3D drone takes off and flies the loop,
   the current section follows the drone, detections appear on the right → *Confirm* / *False positive*.
4. **Drone Simulator** → Start/Pause/Resume/Reset, speed, height, clearance, Orbit/Follow/Top/Side/Drone views, image capture.
5. **Defect Records** → filter (category, status, aircraft, date, confidence) → open a record → save a review.
6. **Analytics** → **Inspection History** → open the session → **Download PDF report**.
7. Real-scope path: **Aircraft → Register aircraft** → Live Inspection → *Uploaded Video* → upload MP4 → Start.

---

## Project structure

```
AeroSpectra/
├── frontend/                     React 19 · Vite 6 · TypeScript · Tailwind 4 · R3F/Drei · Recharts · jsPDF
│   ├── public/
│   │   ├── demo/evidence/        synthetic demo evidence images (generated)
│   │   └── models/               drop aircraft.glb / drone.glb here (optional)
│   └── src/
│       ├── components/
│       │   ├── layout/           AppLayout (sidebar, top bar, scope switch), ScopeNotice
│       │   ├── ui/               primitives, EvidenceImage (bbox overlay), Drawer, Toasts
│       │   ├── analytics/        Charts (validated palette)
│       │   ├── inspection/       VideoStage, DetectionPanel, SourceSetup, NewInspectionDialog, InspectionTable
│       │   ├── simulation/       SimulationScene, ProceduralAircraft, ProceduralDrone, HangarEnvironment,
│       │   │                     ModelAssets (GLB), SimulationViewport, MissionPanels, simulationConfig
│       │   ├── defects/          DetectionTable, DefectDetail (review)
│       │   └── reports/          ReportButton
│       ├── pages/                Dashboard, LiveInspection, Simulation, DefectRecords, AircraftManagement,
│       │                         AircraftDetail, InspectionHistory, InspectionDetail, Analytics, Reports, Settings
│       ├── services/             api.ts, dataService.ts (+ inspectionService/detectionService), wsClient.ts,
│       │                         simulationService.ts (MissionController), demoStore.ts (offline demo)
│       ├── context/ hooks/ types/ utils/ (format, labels, analytics, report.ts PDF)
├── backend/
│   ├── app/
│   │   ├── main.py               FastAPI app, lifespan, static mounts, /ws/inspection
│   │   ├── api/routes.py         REST + MJPEG endpoints
│   │   ├── database/             session.py (SQLAlchemy), repository.py (all queries), seed.py
│   │   ├── models/entities.py    Aircraft, Inspection, Detection (is_demo separation)
│   │   ├── schemas/api.py        Pydantic contract
│   │   ├── services/             inspection_runner.py (pipeline thread), triage.py
│   │   ├── detection/            detectors.py (YOLO / simulated / null), annotate.py
│   │   ├── video/                sources.py (camera / file / simulated), synthetic.py
│   │   └── websocket/manager.py
│   ├── scripts/generate_demo_assets.py
│   ├── models/                   put aerospectra-defects.pt here
│   ├── evidence/ uploads/ recordings/
│   ├── requirements.txt · requirements-ai.txt · API.md
├── shared/demo-seed.json         single fictional demo dataset (backend seed + frontend offline mode)
└── blender/export_glb.py         Blender: build oval Follow-Path animation + export aircraft.glb / drone.glb
```

---

## What is real, what is demo, what is future

### Working (real functionality)
- Full navigation, responsive layout (desktop + mobile drawer), Demo/Real data-scope switch.
- FastAPI backend, SQLite via SQLAlchemy (PostgreSQL-ready: set `AEROSPECTRA_DATABASE_URL`).
- Video pipeline: OpenCV capture → (inference) → dedupe → evidence JPEG + DB record → annotated frame → MJPEG stream → WebSocket events.
- **Uploaded video** processing end-to-end (upload, probe, stream, auto-complete at end of file).
- **Live camera** via OpenCV device index or verified URL, with a *Test camera* probe (5 s timeout).
- Start / Stop / Pause / Resume / Start-Stop Recording (MP4 recording of annotated frames).
- Defect records: search, filters (category, status, aircraft, date range, confidence range), CSV export, detail drawer with
  evidence + bounding box, human review (status, reviewer, notes) persisted.
- Aircraft registration (real), aircraft detail pages, inspection history + session detail.
- Analytics computed from stored records (backend `/api/analytics`; same logic client-side for offline demo).
- PDF report: branding, IDs, date, duration, source, sections, findings + confidence, evidence images with boxes,
  review status, notes, summary, explicit simulated/demo banner.
- **3D simulator**: stationary procedural airliner (fuselage, cockpit, wings, 2 engines, fin, stabilisers, gear),
  quadcopter (body, 4 arms, 4 spinning props, skids, gimbal camera) moving as one rig along a closed CatmullRom oval
  sized to guarantee the requested clearance (computed min standoff shown); take-off → loop → landing at start;
  pause holds position, resume continues, reset restores; speed/height/clearance live-editable; path & label toggles;
  Orbit / Follow / Top / Side / Drone-camera views; drone-camera PIP with zoom, pan/tilt, section; simulated image capture.
  Verified: section order Left Wing → Left Engine → Nose → Right Engine → Right Wing → Fuselage → Stabilizers → Tail → … → back to start.

### Demonstration (clearly labelled)
- Demo fleet (`DEMO-101…105`, fictional registrations `DM-AS1xx`), 18 demo inspections, ~100 demo detections with
  synthetic evidence images — all tagged **DEMO**.
- **Simulation source**: backend generates synthetic aircraft-skin footage with painted-in cracks/dents/corrosion; the
  *simulated detector* reports their known positions (ground truth). Tagged `SIMULATED`, never "AI".
- All simulator telemetry (battery, altitude, velocity, position) is simulated and labelled.

### Needs your input / future integration
| Item | Status | What to do |
|---|---|---|
| **YOLO model weights** | **Not supplied** → AI status "Not configured" | Train on crack/dent/corrosion, save as `backend/models/aerospectra-defects.pt`, `pip install -r requirements-ai.txt`, restart. Class names map via `YOLO_CLASS_MAP` in `app/config.py`. |
| **Elilvendan B2 camera feed** | Protocol of WiFi UFO app **unverified** | Option A: verify whether the drone exposes RTSP/HTTP (then enter URL in Settings). Option B (works today): mirror Android with `scrcpy`, capture the window in OBS → *Start Virtual Camera* → use device index (e.g. `1`) as camera URI. |
| **Blender assets** | `AeroSpectra.blend` not in repo | In Blender: Scripting → open `blender/export_glb.py` → edit CONFIG names → Run. Writes `frontend/public/models/aircraft.glb` + `drone.glb`; simulator switches automatically. Add propeller part names to `MODELS.propellerNodes`. |
| Auth, Alembic migrations, multi-drone | Not implemented | See `backend/API.md`. |

---

## Configuration (env vars, backend)
`AEROSPECTRA_DATABASE_URL`, `AEROSPECTRA_YOLO_MODEL`, `AEROSPECTRA_YOLO_CONFIDENCE` (0.40), `AEROSPECTRA_CAMERA_URI` (0),
`AEROSPECTRA_INFER_EVERY` (3), `AEROSPECTRA_CORS_ORIGINS`. Frontend: `VITE_API_BASE_URL` or Settings → API configuration.
No secrets are used or stored in the frontend.

Regenerate the demo dataset: `cd backend && .venv/bin/python scripts/generate_demo_assets.py`, then delete
`backend/aerospectra.db` (re-seeded on next start).

## Design
Palette from coolors `780000 · C1121F · FDF0D5 · 003049 · 669BBC`: navy-derived control-room surfaces, cream text,
steel-blue accents, crimson reserved for the primary action and critical findings; green/amber only for operational/warning state.
Defect category colours (crack `#D3263A`, dent `#4F9BD4`, corrosion `#AF911A`) were validated for colour-blind separation on the dark surface.
