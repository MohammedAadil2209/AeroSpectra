# AeroSpectra API

Base URL: `http://127.0.0.1:8000` · Interactive docs: `/docs` (OpenAPI).
All list endpoints take `scope=demo|real` (default `demo`). Demo and real records never mix.

## Implemented

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | DB, AI model, camera status, active inspection, WS client count |
| GET | `/api/aircraft?scope=` | Aircraft with inspection/finding counts |
| POST | `/api/aircraft` | Register a **real** aircraft `{id, registration, model, operator?, base?}` |
| GET | `/api/aircraft/{id}` | |
| GET | `/api/inspections?scope=&aircraft_id=&status=` | |
| GET | `/api/inspections/active` | Live snapshot of the running session, or `null` |
| POST | `/api/inspections/start` | `{aircraft_id, source: camera\|upload\|simulation, camera_uri?, upload_id?, record?, notes?}` |
| POST | `/api/inspections/stop` | `{inspection_id?}` |
| POST | `/api/inspections/pause` · `/resume` | |
| POST | `/api/inspections/recording` | `{recording: bool}` → MP4 in `backend/recordings/` |
| POST | `/api/inspections/section` | `{section}` operator/simulation section hint |
| GET | `/api/inspections/{id}` | Session + aircraft + detections |
| GET | `/api/detections` | Filters: `scope, category, review_status, aircraft_id, inspection_id, min_confidence, max_confidence (0–1), date_from, date_to (YYYY-MM-DD), q` |
| GET | `/api/detections/{id}` | |
| PATCH | `/api/detections/{id}/review` | `{review_status: pending\|reviewed\|confirmed\|false_positive, reviewer?, reviewer_notes?}` |
| GET | `/api/analytics?scope=` | Totals, by category/status/section, daily trend, confidence histogram |
| POST | `/api/video/upload` | multipart `file` (mp4/mov/avi/mkv/webm/m4v), probed with OpenCV |
| POST | `/api/video/camera/test` | `{camera_uri}` – opens the source and waits for a frame (5 s URL timeout) |
| GET | `/api/video/stream` | MJPEG (`multipart/x-mixed-replace`) of annotated frames of the active session |
| static | `/evidence/*`, `/recordings/*` | Evidence JPEGs and recordings |

### WebSocket `/ws/inspection`
Server → client `{type, data, ts}`: `connection`, `pong`, `inspection_started`, `inspection_paused`,
`inspection_resumed`, `inspection_stopped {reason: user|end_of_video|no_viewers|shutdown}`,
`recording_status`, `frame` (metadata ≈2 Hz — pixels go over MJPEG), `detection`, `detection_reviewed`, `error`.
Client → server: `{type:"ping"}`, `{type:"telemetry", data:{section}}`.

### v1.1 endpoints

| Method | Path | Notes |
|---|---|---|
| GET/POST | `/api/ai` | Runtime AI info (model, device, FP16, inference FPS, confidence) / set `{confidence 0.05–0.95, infer_every}` live |
| GET | `/api/ai/model-card` · POST `/api/ai/reload` | `backend/models/model_card.json` · reload weights |
| GET/PUT | `/api/settings/{risk\|cost}` | Versioned settings `{value, actor, note}`; PUT re-scores / re-costs all detections and broadcasts |
| GET | `/api/settings/{key}/audit` | Who changed what, when (`{path: [old, new]}`) |
| POST | `/api/risk/preview` | Score all detections of a scope with unsaved weights (live slider preview) |
| GET | `/api/risk/presets` · POST `/api/risk/rescore` | Conservative / Balanced / Aggressive |
| GET | `/api/roi?fleet=&inspections_per_month=` | ROI + revenue projection + assumptions (estimates) |
| GET | `/api/inspections/{id}/costs` | Estimated cost/labour totals of a session |
| GET | `/api/maintenance/statuses` | Lifecycle states + allowed transitions |
| POST | `/api/detections/{id}/transition` | `{to_status, actor, notes, reason, actual_cost, actual_labour_hours}` — 422 on illegal transition / missing reason |
| GET | `/api/detections/{id}/events` · POST `/api/detections/{id}/photo` | Lifecycle history · after-repair photo upload |
| GET | `/api/aircraft/{id}/maintenance` | Timeline, per-section recurrence, estimated vs actual cost |
| GET | `/api/drone/status?ip=` | Direct drone link: while a `drone_direct` inspection runs → ip, heartbeat replies, alive, transport, resolution, fps, reconnects, `state` (streaming/reconnecting); otherwise detected IP + warnings + last test |
| POST | `/api/drone/test` | `{ip?}` heartbeat + grab one frame within 8 s → `{ok, message, preview_jpeg (data URL), width, height, fps, transport, rtsp_reachable, heartbeat_replies, module_id, ...}`; 409 if the drone is in use |
| POST | `/api/drone/camera` | `{lens: front\|bottom, ip?}` sends `06 01` / `06 02` on UDP 7099; reopens the stream of a running session if needed |
| POST | `/api/inspections/start` | `source: "drone_direct"` with `camera_uri` = drone IP or `"auto"`; fails fast (≈3 s) with a 400 + reason when no drone |
| PATCH | `/api/detections/{id}/review` | now also accepts `category` (re-classify; original kept in `original_category`) |

Detections now carry `risk_score, risk_level, risk_breakdown, recommendation, cost_min, cost_max, labour_hours,
maintenance_status, actual_cost, actual_labour_hours, repair_photo_url, cleared_at, cleared_by, original_category, thumb_url`.

**WebSocket event bus (v1.1)** replaces the v1.0 event names: `inspection.started`, `inspection.updated` (~1 Hz progress),
`inspection.ended`, `frame` (+ `inference_fps`, `connected`, `reconnects`), `detection.created`, `defect.updated`,
`maintenance.updated`, `risk.updated`, `settings.updated`, `kpi.updated` (throttled analytics push), `ai.updated`,
`recording.status`, `error`. See `app/services/events.py`.

## Behaviour notes
- **One active inspection at a time** (one drone). Starting a second returns `409`.
- `source=simulation` → demo records, must use a demo aircraft. `camera|upload` → real records, real aircraft.
- `detection_mode`: `ai` only when `backend/models/aerospectra-defects.pt` exists **and** loads with Ultralytics;
  `simulated` for synthetic footage (ground-truth boxes); `none` otherwise (video still processed/recorded).
- Duplicate suppression: same category + IoU > 0.3 within 4 s is treated as the same finding.
- Simulation sessions auto-abort after 30 s with no WebSocket viewers. Sessions left running by a crash are marked `aborted` at startup.
- Triage priority (`high|medium|low`) is rule-based (`app/services/triage.py`) and is **not** a certified severity.

## Not yet implemented / future
- Authentication & user accounts (reviewer is a free-text field).
- Drone flight control / telemetry from real hardware (only the camera feed is in scope).
- Elilvendan B2 / WiFi UFO direct stream decoder (protocol unverified — use the scrcpy → OBS Virtual Camera bridge).
- Alembic migrations (tables are created with `create_all`; add Alembic before production PostgreSQL use).
- Multi-drone / concurrent sessions.
