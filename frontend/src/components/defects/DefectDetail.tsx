import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, Save } from 'lucide-react';
import type { Category, DataScope, Detection, ReviewStatus } from '@/types';
import { aircraftService, detectionService } from '@/services/dataService';
import { useAsync } from '@/hooks/useAsync';
import { useApp } from '@/context/AppContext';
import { EvidenceImage } from '@/components/ui/EvidenceImage';
import { CategoryChip, KeyValue, OriginBadge, PriorityChip, ReviewChip, cx } from '@/components/ui/primitives';
import { CATEGORIES, CATEGORY_LABEL, REVIEW_LABEL, REVIEW_STATUSES } from '@/utils/labels';
import { Advisory, MaintenanceChip, RiskBadge, RiskBreakdownBar } from '@/components/risk/RiskBits';
import { MaintenancePanel } from './MaintenancePanel';
import { fmtMoneyRange } from '@/utils/format';
import { fmtClock, fmtDateTime, pct } from '@/utils/format';

const REVIEWER_KEY = 'aerospectra.reviewer';

/** Lifecycle: AI prediction / simulated → human review → confirmed defect or false positive. */
function Lifecycle({ d }: { d: Detection }) {
  const steps = [
    { label: d.origin === 'ai' ? 'AI prediction' : 'Simulated detection', done: true },
    { label: 'Human review', done: d.review_status !== 'pending' },
    { label: d.review_status === 'false_positive' ? 'False positive' : d.review_status === 'confirmed' ? 'Confirmed defect' : 'Outcome', done: d.review_status === 'confirmed' || d.review_status === 'false_positive' },
  ];
  return (
    <ol className="flex items-center gap-2 text-[11px]">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-2">
          <span className={cx('size-5 rounded-full grid place-items-center border', s.done ? 'bg-navy border-navy text-white' : 'border-line-strong text-faint')}>
            {s.done ? <Check className="size-3" /> : i + 1}
          </span>
          <span className={s.done ? 'text-ink' : 'text-faint'}>{s.label}</span>
          {i < steps.length - 1 && <span className="w-6 h-px bg-line-strong" />}
        </li>
      ))}
    </ol>
  );
}

export function DefectDetail({ detection, scope, onUpdated }: { detection: Detection; scope: DataScope; onUpdated: (d: Detection) => void }) {
  const { notify, bumpData } = useApp();
  const [status, setStatus] = useState<ReviewStatus>(detection.review_status);
  const [reviewer, setReviewer] = useState(detection.reviewer ?? localStorage.getItem(REVIEWER_KEY) ?? '');
  const [notes, setNotes] = useState(detection.reviewer_notes);
  const [category, setCategory] = useState<Category>(detection.category);
  const [saving, setSaving] = useState(false);
  const ac = useAsync(() => aircraftService.get(detection.aircraft_id, scope), [detection.aircraft_id, scope]);

  useEffect(() => {
    setStatus(detection.review_status);
    setNotes(detection.reviewer_notes);
    setCategory(detection.category);
    setReviewer(detection.reviewer ?? localStorage.getItem(REVIEWER_KEY) ?? '');
  }, [detection]);

  const dirty = category !== detection.category || status !== detection.review_status || notes !== detection.reviewer_notes || (reviewer || null) !== (detection.reviewer || null);
  const fw = detection.bbox.frame_w ?? 0;
  const fh = detection.bbox.frame_h ?? 0;

  const save = async () => {
    if (status !== 'pending' && !reviewer.trim()) return notify({ tone: 'warn', title: 'Reviewer name required', body: 'Record who reviewed this finding.' });
    setSaving(true);
    try {
      localStorage.setItem(REVIEWER_KEY, reviewer.trim());
      const out = await detectionService.review(detection.id, scope, status, reviewer.trim() || null, notes, category !== detection.category ? category : undefined);
      onUpdated(out);
      bumpData();
      notify({ tone: 'ok', title: `Review saved · ${REVIEW_LABEL[status]}`, body: detection.id });
    } catch (e) {
      notify({ tone: 'crit', title: 'Could not save review', body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-5 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <CategoryChip category={detection.category} />
        <OriginBadge origin={detection.origin} />
        <PriorityChip priority={detection.priority} />
        <ReviewChip status={detection.review_status} />
        <RiskBadge level={detection.risk_level} score={detection.risk_score} />
        <MaintenanceChip status={detection.maintenance_status} />
      </div>
      <EvidenceImage url={detection.evidence_url} bbox={detection.bbox} category={detection.category} confidence={detection.confidence} className="border border-line" />
      <Lifecycle d={detection} />

      <div className="rounded-lg border border-line p-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="font-display font-semibold">Why this score</div>
          <RiskBadge level={detection.risk_level} score={detection.risk_score} />
          <span className="ml-auto text-xs text-muted" title="Estimate, based on editable assumptions">Est. repair <b className="num text-ink">{fmtMoneyRange(detection.cost_min, detection.cost_max)}</b> · {detection.labour_hours ?? 0} h</span>
        </div>
        <RiskBreakdownBar breakdown={detection.risk_breakdown} score={detection.risk_score} level={detection.risk_level} />
        <Advisory text={detection.recommendation} />
      </div>

      <div className="grid md:grid-cols-2 gap-x-6">
        <div>
          <div className="eyebrow mb-1">Detection</div>
          <KeyValue k="Defect ID" v={detection.id} mono />
          <KeyValue k="Confidence" v={pct(detection.confidence, 1)} mono />
          <KeyValue k="Detected at" v={fmtDateTime(detection.detected_at)} />
          <KeyValue k="Video timestamp" v={fmtClock(detection.video_time_s)} mono />
          <KeyValue k="Bounding box" v={fw ? `x ${Math.round(detection.bbox.x * fw)} · y ${Math.round(detection.bbox.y * fh)} · ${Math.round(detection.bbox.w * fw)}×${Math.round(detection.bbox.h * fh)} px` : '—'} mono />
          <KeyValue k="Frame size" v={fw ? `${fw}×${fh}` : '—'} mono />
          <KeyValue k="Detector" v={detection.model_name || '—'} />
        </div>
        <div>
          <div className="eyebrow mb-1 mt-4 md:mt-0">Context</div>
          <KeyValue k="Aircraft" v={<Link className="text-steel-bright hover:underline" to={`/aircraft/${detection.aircraft_id}`}>{detection.aircraft_id}</Link>} />
          <KeyValue k="Model / reg." v={ac.data ? `${ac.data.model} · ${ac.data.registration}` : '…'} />
          <KeyValue k="Inspection session" v={<Link className="text-steel-bright hover:underline num" to={`/inspections/${detection.inspection_id}`}>{detection.inspection_id}</Link>} />
          <KeyValue k="Aircraft section" v={detection.section} />
          <KeyValue k="Triage priority" v={<PriorityChip priority={detection.priority} />} />
          <KeyValue k="Reviewed" v={detection.reviewed_at ? `${fmtDateTime(detection.reviewed_at)} · ${detection.reviewer ?? ''}` : 'Not yet'} />
        </div>
      </div>

      <div className="rounded-lg border border-line bg-surface-2/50 p-4 space-y-3">
        <div className="font-display font-semibold">Human review</div>
        <div>
          <label className="label" htmlFor="recls">Defect type {detection.original_category && <span className="text-faint">(AI reported: {detection.original_category})</span>}</label>
          <select id="recls" className="field" value={category} onChange={(e) => setCategory(e.target.value as Category)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}{c === 'defect' ? ' (generic, unclassified)' : ''}</option>)}
          </select>
          {detection.category === 'defect' && <p className="text-[11px] text-faint mt-1">The single-class AI model reports a generic “defect”. Re-classify it as crack, dent or corrosion — the risk score and cost estimate update instantly.</p>}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup" aria-label="Review status">
          {REVIEW_STATUSES.map((s) => (
            <button
              key={s}
              role="radio"
              aria-checked={status === s}
              onClick={() => setStatus(s)}
              className={cx('rounded-lg border px-2 py-2 text-xs font-semibold transition-colors', status === s ? 'border-steel bg-steel/15 text-ink' : 'border-line text-muted hover:text-ink hover:border-line-strong')}
            >
              {REVIEW_LABEL[s]}
            </button>
          ))}
        </div>
        <div>
          <label className="label" htmlFor="reviewer">Reviewer</label>
          <input id="reviewer" className="field" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Name / staff ID" />
        </div>
        <div>
          <label className="label" htmlFor="notes">Reviewer notes</label>
          <textarea id="notes" className="field" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observations, measurements, recommended follow-up…" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] text-faint">A confirmed finding still requires disposition by certified maintenance personnel.</p>
          <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save review
          </button>
        </div>
      </div>
      {scope === 'real' || detection.is_demo ? <MaintenancePanel detection={detection} onUpdated={onUpdated} /> : null}
    </div>
  );
}
