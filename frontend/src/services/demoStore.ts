/**
 * Offline DEMO dataset (bundled from shared/demo-seed.json — same file the backend seeds from).
 * Used only for the demo scope when the backend is unreachable. Reviews persist to localStorage.
 * Never contains or mixes with real inspection records.
 */
import seed from '@shared/demo-seed.json';
import type { Aircraft, Detection, DetectionFilters, Inspection, InspectionDetail, ReviewStatus } from '@/types';
import { parseDate } from '@/utils/format';

type SeedInspection = Omit<Inspection, 'started_at' | 'ended_at' | 'detection_count'> & { started_offset_h: number };
type SeedDetection = Omit<Detection, 'detected_at' | 'reviewed_at'> & { detected_offset_h: number; reviewed_offset_h: number | null };

const REVIEW_KEY = 'aerospectra.demoReviews';
const now = Date.now();
const at = (h: number | null) => (h == null ? null : new Date(now - h * 3600_000).toISOString());

type ReviewPatch = Pick<Detection, 'review_status' | 'reviewer' | 'reviewer_notes' | 'reviewed_at'>;
function loadReviews(): Record<string, ReviewPatch> {
  try {
    return JSON.parse(localStorage.getItem(REVIEW_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const inspections: Inspection[] = (seed.inspections as unknown as SeedInspection[]).map(({ started_offset_h, ...i }) => {
  const started = at(started_offset_h)!;
  return {
    ...i,
    started_at: started,
    ended_at: new Date(new Date(started).getTime() + i.duration_s * 1000).toISOString(),
    detection_count: 0,
  };
});

const baseDetections: Detection[] = (seed.detections as unknown as SeedDetection[]).map(
  ({ detected_offset_h, reviewed_offset_h, ...d }) => ({
    ...d,
    detected_at: at(detected_offset_h)!,
    reviewed_at: at(reviewed_offset_h),
  }),
);

function detections(): Detection[] {
  const reviews = loadReviews();
  return baseDetections.map((d) => (reviews[d.id] ? { ...d, ...reviews[d.id] } : d));
}

for (const i of inspections) i.detection_count = baseDetections.filter((d) => d.inspection_id === i.id).length;

function aircraftList(): Aircraft[] {
  const dets = detections();
  return (seed.aircraft as Omit<Aircraft, 'inspection_count' | 'finding_count' | 'open_finding_count' | 'last_inspection_at'>[]).map((a) => {
    const ins = inspections.filter((i) => i.aircraft_id === a.id);
    const ds = dets.filter((d) => d.aircraft_id === a.id);
    const last = ins.map((i) => i.started_at).sort().at(-1) ?? null;
    return {
      ...a,
      inspection_count: ins.length,
      finding_count: ds.filter((d) => d.review_status !== 'false_positive').length,
      open_finding_count: ds.filter((d) => d.review_status === 'pending').length,
      last_inspection_at: last,
    };
  });
}

export const demoStore = {
  aircraft: aircraftList,
  inspections: (aircraftId?: string) =>
    inspections
      .filter((i) => !aircraftId || i.aircraft_id === aircraftId)
      .sort((a, b) => b.started_at.localeCompare(a.started_at)),
  inspection(id: string): InspectionDetail | null {
    const i = inspections.find((x) => x.id === id);
    if (!i) return null;
    return {
      ...i,
      aircraft: aircraftList().find((a) => a.id === i.aircraft_id)!,
      detections: detections().filter((d) => d.inspection_id === id).sort((a, b) => a.video_time_s - b.video_time_s),
    };
  },
  detections(f: DetectionFilters = {}): Detection[] {
    const q = f.q?.toLowerCase();
    const from = f.date_from ? new Date(f.date_from + 'T00:00:00Z').getTime() : null;
    const to = f.date_to ? new Date(f.date_to + 'T00:00:00Z').getTime() + 86400_000 : null;
    return detections()
      .filter((d) => {
        const t = parseDate(d.detected_at)!.getTime();
        return (
          (!f.category || d.category === f.category) &&
          (!f.review_status || d.review_status === f.review_status) &&
          (!f.aircraft_id || d.aircraft_id === f.aircraft_id) &&
          (!f.inspection_id || d.inspection_id === f.inspection_id) &&
          (f.min_confidence == null || d.confidence >= f.min_confidence) &&
          (f.max_confidence == null || d.confidence <= f.max_confidence) &&
          (from == null || t >= from) &&
          (to == null || t < to) &&
          (!q || [d.id, d.aircraft_id, d.inspection_id, d.section].some((s) => s.toLowerCase().includes(q)))
        );
      })
      .sort((a, b) => b.detected_at.localeCompare(a.detected_at));
  },
  detection: (id: string) => detections().find((d) => d.id === id) ?? null,
  review(id: string, status: ReviewStatus, reviewer: string | null, notes: string | null): Detection | null {
    const reviews = loadReviews();
    const cur = detections().find((d) => d.id === id);
    if (!cur) return null;
    reviews[id] = {
      review_status: status,
      reviewer: reviewer ?? cur.reviewer,
      reviewer_notes: notes ?? cur.reviewer_notes,
      reviewed_at: status === 'pending' ? null : new Date().toISOString(),
    };
    localStorage.setItem(REVIEW_KEY, JSON.stringify(reviews));
    return { ...cur, ...reviews[id] };
  },
  resetReviews: () => localStorage.removeItem(REVIEW_KEY),
};
