import type { Detection } from '@/types';
import { CategoryChip, OriginBadge, PriorityChip, ReviewChip, cx } from '@/components/ui/primitives';
import { EvidenceImage } from '@/components/ui/EvidenceImage';
import { fmtClock, fmtDateTime, pct } from '@/utils/format';

export function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[92px]">
      <div className="h-1.5 w-12 rounded-full bg-surface-3 overflow-hidden">
        <div className="h-full bg-steel" style={{ width: `${value * 100}%` }} />
      </div>
      <span className="num text-ink text-xs">{pct(value)}</span>
    </div>
  );
}

export function DetectionTable({ rows, onOpen, compact, showAircraft = true, selectedId }: {
  rows: Detection[]; onOpen: (d: Detection) => void; compact?: boolean; showAircraft?: boolean; selectedId?: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Evidence</th>
            <th>Defect ID</th>
            {showAircraft && <th>Aircraft</th>}
            <th>Category</th>
            <th>Confidence</th>
            {!compact && <th>Priority</th>}
            <th>Detected</th>
            {!compact && <th>Session</th>}
            {!compact && <th>Section</th>}
            <th>Review</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr
              key={d.id}
              className={cx('clickable', selectedId === d.id && 'bg-surface-2')}
              onClick={() => onOpen(d)}
              tabIndex={0}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(d))}
              aria-label={`Open defect ${d.id}`}
            >
              <td className="w-[84px]">
                <EvidenceImage url={d.evidence_url} bbox={d.bbox} category={d.category} className="w-[72px]" thumb />
              </td>
              <td>
                <div className="num text-ink text-xs">{d.id}</div>
                <div className="mt-0.5"><OriginBadge origin={d.origin} /></div>
              </td>
              {showAircraft && <td className="num text-xs">{d.aircraft_id}</td>}
              <td><CategoryChip category={d.category} /></td>
              <td><ConfidenceBar value={d.confidence} /></td>
              {!compact && <td><PriorityChip priority={d.priority} /></td>}
              <td className="text-xs whitespace-nowrap">
                {fmtDateTime(d.detected_at)}
                <div className="num text-faint">video {fmtClock(d.video_time_s)}</div>
              </td>
              {!compact && <td className="num text-xs">{d.inspection_id}</td>}
              {!compact && <td className="text-xs">{d.section}</td>}
              <td><ReviewChip status={d.review_status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
