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
  review: (id: string, scope: DataScope, review_status: ReviewStatus, reviewer: string | null, reviewer_notes: string | null) =>
    withFallback(
      scope,
      () => request<Detection>(`/api/detections/${encodeURIComponent(id)}/review`, {
        method: 'PATCH',
        body: JSON.stringify({ review_status, reviewer, reviewer_notes }),
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
