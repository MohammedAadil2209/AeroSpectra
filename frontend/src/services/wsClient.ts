/** WebSocket client for /ws/inspection with auto-reconnect and a tiny pub/sub. */
import type { WsEvent } from '@/types';
import { wsUrl } from './api';

type Listener = (e: WsEvent) => void;
export type WsState = 'connecting' | 'open' | 'closed';

class InspectionSocket {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private stateListeners = new Set<(s: WsState) => void>();
  private retry = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private wanted = false;
  state: WsState = 'closed';

  connect() {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setState('open');
      this.pingTimer = setInterval(() => this.send('ping', {}), 15000);
    };
    ws.onmessage = (m) => {
      try {
        const ev = JSON.parse(m.data) as WsEvent;
        this.listeners.forEach((l) => l(ev));
      } catch {
        /* ignore malformed */
      }
    };
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.ws = null;
      this.setState('closed');
      if (this.wanted) this.scheduleReconnect();
    };
    ws.onerror = () => ws.close();
  }

  private scheduleReconnect() {
    if (this.timer) clearTimeout(this.timer);
    const delay = Math.min(15000, 1000 * 2 ** this.retry++);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  reconnectNow() {
    this.retry = 0;
    this.ws?.close();
    this.connect();
  }

  disconnect() {
    this.wanted = false;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }

  send(type: string, data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type, data }));
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  onState(l: (s: WsState) => void) {
    this.stateListeners.add(l);
    l(this.state);
    return () => void this.stateListeners.delete(l);
  }

  private setState(s: WsState) {
    this.state = s;
    this.stateListeners.forEach((l) => l(s));
  }
}

export const inspectionSocket = new InspectionSocket();
