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

**Windows (PowerShell)** — use the `py` launcher and `Scripts\`:

```powershell
# 1. Backend
cd backend
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# 2. Frontend — new terminal
cd frontend
npm install
npm run dev
```

> If the build fails with `failed to resolve import "@fontsource-variable/..."`, your `node_modules` is stale — re-run `npm install`.

Open **http://localhost:5173**. The Vite dev server proxies `/api`, `/ws`, `/evidence`, `/recordings` to the backend.
The frontend still works without the backend (demo dataset + 3D simulator), with clear "backend offline" notices.

Production build: `cd frontend && npm run build` → `frontend/dist/`.

### Windows + GPU (recommended for the demo — v1.1)

The root `venv` has CUDA PyTorch (cu128, RTX 50-series) + Ultralytics, so the trained model runs on the GPU in FP16.

```powershell
# 1. Backend (FastAPI :8000) — from the repo root
cd backend
..\venv\Scripts\python -m uvicorn app.main:app --port 8000
#    log should say: "AI model status: online - Loaded aerospectra-defects.pt on NVIDIA GeForce RTX 5070 ... (FP16)"

# 2. Frontend (Vite :5173) — new terminal
cd frontend
npm run dev

# 3. Tests
cd backend; ..\venv\Scripts\python -m pytest tests -q          # risk, cost, maintenance, settings audit
cd frontend; npm run build                                       # zero TypeScript errors
```

> Note: `backend\.venv` (older setup) has no PyTorch, so it reports "AI not loaded". Use the root `venv` above.
> Optional: `AEROSPECTRA_YOLO_DEVICE=cpu` forces CPU; `AEROSPECTRA_RTSP_URI` changes the default drone stream.

Demo clip from held-out test images: `..\venv\Scripts\python backend\scripts\make_test_clip.py results\test_clip.mp4 30`
(already generated at `results/test_clip.mp4`).

### Drone camera — direct Wi-Fi (Elilvendan B2 / E88 Pro, RC UFO app family)

No phone and no screen mirroring: the laptop joins the drone's Wi-Fi and AeroSpectra talks to it directly
(`backend/app/video/drone_link.py`, source type `drone_direct`).

| Item | Value |
|---|---|
| Drone IP | `192.168.1.1` (auto-detected; falls back to the Wi-Fi default gateway; warns on 192.168.0.x / 10.x) |
| Keep-alive | UDP `01 01` → `<ip>:7099` every 1 s (starts/stops with the inspection); drone replies ~1/s (module id, switch mode) |
| Video | `rtsp://<ip>:7070/webcam`, RTP over **UDP first, TCP fallback**, low-res MJPEG |
| Lens select | `06 01` front · `06 02` bottom (stream reopened automatically if the drone needs it) |
| Reconnect | no frame for > 2 s → heartbeat restarted + RTSP reopened, session kept, feed shows "SIGNAL LOST – RECONNECTING…" |
| Latency | grabber keeps only the newest frame; the AI never processes a backlog |
| Safety | AeroSpectra **never sends flight-control or stop packets** — fly with the physical remote |

Protocol cross-checked against public reverse-engineering notes (Buff220/e88pro-reverse-RC-FPV-, Juliii-p/e88-drone-pc-control,
PatrickAcheson/E99-drone-reverse-engineer, marshallrichards/turbodrone `cooingdv`); no code copied.

**Field test with the real drone**
1. Charge the drone, power it on. **Close the RC UFO app** on the phone (one video client at a time).
2. Laptop Wi-Fi → join `WIFI-UFO-…` / `FLY-UFO-…` (no internet on this network — that is normal).
3. Once, in an **Administrator** PowerShell: `powershell -ExecutionPolicy Bypass -File tools\allow_firewall.ps1`
   (allows inbound UDP for the venv Python on Public + Private networks — the drone network is "Public").
4. Quick check without the web app: `venv\Scripts\python tools\drone_check.py` → preview window, FPS, `drone_test.jpg`, PASS/FAIL + reason
   (`--lens bottom`, `--ip 192.168.1.1`, `--no-window` available).
5. Start backend + frontend (commands above) → **Live Inspection** → source **Drone** → aircraft (real fleet) → ↻ re-detect IP →
   **Test drone** (preview + resolution/FPS/transport, max 8 s) → **Start Inspection**. Status chip: Heartbeat OK / No drone / Reconnecting.
6. Fly with the physical remote. Front/Bottom lens buttons switch cameras live.

> **Judging fallback:** if the drone link fails, switch the source to **Video file** and upload `results/test_clip.mp4`
> (or a pre-recorded drone clip) — the whole pipeline (AI, risk, cost, records, PDF) works identically.

### Judge demo (3 minutes)

| Time | Page | What to show / say |
|---|---|---|
| 0:00 | **Overview** — click **Present** (top bar) | Live link = green **Live**; AI chip = *aerospectra-defects · RTX 5070 FP16*. KPIs: **Open vs Verified & Cleared**, critical/high risk, est. repair exposure — all pushed live over WebSocket. |
| 0:25 | **Live Inspection** → *Uploaded Video* → aircraft `VT-TST` → upload `results/test_clip.mp4` → **Start** | Annotated stream with AI boxes; **Live AI Record** streams each detection (crop, time, section, confidence, **risk badge**, **cost range**), counters, session timer, video FPS + AI inferences/s. Drag the **confidence slider** — applied instantly. Open **Model card** (test-split P/R/mAP). |
| 1:10 | Second browser tab on **Inspection History** | Session shows a pulsing **LIVE** badge with counts/duration ticking — no refresh. |
| 1:30 | Click a detection → review drawer | **Why this score** breakdown bar + ADVISORY recommendation. Re-classify *Defect → Crack* → risk & cost re-computed. Then lifecycle: **Confirmed → Work order → Repair → Repaired (actual cost) → Verified & Cleared**, upload an after-repair photo (before/after). Dashboard tab updates Open/Cleared live. |
| 2:10 | **Risk Engine** | Move a weight slider → all current + historical detections re-scored instantly (charts update); presets; save → version + audit trail. |
| 2:30 | **Cost & ROI** | Fleet slider → savings/inspection, payback, ROI, revenue projection — every number labelled *Estimate, based on editable assumptions*. |
| 2:45 | **Maintenance** / **Drone Simulator** / PDF | Per-aircraft timeline, recurring sections, estimate vs actual; MRO hangar sim with defect markers by risk; **Inspection detail → Download PDF** (risk, cost, maintenance/clearance). |

Honesty labels stay visible throughout: detections are **potential defects for human review**; risk scores are **advisory**; costs are **estimates**.

### Demo script (≈3 min, original v1.0 flow)
1. **Overview** → system status, KPIs, trend, defect distribution (Demo data badge visible).
2. **START NEW INSPECTION** → *Simulation* → aircraft `DEMO-101` → *Open inspection console*.
3. **Start Inspection** → synthetic feed streams with bounding boxes, the 3D drone takes off and flies the loop,
   the current section follows the drone, detections appear on the right → *Confirm* / *False positive*.
4. **Drone Simulator** → Start/Pause/Resume/Reset, speed, height, clearance, Orbit/Follow/Top/Side/Drone views, image capture.
5. **Defect Records** → filter (category, status, aircraft, date, confidence) → open a record → save a review.
6. **Analytics** → **Inspection History** → open the session → **Download PDF report**.
7. Real-scope path: **Aircraft → Register aircraft** → Live Inspection → *Uploaded Video* → upload MP4 → Start.

---

---

## v1.1 — what's new

- **Trained AI model** — YOLO11s single-class `defect`, trained locally on an RTX 5070 from audited + deduplicated public
  Roboflow datasets (2,633 images). Now 3 classes (crack, dent, corrosion), 6,072 images incl. 1,401 negatives; held-out **test split: P 0.70 · R 0.65 · mAP50 0.67 · mAP50-95 0.37** (crack 0.62, dent 0.70, corrosion 0.70 mAP50). COCO scene gate + 2-frame confirmation suppress false alarms on people/objects.
  Details, rejected datasets, cleaning steps: `results/SUMMARY.md`; card: `backend/models/model_card.json`.
- **Real-time everywhere** — typed WebSocket event bus (`inspection.started/updated/ended`, `detection.created`,
  `defect.updated`, `maintenance.updated`, `risk.updated`, `settings.updated`, `kpi.updated`, `ai.updated`), auto-reconnect
  with a visible *Live / Reconnecting* indicator.
- **Live AI Record** panel, live confidence slider (0.10–0.80), CUDA FP16 with automatic CPU fallback, device/model/FPS chip.
- **Drone camera** — RTSP (default `rtsp://192.168.1.1:7070/webcam`, UDP → TCP fallback), device index (OBS Virtual Camera),
  newest-frame-only grabber, auto-reconnect without ending the session.
- **Risk Engine** (`/risk`) — 0–100 advisory score from type severity, size, section criticality, confidence, clustering,
  recurrence; per-factor breakdown; sliders, presets, live re-scoring of all records; versioned settings + audit trail.
- **Cost & ROI** (`/roi`) — editable INR cost model, per-detection/inspection estimates, manual vs drone savings, AOG hours,
  payback, ROI, revenue projection.
- **Maintenance** (`/maintenance`) — Detected → Confirmed → Work order → Repair → Repaired → Verified & Cleared
  (+ False positive / Deferred with reason), actual cost/labour, after-repair photos, per-aircraft timeline, recurring sections.
- **MRO hangar simulator** — procedural hangar (trusses, high-bay lights, epoxy reflective floor, hazard markings, doors open
  to the apron, GPU, scaffolds, chocks, cones, fire stations, signage, dust), Low/High quality toggle, defect markers by risk.
- **Present mode** — hides dev controls, enlarges live views and KPIs, auto-cycles Overview → Live → Risk → ROI when idle.
- DB: additive auto-migration on startup (new columns/tables); back up `backend/aerospectra.db` before upgrading.

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
| **YOLO model weights** | **Trained (v1.1)** — `backend/models/aerospectra-defects.pt`, single class `defect` | Retrain: `yolo detect train model=yolo11s.pt data=data_prep/merged/data.yaml ...`, then `python -I data_prep/scripts/evaluate.py` (test metrics, grid, deploy + model card). Reviewers can re-classify `defect` as crack/dent/corrosion. |
| **Elilvendan B2 camera feed** | **Direct Wi-Fi source implemented (v1.1)** — see *Drone camera — direct Wi-Fi*; verify on the real drone with `tools/drone_check.py` | Option A: verify whether the drone exposes RTSP/HTTP (then enter URL in Settings). Option B (works today): mirror Android with `scrcpy`, capture the window in OBS → *Start Virtual Camera* → use device index (e.g. `1`) as camera URI. |
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

---

## AeroScan (standalone YOLO inspection dashboard)

`aeroscan/` is a self-contained FastAPI and vanilla-JS dashboard for the trained YOLO exterior-defect model.
It runs live drone RTSP, scrcpy screen mirroring, a webcam, or uploaded images and videos, and uses ByteTrack
to count each unique defect once.
Run it with `cd aeroscan && pip install -r requirements.txt && python server.py`, then open http://localhost:8000.
See [aeroscan/README.md](aeroscan/README.md).
