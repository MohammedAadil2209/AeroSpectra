/**
 * Domain services. Each call goes to the backend when it is online.
 * If the backend is offline:
 *   - demo scope  -> bundled demo dataset (demoStore), clearly flagged as offline demo
 *   - real scope  -> throws (real records are never fabricated)
 */
import type {
  ActiveInspection,
  Aircraft,
  Analytics,
  Category,
  DataScope,
  Detection,
  DetectionFilters,
  Inspection,
  InspectionDetail,
  ReviewStatus,
  SourceType,
  UploadInfo,
} from '@/types';
import { ApiError, connection, qs, request } from './api';
import { demoStore } from './demoStore';
import { computeAnalytics } from '@/utils/analytics';

const offlineReal = () =>
  new ApiError('Backend offline — real inspection records are only available from the AeroSpectra backend.', 0, true);

async function withFallback<T>(scope: DataScope, remote: () => Promise<T>, local: () => T): Promise<T> {
  if (connection.online || !connection.checked) {
    try {
      return await remote();
    } catch (e) {
      if (!(e instanceof ApiError && e.offline)) throw e;
    }
  }
  if (scope === 'demo') return local();
  throw offlineReal();
}

// ---------------------------------------------------------------- aircraft
export const aircraftService = {
  list: (scope: DataScope) => withFallback(scope, () => request<Aircraft[]>(`/api/aircraft${qs({ scope })}`), demoStore.aircraft),
  get: (id: string, scope: DataScope) =>
    withFallback(scope, () => request<Aircraft>(`/api/aircraft/${encodeURIComponent(id)}`), () => {
      const a = demoStore.aircraft().find((x) => x.id === id);
      if (!a) throw new ApiError('Aircraft not found', 404);
      return a;
    }),
  create: (body: { id: string; registration: string; model: string; operator?: string; base?: string }) =>
    request<Aircraft>('/api/aircraft', { method: 'POST', body: JSON.stringify(body) }),
};

// ---------------------------------------------------------------- inspections
export const inspectionService = {
  list: (scope: DataScope, aircraft_id?: string) =>
    withFallback(scope, () => request<Inspection[]>(`/api/inspections${qs({ scope, aircraft_id })}`), () => demoStore.inspections(aircraft_id)),
  get: (id: string, scope: DataScope) =>
    withFallback(scope, () => request<InspectionDetail>(`/api/inspections/${encodeURIComponent(id)}`), () => {
      const i = demoStore.inspection(id);
      if (!i) throw new ApiError('Inspection not found', 404);
      return i;
    }),
  active: () => request<{ active: ActiveInspection | null }>('/api/inspections/active', { timeoutMs: 4000 }),
  start: (body: { aircraft_id: string; source: SourceType; camera_uri?: string; upload_id?: string; record?: boolean; notes?: string }) =>
    request<Inspection>('/api/inspections/start', { method: 'POST', body: JSON.stringify(body), timeoutMs: 20000 }),
  stop: (inspection_id?: string) => request<{ stopped: string }>('/api/inspections/stop', { method: 'POST', body: JSON.stringify({ inspection_id }) }),
  pause: () => request('/api/inspections/pause', { method: 'POST' }),
  resume: () => request('/api/inspections/resume', { method: 'POST' }),
  setRecording: (recording: boolean) =>
    request<{ recording: boolean; recording_url: string | null }>('/api/inspections/recording', { method: 'POST', body: JSON.stringify({ recording }) }),
  setSection: (section: string) => request('/api/inspections/section', { method: 'POST', body: JSON.stringify({ section }) }),
};

// ---------------------------------------------------------------- video
export const videoService = {
  upload(file: File, onProgress?: (p: number) => void): Promise<UploadInfo> {
    // XHR for upload progress
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const base = (localStorage.getItem('aerospectra.apiBase') ?? import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
      xhr.open('POST', `${base}/api/video/upload`);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        try {
          const body = JSON.parse(xhr.responseText);
          if (xhr.status >= 200 && xhr.status < 300) resolve(body);
          else reject(new ApiError(body?.detail ?? `Upload failed (${xhr.status})`, xhr.status));
        } catch {
          reject(new ApiError('Backend unreachable — upload failed.', xhr.status, true));
        }
      };
      xhr.onerror = () => reject(new ApiError('Backend unreachable — upload failed.', 0, true));
      const fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    });
  },
  testCamera: (camera_uri: string) =>
    request<{ ok: boolean; message: string; width: number; height: number }>('/api/video/camera/test', {
      method: 'POST',
      body: JSON.stringify({ camera_uri }),
      timeoutMs: 20000,
    }),
  streamUrl: (base: string, nonce: string | number) => `${base}/api/video/stream?n=${nonce}`,
};

// ---------------------------------------------------------------- detections
export const detectionService = {
  list: (scope: DataScope, f: DetectionFilters = {}) =>
    withFallback(scope, () => request<Detection[]>(`/api/detections${qs({ scope, ...f })}`), () => demoStore.detections(f)),
  get: (id: string, scope: DataScope) =>
    withFallback(scope, () => request<Detection>(`/api/detections/${encodeURIComponent(id)}`), () => {
      const d = demoStore.detection(id);
      if (!d) throw new ApiError('Detection not found', 404);
      return d;
    }),
  review: (id: string, scope: DataScope, review_status: ReviewStatus, reviewer: string | null, reviewer_notes: string | null, category?: Category) =>
    withFallback(
      scope,
      () => request<Detection>(`/api/detections/${encodeURIComponent(id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ review_status, reviewer, reviewer_notes, category }),
      }),
      () => {
        const d = demoStore.review(id, review_status, reviewer, reviewer_notes);
        if (!d) throw new ApiError('Detection not found', 404);
        return d;
      },
    ),
};

// ---------------------------------------------------------------- analytics
export const analyticsService = {
  get: (scope: DataScope) =>
    withFallback(scope, () => request<Analytics>(`/api/analytics${qs({ scope })}`), () =>
      computeAnalytics('demo', demoStore.inspections(), demoStore.detections()),
    ),
};

// ---------------------------------------------------------------- v1.1: AI runtime, risk engine, cost & ROI, maintenance
import type { AIInfo, MaintenanceEvent, MaintenanceStatus, ModelCard, RiskLevel } from '@/types';

export interface SettingDoc<T> { key: string; value: T; version: number; updated_by: string; updated_at: string | null }
export interface RiskConfig {
  weights: Record<'severity' | 'size' | 'section' | 'confidence' | 'cluster' | 'recurrence', number>;
  thresholds: { medium: number; high: number; critical: number };
  severity: Record<string, number>;
  section_criticality: Record<string, number>;
  size_ref: number;
  cluster_ref: number;
  cluster_window_s: number;
  recurrence_ref: number;
}
export interface CostRow { min: number; max: number; labour_h: number }
export interface CostConfig {
  currency: string;
  currency_symbol: string;
  labour_rate: number;
  aog_cost_per_hour: number;
  ground_time_value_fraction: number;
  repair: Record<string, Record<RiskLevel, CostRow>>;
  manual_inspection: { hours: number; crew: number; other_cost: number };
  drone_inspection: { hours: number; crew: number; other_cost: number };
  early_detection_aog_hours_avoided_per_aircraft_month: number;
  inspections_per_aircraft_month: number;
  setup_cost: number;
  subscription_tiers: { name: string; max_aircraft: number; price_per_aircraft_month: number }[];
}
export interface AuditEntry { version: number; changed_by: string; changed_at: string; changes: Record<string, [unknown, unknown]>; note: string }
export interface RoiResult {
  label: string; currency: string; fleet_size: number; inspections_per_month: number;
  per_inspection: { manual_cost: number; drone_cost: number; direct_saving: number; manual_hours: number; drone_hours: number; hours_saved: number; ground_time_value: number; total_saving: number };
  aog_hours_avoided_month: number; aog_value_month: number; gross_savings_month: number; subscription_tier: string; subscription_month: number;
  net_savings_month: number; net_savings_year: number; setup_cost: number; payback_months: number | null; roi_pct: number | null;
  monthly_series: { month: number; cumulative_net: number }[];
  revenue_projection: { aircraft: number; tier: string; mrr: number; arr: number }[];
  assumptions: CostConfig;
}
export interface AircraftMaintenance {
  aircraft_id: string; currency: string;
  timeline: ({ kind: 'detected'; at: string; detection_id: string; category: string; section: string; risk_level: RiskLevel; inspection_id: string; cost_min: number; cost_max: number } | ({ kind: 'transition' } & MaintenanceEvent))[];
  by_section: { section: string; total: number; open: number; cleared: number; inspections: number; recurring: boolean }[];
  estimated_cost_min: number; estimated_cost_max: number; actual_cost: number; estimated_labour_hours: number; actual_labour_hours: number;
  estimate_vs_actual: { detection_id: string; category: string; section: string; estimate_min: number; estimate_max: number; actual: number }[];
  open: number; cleared: number;
}

export const aiService = {
  info: () => request<AIInfo & { model_card: ModelCard | null }>('/api/ai', { timeoutMs: 5000 }),
  update: (body: { confidence?: number; infer_every?: number }) => request<AIInfo>('/api/ai', { method: 'POST', body: JSON.stringify(body) }),
  reload: () => request<AIInfo>('/api/ai/reload', { method: 'POST', timeoutMs: 60000 }),
};

export const settingsService = {
  get: <T,>(key: 'risk' | 'cost') => request<SettingDoc<T>>(`/api/settings/${key}`),
  put: <T,>(key: 'risk' | 'cost', value: T, actor: string, note = '') =>
    request<SettingDoc<T>>(`/api/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value, actor, note }), timeoutMs: 30000 }),
  audit: (key: 'risk' | 'cost') => request<AuditEntry[]>(`/api/settings/${key}/audit`),
};

export const riskService = {
  preview: (value: Partial<RiskConfig>, scope: DataScope) =>
    request<{ counts: Record<RiskLevel, number>; detections: { id: string; risk_score: number; risk_level: RiskLevel; category: string; section: string; aircraft_id: string }[] }>(
      '/api/risk/preview', { method: 'POST', body: JSON.stringify({ value, scope, broadcast: true }) }),
  presets: () => request<{ presets: Record<string, Partial<RiskConfig>>; defaults: RiskConfig; recommendations: Record<RiskLevel, string>; disclaimer: string }>('/api/risk/presets'),
};

export const roiService = {
  get: (fleet: number, inspections_per_month?: number) => request<RoiResult>(`/api/roi${qs({ fleet, inspections_per_month })}`),
};

export const maintenanceService = {
  transition: (id: string, body: { to_status: MaintenanceStatus; actor: string; notes?: string; reason?: string; actual_cost?: number | null; actual_labour_hours?: number | null; photo_url?: string | null }) =>
    request<{ detection: Detection; event: MaintenanceEvent }>(`/api/detections/${encodeURIComponent(id)}/transition`, { method: 'POST', body: JSON.stringify(body) }),
  events: (id: string) => request<MaintenanceEvent[]>(`/api/detections/${encodeURIComponent(id)}/events`),
  uploadPhoto: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return request<{ photo_url: string; detection: Detection }>(`/api/detections/${encodeURIComponent(id)}/photo`, { method: 'POST', body: fd, timeoutMs: 60000 });
  },
  aircraft: (aircraftId: string) => request<AircraftMaintenance>(`/api/aircraft/${encodeURIComponent(aircraftId)}/maintenance`),
  costs: (inspectionId: string) => request<{ count: number; cost_min: number; cost_max: number; labour_hours: number; actual_cost: number; currency: string; label: string }>(`/api/inspections/${encodeURIComponent(inspectionId)}/costs`),
};

// ---------------------------------------------------------------- direct drone (RC UFO / cooingdv)
export interface DroneProbe {
  ok: boolean;
  message: string;
  preview_jpeg?: string | null;
  ip?: string;
  ip_source?: string;
  rtsp_url?: string;
  rtsp_reachable?: boolean | null;
  heartbeat_running?: boolean;
  heartbeats_sent?: number;
  heartbeat_replies?: number;
  alive?: boolean;
  module_id?: number | null;
  switch_mode?: number | null;
  lens?: string;
  transport?: string;
  width?: number;
  height?: number;
  fps?: number;
  warnings?: string[];
  errors?: string[];
  elapsed_s?: number;
}
export interface DroneStatus extends Partial<DroneProbe> {
  active: boolean;
  connected: boolean;
  state: 'idle' | 'streaming' | 'reconnecting';
  detected_ip?: string;
  reconnects?: number;
  last_test?: DroneProbe | null;
}
export const droneService = {
  status: (ip?: string) => request<DroneStatus>(`/api/drone/status${qs({ ip })}`, { timeoutMs: 6000 }),
  test: (ip?: string) => request<DroneProbe>('/api/drone/test', { method: 'POST', body: JSON.stringify({ ip }), timeoutMs: 15000 }),
  camera: (lens: 'front' | 'bottom', ip?: string) =>
    request<{ lens: string; reopened_stream: boolean; active: boolean }>('/api/drone/camera', { method: 'POST', body: JSON.stringify({ lens, ip }) }),
};
