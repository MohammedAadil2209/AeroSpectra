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
