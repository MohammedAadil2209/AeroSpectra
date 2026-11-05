import type { Analytics, Category, DataScope, Detection, Inspection, ReviewStatus } from '@/types';
import { parseDate } from './format';

/** Same computation as backend repository.analytics — used for the offline demo dataset. */
export function computeAnalytics(scope: DataScope, inspections: Inspection[], detections: Detection[]): Analytics {
  const by_category: Record<Category, number> = { crack: 0, dent: 0, corrosion: 0, defect: 0 };
  const by_status: Record<ReviewStatus, number> = { pending: 0, reviewed: 0, confirmed: 0, false_positive: 0 };
  const by_section: Record<string, number> = {};
  const hist = new Array(10).fill(0);
  for (const d of detections) {
    by_category[d.category]++;
    by_status[d.review_status]++;
    by_section[d.section] = (by_section[d.section] ?? 0) + 1;
    hist[Math.min(9, Math.floor(d.confidence * 10))]++;
  }
  const trend = new Map<string, { inspections: number; crack: number; dent: number; corrosion: number; defect: number }>();
  const bucket = (s: string) => {
    const key = (parseDate(s) ?? new Date()).toISOString().slice(0, 10);
    if (!trend.has(key)) trend.set(key, { inspections: 0, crack: 0, dent: 0, corrosion: 0, defect: 0 });
    return trend.get(key)!;
  };
  inspections.forEach((i) => bucket(i.started_at).inspections++);
  detections.forEach((d) => bucket(d.detected_at)[d.category]++);

  const sortedSections = Object.fromEntries(Object.entries(by_section).sort((a, b) => b[1] - a[1]));
  return {
    scope,
    total_inspections: inspections.length,
    completed_inspections: inspections.filter((i) => i.status === 'completed').length,
    active_inspections: inspections.filter((i) => i.status === 'active' || i.status === 'paused').length,
    total_detections: detections.length,
    high_priority: detections.filter((d) => d.priority === 'high' && d.review_status !== 'false_positive').length,
    pending_reviews: by_status.pending,
    reviewed: by_status.reviewed,
    confirmed: by_status.confirmed,
    false_positives: by_status.false_positive,
    by_category,
    by_status,
    by_section: sortedSections,
    trend: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-30).map(([date, v]) => ({ date, ...v })),
    confidence_histogram: [4, 5, 6, 7, 8, 9].map((b) => ({ range: `${b * 10}-${b * 10 + 10}%`, count: hist[b] })),
  };
}
