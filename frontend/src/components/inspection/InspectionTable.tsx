import { Film } from 'lucide-react';
import type { Inspection } from '@/types';
import { mediaUrl } from '@/services/api';
import { DemoBadge, InspectionStatusChip, SourceChip } from '@/components/ui/primitives';
import { fmtDateTime, fmtDuration } from '@/utils/format';
import { DETECTION_MODE_LABEL } from '@/utils/labels';

export function InspectionTable({ rows, onOpen, showAircraft = true }: { rows: Inspection[]; onOpen: (i: Inspection) => void; showAircraft?: boolean }) {
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
              <td><InspectionStatusChip status={i.status} /></td>
              <td className="text-right num text-ink">{i.detection_count}</td>
              <td className="text-xs">
                {i.recording_url ? (
                  <a href={mediaUrl(i.recording_url) ?? '#'} onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-steel-bright hover:underline" download>
                    <Film className="size-3.5" /> Recording
                  </a>
                ) : i.is_demo ? (
                  <DemoBadge label="demo" />
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
