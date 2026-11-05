import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActiveInspection, AIInfo, Analytics, DataScope, Detection, Health, InspectionProgress, WsEvent } from '@/types';
import { connection, getHealth } from '@/services/api';
import { inspectionSocket, type WsState } from '@/services/wsClient';

export interface Toast {
  id: number;
  tone: 'info' | 'ok' | 'warn' | 'crit';
  title: string;
  body?: string;
}

interface AppState {
  scope: DataScope;
  setScope: (s: DataScope) => void;
  health: Health | null;
  backendOnline: boolean;
  healthChecked: boolean;
  refreshHealth: () => Promise<void>;
  wsState: WsState;
  /** Bumps whenever server data changes (WS events, reviews) — include in fetch deps. */
  dataVersion: number;
  bumpData: () => void;
  active: ActiveInspection | null;
  setActive: (a: ActiveInspection | null) => void;
  liveDetections: Detection[];
  clearLiveDetections: () => void;
  /** Live AI runtime info (device, FPS, confidence) pushed over the event bus. */
  ai: AIInfo | null;
  setAi: (a: AIInfo | null) => void;
  /** Latest analytics pushed by the server (kpi.updated) per scope. */
  kpi: Partial<Record<DataScope, Analytics>>;
  /** Live progress of running inspections (inspection.updated). */
  liveProgress: Record<string, InspectionProgress>;
  /** Present mode: hides dev controls, enlarges live views, auto-cycles when idle. */
  presentMode: boolean;
  setPresentMode: (v: boolean) => void;
  toasts: Toast[];
  notify: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: number) => void;
  subscribe: (fn: (e: WsEvent) => void) => () => void;
}

const Ctx = createContext<AppState | null>(null);
const SCOPE_KEY = 'aerospectra.scope';

export function AppProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<DataScope>(() => (localStorage.getItem(SCOPE_KEY) as DataScope) || 'demo');
  const [health, setHealth] = useState<Health | null>(null);
  const [backendOnline, setOnline] = useState(false);
  const [healthChecked, setChecked] = useState(false);
  const [wsState, setWsState] = useState<WsState>('closed');
  const [dataVersion, setDataVersion] = useState(0);
  const [active, setActive] = useState<ActiveInspection | null>(null);
  const [liveDetections, setLive] = useState<Detection[]>([]);
  const [ai, setAi] = useState<AIInfo | null>(null);
  const [kpi, setKpi] = useState<Partial<Record<DataScope, Analytics>>>({});
  const [liveProgress, setLiveProgress] = useState<Record<string, InspectionProgress>>({});
  const [presentMode, setPresentModeState] = useState(() => localStorage.getItem('aerospectra.present') === '1');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const setScope = useCallback((s: DataScope) => {
    localStorage.setItem(SCOPE_KEY, s);
    setScopeState(s);
  }, []);
  const setPresentMode = useCallback((v: boolean) => {
    localStorage.setItem('aerospectra.present', v ? '1' : '0');
    setPresentModeState(v);
  }, []);

  const notify = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 5200);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);

  // Coalesce bursts of server events into at most ~3 refetch waves per second.
  const bumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpData = useCallback(() => {
    if (bumpTimer.current) return;
    bumpTimer.current = setTimeout(() => {
      bumpTimer.current = null;
      setDataVersion((v) => v + 1);
    }, 300);
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await getHealth();
      connection.online = true;
      setHealth(h);
      setAi((cur) => ({ ...(cur ?? {}), ...h.ai_model }));
      setOnline(true);
    } catch {
      connection.online = false;
      setHealth(null);
      setOnline(false);
    } finally {
      connection.checked = true;
      setChecked(true);
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    const t = setInterval(refreshHealth, 10000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  // WebSocket lifecycle follows backend availability
  useEffect(() => {
    if (backendOnline) inspectionSocket.connect();
    return inspectionSocket.onState(setWsState);
  }, [backendOnline]);
  // refetch everything after a reconnect (we may have missed events)
  const prevWs = useRef<WsState>('closed');
  useEffect(() => {
    if (wsState === 'open' && prevWs.current !== 'open') bumpData();
    prevWs.current = wsState;
  }, [wsState, bumpData]);

  const patchDetection = useCallback((d: Detection) => {
    setLive((l) => l.map((x) => (x.id === d.id ? d : x)));
  }, []);

  useEffect(
    () =>
      inspectionSocket.subscribe((ev) => {
        switch (ev.type) {
          case 'connection':
            setActive(ev.data.active_inspection);
            if (ev.data.ai) setAi((cur) => ({ ...(cur ?? {}), ...ev.data.ai! }));
            break;
          case 'pong':
            setActive(ev.data.active_inspection);
            break;
          case 'inspection.started':
            setLive([]);
            if (ev.data.active) setActive(ev.data.active);
            bumpData();
            break;
          case 'inspection.updated':
            setActive((a) => (a && a.inspection_id === ev.data.inspection_id ? { ...a, status: ev.data.status } : a));
            setLiveProgress((p) => ({ ...p, [ev.data.inspection_id]: { ...p[ev.data.inspection_id], ...ev.data } }));
            break;
          case 'inspection.ended':
            setActive(null);
            setLiveProgress((p) => {
              const n = { ...p };
              delete n[ev.data.inspection_id];
              return n;
            });
            bumpData();
            if (ev.data.status === 'failed') notify({ tone: 'crit', title: 'Inspection failed', body: ev.data.error ?? undefined });
            else if (ev.data.reason === 'end_of_video')
              notify({ tone: 'info', title: 'End of uploaded video', body: `${ev.data.inspection_id} completed · ${ev.data.detections} detection(s)` });
            break;
          case 'recording.status':
            setActive((a) => (a ? { ...a, recording: ev.data.recording } : a));
            break;
          case 'frame':
            setActive((a) =>
              a && a.inspection_id === ev.data.inspection_id
                ? {
                    ...a,
                    frames: ev.data.frame,
                    elapsed_s: ev.data.elapsed_s,
                    detections: ev.data.detections,
                    section: ev.data.section,
                    source_fps: ev.data.fps,
                    inference_fps: ev.data.inference_fps,
                    inference_ms: ev.data.inference_ms,
                    connected: ev.data.connected,
                    reconnects: ev.data.reconnects,
                    risk_counts: ev.data.risk_counts ?? a.risk_counts,
                    cost_min: ev.data.cost_min ?? a.cost_min,
                    cost_max: ev.data.cost_max ?? a.cost_max,
                  }
                : a,
            );
            if (ev.data.inference_fps !== undefined) setAi((cur) => (cur ? { ...cur, inference_fps: ev.data.inference_fps, inference_ms: ev.data.inference_ms } : cur));
            break;
          case 'detection.created':
            setLive((l) => [ev.data.detection, ...l].slice(0, 200));
            bumpData();
            break;
          case 'defect.updated':
          case 'maintenance.updated':
            patchDetection(ev.data.detection);
            bumpData();
            break;
          case 'risk.updated':
            if (!ev.data.preview) bumpData();
            break;
          case 'settings.updated':
            bumpData();
            break;
          case 'kpi.updated':
            setKpi((k) => ({ ...k, [ev.data.scope]: ev.data.analytics }));
            break;
          case 'ai.updated':
            setAi((cur) => ({ ...(cur ?? {}), ...ev.data.ai }));
            break;
          case 'error':
            notify({ tone: 'warn', title: 'Pipeline warning', body: ev.data.message });
            break;
        }
      }),
    [bumpData, notify, patchDetection],
  );

  const value = useMemo<AppState>(
    () => ({
      scope,
      setScope,
      health,
      backendOnline,
      healthChecked,
      refreshHealth,
      wsState,
      dataVersion,
      bumpData,
      active,
      setActive,
      liveDetections,
      clearLiveDetections: () => setLive([]),
      ai,
      setAi,
      kpi,
      liveProgress,
      presentMode,
      setPresentMode,
      toasts,
      notify,
      dismiss,
      subscribe: (fn) => inspectionSocket.subscribe(fn),
    }),
    [scope, setScope, health, backendOnline, healthChecked, refreshHealth, wsState, dataVersion, bumpData, active, liveDetections, ai, kpi, liveProgress, presentMode, setPresentMode, toasts, notify, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
