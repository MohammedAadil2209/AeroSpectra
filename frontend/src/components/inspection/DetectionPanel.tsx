import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ScanSearch, X } from 'lucide-react';
import type { DataScope, Detection, DetectionMode } from '@/types';
import { detectionService } from '@/services/dataService';
import { useApp } from '@/context/AppContext';
import { EvidenceImage } from '@/components/ui/EvidenceImage';
import { CategoryChip, EmptyState, OriginBadge, ReviewChip, cx } from '@/components/ui/primitives';
import { CATEGORY_COLOR, CATEGORY_LABEL } from '@/utils/labels';
import { fmtClock, pct } from '@/utils/format';

/** Live detection feed for the current session with quick human review. */
export function DetectionPanel({ detections, mode, scope, running }: { detections: Detection[]; mode: DetectionMode | null; scope: DataScope; running: boolean }) {
  const { notify, bumpData } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState<Record<string, Detection>>({});
  const list = detections.map((d) => local[d.id] ?? d);
  const latest = list[0];

  const review = async (d: Detection, status: 'confirmed' | 'false_positive') => {
    setBusy(d.id);
    try {
      const out = await detectionService.review(d.id, scope, status, 'Live operator', null);
      setLocal((l) => ({ ...l, [d.id]: out }));
      bumpData();
      notify({ tone: 'ok', title: `${d.id} marked ${status === 'confirmed' ? 'Confirmed' : 'False Positive'}` });
    } catch (e) {
      notify({ tone: 'crit', title: 'Review failed', body: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {mode === 'none' && (
        <div className="m-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn-ink">
          <b>No AI model loaded.</b> Video is processed and can be recorded, but no defects are detected. Add YOLO weights to{' '}
          <code className="num">backend/models/aerospectra-defects.pt</code>.
        </div>
      )}
      {mode === 'simulated' && (
        <div className="m-3 rounded-lg border border-demo-line demo-ribbon p-3 text-xs text-demo-ink">
          <b>Simulated detections.</b> Boxes are synthetic ground truth from generated footage — not AI predictions.
        </div>
      )}

      {latest ? (
        <div className="mx-3 mb-3 rounded-lg border border-line-strong bg-surface-2 overflow-hidden">
          <div className="px-3 py-2 flex items-center gap-2 border-b border-line" style={{ boxShadow: `inset 3px 0 0 ${CATEGORY_COLOR[latest.category]}` }}>
            <span className="font-display font-bold tracking-wide text-sm">{CATEGORY_LABEL[latest.category].toUpperCase()} DETECTED</span>
            <OriginBadge origin={latest.origin} />
          </div>
          <EvidenceImage url={latest.evidence_url} bbox={latest.bbox} category={latest.category} confidence={latest.confidence} className="rounded-none" />
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 p-3 text-xs">
            <dt className="text-muted">Confidence</dt>
            <dd className="num text-ink text-right">{pct(latest.confidence)}</dd>
            <dt className="text-muted">Timestamp</dt>
            <dd className="num text-ink text-right">{fmtClock(latest.video_time_s)}</dd>
            <dt className="text-muted">Bounding box</dt>
            <dd className="num text-ink text-right">
              {Math.round(latest.bbox.x * (latest.bbox.frame_w ?? 1))},{Math.round(latest.bbox.y * (latest.bbox.frame_h ?? 1))} · {Math.round(latest.bbox.w * (latest.bbox.frame_w ?? 1))}×{Math.round(latest.bbox.h * (latest.bbox.frame_h ?? 1))} px
            </dd>
            <dt className="text-muted">Section</dt>
            <dd className="text-ink text-right">{latest.section}</dd>
            <dt className="text-muted">Status</dt>
            <dd className="text-right"><ReviewChip status={latest.review_status} /></dd>
          </dl>
          <div className="flex gap-2 px-3 pb-3">
            <button className="btn btn-sm flex-1" disabled={busy === latest.id || latest.review_status === 'confirmed'} onClick={() => review(latest, 'confirmed')}>
              <Check className="size-3.5" /> Confirm
            </button>
            <button className="btn btn-sm flex-1" disabled={busy === latest.id || latest.review_status === 'false_positive'} onClick={() => review(latest, 'false_positive')}>
              <X className="size-3.5" /> False positive
            </button>
            <Link to={`/defects/${latest.id}`} className="btn btn-sm">Open</Link>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<ScanSearch className="size-5" />}
          title={running ? 'Scanning…' : 'No detections in this session'}
          body={running ? (mode === 'none' ? 'Detection is disabled without a model.' : 'Potential defects will appear here in real time.') : 'Start an inspection to begin.'}
        />
      )}

      {list.length > 1 && (
        <div className="border-t border-line flex-1 min-h-0 overflow-y-auto">
          <div className="eyebrow px-3 pt-3 pb-1">Session detections ({list.length})</div>
          <ul>
            {list.slice(1).map((d) => (
              <li key={d.id}>
                <Link to={`/defects/${d.id}`} className={cx('flex items-center gap-3 px-3 py-2 hover:bg-surface-2')}>
                  <EvidenceImage url={d.evidence_url} bbox={d.bbox} category={d.category} className="w-16 shrink-0" thumb />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><CategoryChip category={d.category} /><span className="num text-xs text-ink">{pct(d.confidence)}</span></div>
                    <div className="text-[11px] text-muted num mt-0.5">{d.id} · {fmtClock(d.video_time_s)}</div>
                  </div>
                  <ReviewChip status={d.review_status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
