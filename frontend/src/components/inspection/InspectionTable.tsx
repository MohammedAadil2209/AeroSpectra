import { Film } from 'lucide-react';
import type { Inspection } from '@/types';
import { mediaUrl } from '@/services/api';
import { useApp } from '@/context/AppContext';
import { InspectionStatusChip, SourceChip } from '@/components/ui/primitives';
import { fmtDateTime, fmtDuration } from '@/utils/format';
import { DETECTION_MODE_LABEL } from '@/utils/labels';

export function InspectionTable({ rows: raw, onOpen, showAircraft = true }: { rows: Inspection[]; onOpen: (i: Inspection) => void; showAircraft?: boolean }) {
  const { liveProgress, active } = useApp();
  // live sessions: merge the 1 Hz inspection.updated progress so counts/duration tick without refetching
  const rows = raw.map((i) => {
    const p = liveProgress[i.id];
    const isActive = active?.inspection_id === i.id;
    if (!p && !isActive) return i;
    return {
      ...i,
      status: (p?.status ?? active?.status ?? i.status) as Inspection['status'],
      detection_count: Math.max(i.detection_count, p?.detection_count ?? 0, isActive ? active!.detections : 0),
      duration_s: Math.max(i.duration_s, p?.duration_s ?? 0, isActive ? active!.elapsed_s : 0),
    };
  });
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Inspection ID</th>
            {showAircraft && <th>Aircraft</th>}
            <th>Date</th>
            <th>Duration</th>
            <th>Source</th>
            <th>Status</th>
            <th className="text-right">Detections</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.id} className="clickable" onClick={() => onOpen(i)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onOpen(i)}>
              <td>
                <div className="num text-ink text-xs">{i.id}</div>
                <div className="text-[11px] text-faint">{DETECTION_MODE_LABEL[i.detection_mode]}</div>
              </td>
              {showAircraft && <td className="num text-xs">{i.aircraft_id}</td>}
              <td className="text-xs whitespace-nowrap">{fmtDateTime(i.started_at)}</td>
              <td className="text-xs num">{fmtDuration(i.duration_s)}</td>
              <td><SourceChip source={i.source} /></td>
              <td>
                {i.status === 'active' || i.status === 'paused' ? (
                  <span className="inline-flex items-center gap-1.5 chip border-crimson/50 bg-crimson/10 text-crit-ink font-bold">
                    <span className={i.status === 'paused' ? 'size-2 rounded-full bg-warn' : 'size-2 rounded-full bg-crit pulse-dot'} />
                    {i.status === 'paused' ? 'PAUSED' : 'LIVE'}
                  </span>
                ) : (
                  <InspectionStatusChip status={i.status} />
                )}
              </td>
              <td className="text-right num text-ink">{i.detection_count}</td>
              <td className="text-xs">
                {i.recording_url ? (
                  <a href={mediaUrl(i.recording_url) ?? '#'} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-steel-bright hover:underline" download>
                    <Film className="size-3.5" /> Recording
                  </a>
                ) : (
                  <span className="text-faint">{i.detection_count ? 'Evidence images' : '—'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
