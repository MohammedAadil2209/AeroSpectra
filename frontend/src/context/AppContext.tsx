import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ActiveInspection, DataScope, Detection, Health, WsEvent } from '@/types';
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const setScope = useCallback((s: DataScope) => {
    localStorage.setItem(SCOPE_KEY, s);
    setScopeState(s);
  }, []);

  const notify = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastId.current;
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 5200);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((x) => x.id !== id)), []);
  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const refreshHealth = useCallback(async () => {
    try {
      const h = await getHealth();
      connection.online = true;
      setHealth(h);
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

  useEffect(
    () =>
      inspectionSocket.subscribe((ev) => {
        switch (ev.type) {
          case 'connection':
          case 'pong':
            setActive(ev.data.active_inspection);
            break;
          case 'inspection_started':
            setLive([]);
            bumpData();
            break;
          case 'inspection_paused':
            setActive((a) => (a ? { ...a, status: 'paused' } : a));
            break;
          case 'inspection_resumed':
            setActive((a) => (a ? { ...a, status: 'active' } : a));
            break;
          case 'inspection_stopped':
            setActive(null);
            bumpData();
            if (ev.data.status === 'failed') notify({ tone: 'crit', title: 'Inspection failed', body: ev.data.error ?? undefined });
            else if (ev.data.reason === 'end_of_video')
              notify({ tone: 'info', title: 'End of uploaded video', body: `${ev.data.inspection_id} completed · ${ev.data.detections} detection(s)` });
            break;
          case 'recording_status':
            setActive((a) => (a ? { ...a, recording: ev.data.recording } : a));
            break;
          case 'frame':
            setActive((a) =>
              a && a.inspection_id === ev.data.inspection_id
                ? { ...a, frames: ev.data.frame, elapsed_s: ev.data.elapsed_s, detections: ev.data.detections, section: ev.data.section }
                : a,
            );
            break;
          case 'detection':
            setLive((l) => [ev.data.detection, ...l].slice(0, 100));
            bumpData();
            break;
          case 'detection_reviewed':
            setLive((l) => l.map((d) => (d.id === ev.data.detection.id ? ev.data.detection : d)));
            break;
          case 'error':
            notify({ tone: 'warn', title: 'Pipeline warning', body: ev.data.message });
            break;
        }
      }),
    [bumpData, notify],
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
      toasts,
      notify,
      dismiss,
      subscribe: (fn) => inspectionSocket.subscribe(fn),
    }),
    [scope, setScope, health, backendOnline, healthChecked, refreshHealth, wsState, dataVersion, bumpData, active, liveDetections, toasts, notify, dismiss],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside AppProvider');
  return v;
}
