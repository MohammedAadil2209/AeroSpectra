/**
 * HTTP core. All backend access goes through here; UI never calls fetch directly.
 * API base resolution: localStorage override (Settings) > VITE_API_BASE_URL > same-origin (Vite proxy).
 * No secrets are stored or sent from the frontend.
 */
import type { Health } from '@/types';

const LS_KEY = 'aerospectra.apiBase';

export function getApiBase(): string {
  const override = typeof localStorage !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
  return (override ?? import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
}

export function setApiBase(url: string | null) {
  if (url && url.trim()) localStorage.setItem(LS_KEY, url.trim());
  else localStorage.removeItem(LS_KEY);
}

export function wsUrl(path = '/ws/inspection'): string {
  const base = getApiBase();
  if (base) return base.replace(/^http/, 'ws') + path;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

/** Demo evidence ships with the frontend (/demo/...); real evidence is served by the backend. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/.test(path) || path.startsWith('/demo/')) return path;
  return getApiBase() + path;
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public offline = false) {
    super(message);
  }
}

/** Shared connection flag, maintained by ConnectionProvider's health polling. */
export const connection = { online: false, checked: false };

export async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const { timeoutMs = 15000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(getApiBase() + path, {
      ...rest,
      signal: ctrl.signal,
      headers: rest.body instanceof FormData ? rest.headers : { 'Content-Type': 'application/json', ...rest.headers },
    });
  } catch (e) {
    throw new ApiError(
      (e as Error).name === 'AbortError' ? 'Backend request timed out.' : 'Backend unreachable. Start the FastAPI server (see README).',
      0,
      true,
    );
  } finally {
    clearTimeout(timer);
  }
  const ct = res.headers.get('content-type') ?? '';
  // Vite dev server answers unknown paths with index.html when the proxy target is down.
  if (!ct.includes('application/json')) {
    throw new ApiError(res.ok ? 'Backend unreachable (unexpected response).' : `Backend error ${res.status}`, res.status, res.status >= 500 || res.ok);
  }
  const body = await res.json();
  if (!res.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : JSON.stringify(body?.detail ?? body);
    throw new ApiError(detail, res.status, res.status === 502 || res.status === 504);
  }
  return body as T;
}

export const getHealth = () => request<Health>('/api/health', { timeoutMs: 4000 });

export const qs = (params: Record<string, unknown>) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  const s = p.toString();
  return s ? `?${s}` : '';
};
