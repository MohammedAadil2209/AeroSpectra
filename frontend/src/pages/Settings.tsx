import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, Database, ExternalLink, Info, Radio, RefreshCw, RotateCcw, Server, Video } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { getApiBase, setApiBase } from '@/services/api';
import { demoStore } from '@/services/demoStore';
import { inspectionSocket } from '@/services/wsClient';
import { CameraSetup, CAMERA_URI_KEY } from '@/components/inspection/SourceSetup';
import { KeyValue, PageHeader, Panel, STATUS_TEXT, StatusDot } from '@/components/ui/primitives';
import type { ComponentStatus } from '@/types';

function StatusRow({ icon, label, status, detail }: { icon: React.ReactNode; label: string; status: ComponentStatus['status']; detail: string }) {
  return (
    <div className="flex items-start gap-3 py-3 border-b border-line last:border-0">
      <span className="text-muted mt-0.5">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm text-ink">{label}<StatusDot status={status} /><span className="text-xs text-muted">{STATUS_TEXT[status]}</span></div>
        <div className="text-xs text-muted mt-0.5 break-words">{detail}</div>
      </div>
    </div>
  );
}

const ENDPOINTS: [string, string, string][] = [
  ['GET', '/api/health', 'Component status'],
  ['GET', '/api/aircraft', '?scope=demo|real'],
  ['POST', '/api/aircraft', 'Register real aircraft'],
  ['GET', '/api/inspections', 'List sessions'],
  ['POST', '/api/inspections/start', 'Start (camera | upload | simulation)'],
  ['POST', '/api/inspections/stop', 'Stop active session'],
  ['POST', '/api/inspections/pause · /resume', 'Pause / resume'],
  ['POST', '/api/inspections/recording', 'Start / stop recording'],
  ['GET', '/api/inspections/{id}', 'Session + detections'],
  ['GET', '/api/detections', 'Filterable records'],
  ['GET', '/api/detections/{id}', 'Single record'],
  ['PATCH', '/api/detections/{id}/review', 'Human review'],
  ['GET', '/api/analytics', 'Aggregates'],
  ['POST', '/api/video/upload', 'Upload inspection video'],
  ['POST', '/api/video/camera/test', 'Probe camera source'],
  ['GET', '/api/video/stream', 'MJPEG annotated frames'],
  ['WS', '/ws/inspection', 'Real-time events'],
];

export default function Settings() {
  const { health, backendOnline, refreshHealth, wsState, notify } = useApp();
  const [api, setApi] = useState(localStorage.getItem('aerospectra.apiBase') ?? '');
  const [cam, setCam] = useState(localStorage.getItem(CAMERA_URI_KEY) ?? '0');
  const [checking, setChecking] = useState(false);

  return (
    <>
      <PageHeader eyebrow="Configuration" title="System Settings" subtitle="Connection status, API configuration and application information. No API keys or secrets are stored in the frontend." />
      <div className="grid sm:grid-cols-2 gap-3 mb-4">
        <Link to="/roi" className="panel p-4 hover:bg-surface-2 transition-colors">
          <div className="font-display font-semibold">Cost assumptions →</div>
          <div className="text-xs text-muted mt-1">Currency (INR default), labour rate, AOG cost, repair cost table, manual vs drone inspection, subscription tiers. Versioned & audited.</div>
        </Link>
        <Link to="/risk" className="panel p-4 hover:bg-surface-2 transition-colors">
          <div className="font-display font-semibold">Risk engine weights →</div>
          <div className="text-xs text-muted mt-1">Severity, section criticality, thresholds and presets. Advisory scores only.</div>
        </Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="System status"
          actions={
            <button className="btn btn-sm" disabled={checking} onClick={async () => (setChecking(true), await refreshHealth(), setChecking(false))}>
              <RefreshCw className={`size-3.5 ${checking ? 'animate-spin' : ''}`} /> Re-check
            </button>
          }
        >
          <StatusRow icon={<Server className="size-4" />} label="Backend connection" status={backendOnline ? 'online' : 'offline'} detail={backendOnline ? `AeroSpectra API v${health?.version} at ${getApiBase() || window.location.origin + ' (proxied)'}` : 'FastAPI backend not reachable. Run: cd backend && .venv/bin/uvicorn app.main:app --port 8000'} />
          <StatusRow icon={<Radio className="size-4" />} label="Real-time link (WebSocket)" status={wsState === 'open' ? 'online' : wsState === 'connecting' ? 'degraded' : 'offline'} detail={`/ws/inspection · ${wsState}`} />
          <StatusRow icon={<Database className="size-4" />} label="Database" status={health?.database.status ?? 'offline'} detail={health ? `${health.database.detail} (SQLAlchemy — PostgreSQL-ready via AEROSPECTRA_DATABASE_URL)` : '—'} />
          <StatusRow icon={<Cpu className="size-4" />} label="AI model (YOLO)" status={health?.ai_model.status ?? 'offline'} detail={health?.ai_model.detail ?? 'Unknown — backend offline'} />
          <StatusRow icon={<Video className="size-4" />} label="Camera connection" status={health?.camera.status ?? 'offline'} detail={health?.camera.detail ?? 'Unknown — backend offline'} />
          {wsState !== 'open' && backendOnline && <button className="btn btn-sm mt-3" onClick={() => inspectionSocket.reconnectNow()}>Reconnect WebSocket</button>}
        </Panel>

        <Panel title="API configuration">
          <div className="space-y-4">
            <div>
              <label className="label" htmlFor="api">Backend base URL</label>
              <div className="flex gap-2">
                <input id="api" className="field num" placeholder="(blank = same origin via Vite proxy → http://127.0.0.1:8000)" value={api} onChange={(e) => setApi(e.target.value)} />
                <button
                  className="btn shrink-0"
                  onClick={async () => {
                    setApiBase(api || null);
                    inspectionSocket.reconnectNow();
                    await refreshHealth();
                    notify({ tone: 'info', title: 'API base updated', body: api || 'Using same-origin proxy' });
                  }}
                >
                  Apply
                </button>
              </div>
              <p className="text-[11px] text-faint mt-1">Stored in this browser only. Use when the backend runs on another machine (e.g. http://192.168.1.20:8000).</p>
            </div>
            <div className="border-t border-line pt-4">
              <div className="label">Live camera</div>
              <CameraSetup uri={cam} onUri={setCam} backendOnline={backendOnline} />
            </div>
            <div className="border-t border-line pt-4 flex flex-wrap gap-2">
              <a className="btn btn-sm" href={`${getApiBase()}/docs`} target="_blank" rel="noreferrer"><ExternalLink className="size-3.5" /> OpenAPI docs</a>
              <button className="btn btn-sm" onClick={() => (demoStore.resetReviews(), notify({ tone: 'info', title: 'Offline demo reviews reset' }))}>
                <RotateCcw className="size-3.5" /> Reset offline demo reviews
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="API endpoints" bodyClass="p-0">
          <table className="table">
            <tbody>
              {ENDPOINTS.map(([m, p, d]) => (
                <tr key={m + p}><td className="w-16"><span className="chip border-line text-steel-bright num">{m}</span></td><td className="num text-xs text-ink">{p}</td><td className="text-xs text-muted">{d}</td></tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Application information" icon={<Info className="size-4 text-steel" />}>
          <KeyValue k="Application" v="AeroSpectra — AI-Powered Aircraft Visual Inspection" />
          <KeyValue k="Frontend" v="React 19 · Vite · TypeScript · Tailwind · R3F" />
          <KeyValue k="Backend" v="FastAPI · OpenCV · SQLAlchemy (SQLite)" />
          <KeyValue k="Version" v={health?.version ?? '1.0.0'} mono />
          <KeyValue k="Event" v="T-Hub BuildX Hackathon" />
          <KeyValue k="Planned hardware" v="Elilvendan B2 quadcopter (feed via WiFi UFO — bridge in development)" />
          <p className="text-xs text-muted mt-3 leading-relaxed">
            AeroSpectra flags <b className="text-ink">potential</b> surface defects (cracks, dents, corrosion) for human review. It does not issue airworthiness determinations. Demonstration data is fictional
            and is never mixed with real inspection records.
          </p>
        </Panel>
      </div>
    </>
  );
}
