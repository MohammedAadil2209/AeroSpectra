import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2 } from 'lucide-react';
import type { Detection, MaintenanceEvent, MaintenanceStatus } from '@/types';
import { useApp } from '@/context/AppContext';
import { maintenanceService } from '@/services/dataService';
import { mediaUrl } from '@/services/api';
import { EvidenceImage } from '@/components/ui/EvidenceImage';
import { cx } from '@/components/ui/primitives';
import { MaintenanceChip } from '@/components/risk/RiskBits';
import { MAINTENANCE_FLOW, MAINTENANCE_LABEL, MAINTENANCE_TRANSITIONS } from '@/utils/labels';
import { fmtDateTime, fmtMoney, fmtMoneyRange } from '@/utils/format';

const REVIEWER_KEY = 'aerospectra.reviewer';

/** Defect lifecycle: Detected → Confirmed → Work order → Repair → Repaired → Verified & Cleared (+ FP / Deferred). */
export function MaintenancePanel({ detection, onUpdated }: { detection: Detection; onUpdated: (d: Detection) => void }) {
  const { notify, backendOnline, dataVersion } = useApp();
  const status: MaintenanceStatus = detection.maintenance_status ?? 'detected';
  const [to, setTo] = useState<MaintenanceStatus | ''>('');
  const [actor, setActor] = useState(() => localStorage.getItem(REVIEWER_KEY) ?? '');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [cost, setCost] = useState<string>('');
  const [hours, setHours] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<MaintenanceEvent[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!backendOnline) return;
    maintenanceService.events(detection.id).then(setEvents).catch(() => setEvents([]));
  }, [detection.id, detection.maintenance_status, backendOnline, dataVersion]);
  useEffect(() => setTo(''), [detection.id, status]);

  const options = MAINTENANCE_TRANSITIONS[status];
  const needsReason = to === 'false_positive' || to === 'deferred';
  const showActuals = to === 'repaired' || to === 'cleared' || to === 'repair_in_progress';
  const stepIdx = MAINTENANCE_FLOW.indexOf(status);

  const submit = async () => {
    if (!to) return;
    if (!actor.trim()) return notify({ tone: 'warn', title: 'Name required', body: 'Record who performed this step.' });
    if (needsReason && !reason.trim()) return notify({ tone: 'warn', title: 'Reason required', body: `${MAINTENANCE_LABEL[to]} needs a reason.` });
    setBusy(true);
    try {
      localStorage.setItem(REVIEWER_KEY, actor.trim());
      const out = await maintenanceService.transition(detection.id, {
        to_status: to, actor: actor.trim(), notes, reason,
        actual_cost: cost === '' ? null : Number(cost), actual_labour_hours: hours === '' ? null : Number(hours),
      });
      onUpdated(out.detection);
      setNotes(''); setReason(''); setCost(''); setHours('');
      notify({ tone: 'ok', title: MAINTENANCE_LABEL[to], body: `${detection.id} · by ${actor.trim()}` });
    } catch (e) {
      notify({ tone: 'crit', title: 'Transition rejected', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const out = await maintenanceService.uploadPhoto(detection.id, f);
      onUpdated(out.detection);
      notify({ tone: 'ok', title: 'After-repair photo uploaded' });
    } catch (e) {
      notify({ tone: 'crit', title: 'Upload failed', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-line bg-surface-2/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="font-display font-semibold">Maintenance lifecycle</div>
        <MaintenanceChip status={status} />
      </div>
      <ol className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
        {MAINTENANCE_FLOW.map((s, i) => {
          const done = stepIdx >= 0 && i <= stepIdx;
          return (
            <li key={s} className="flex items-center gap-1.5">
              <span className={cx('size-4.5 rounded-full grid place-items-center border px-1', done ? 'bg-navy border-navy text-white' : 'border-line-strong text-faint')}>
                {done ? <Check className="size-3" /> : i + 1}
              </span>
              <span className={done ? 'text-ink' : 'text-faint'}>{MAINTENANCE_LABEL[s]}</span>
              {i < MAINTENANCE_FLOW.length - 1 && <span className="w-3 h-px bg-line-strong" />}
            </li>
          );
        })}
      </ol>

      <div className="grid grid-cols-2 gap-x-4 text-xs">
        <div className="text-muted">Estimated repair</div>
        <div className="num text-right">{fmtMoneyRange(detection.cost_min, detection.cost_max)} · {detection.labour_hours ?? 0} h</div>
        <div className="text-muted">Actual (recorded)</div>
        <div className="num text-right">{detection.actual_cost != null ? fmtMoney(detection.actual_cost) : '—'} · {detection.actual_labour_hours ?? '—'} h</div>
        {detection.cleared_at && (<><div className="text-muted">Cleared</div><div className="text-right">{fmtDateTime(detection.cleared_at)} · {detection.cleared_by}</div></>)}
      </div>

      {options.length > 0 ? (
        <div className="space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Next maintenance step">
            {options.map((o) => (
              <button key={o} role="radio" aria-checked={to === o} onClick={() => setTo(o)}
                className={cx('rounded-lg border px-2.5 py-1.5 text-xs font-semibold', to === o ? 'border-steel bg-steel/15 text-ink' : 'border-line text-muted hover:text-ink')}>
                {MAINTENANCE_LABEL[o]}
              </button>
            ))}
          </div>
          {to && (
            <div className="grid sm:grid-cols-2 gap-2">
              <input className="field" placeholder="Engineer / inspector name" value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Actor" />
              {needsReason && <input className="field" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" />}
              {showActuals && <input className="field num" type="number" placeholder="Actual cost" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="Actual cost" />}
              {showActuals && <input className="field num" type="number" step={0.5} placeholder="Actual labour hours" value={hours} onChange={(e) => setHours(e.target.value)} aria-label="Actual labour hours" />}
              <input className="field sm:col-span-2" placeholder={to === 'work_order' ? 'Work order no. / notes' : 'Notes'} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
              <button className="btn btn-primary sm:col-span-2" onClick={submit} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Record: {MAINTENANCE_LABEL[to]}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-ok-ink border-t border-line pt-3">Verified & cleared — lifecycle complete.</div>
      )}

      <div className="border-t border-line pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="eyebrow">Before / after</div>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={busy}><Camera className="size-3.5" /> Upload after-repair photo</button>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => upload(e.target.files?.[0])} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <EvidenceImage url={detection.evidence_url} bbox={detection.bbox} category={detection.category} className="border border-line" thumb />
            <div className="text-[10px] text-muted mt-1">Before (detection evidence)</div>
          </div>
          <div>
            {detection.repair_photo_url ? (
              <img src={mediaUrl(detection.repair_photo_url) ?? ''} alt="After repair" className="w-full aspect-video object-cover rounded-md border border-line" />
            ) : (
              <div className="w-full aspect-video rounded-md border border-dashed border-line grid place-items-center text-[11px] text-faint">No after-repair photo yet</div>
            )}
            <div className="text-[10px] text-muted mt-1">After repair</div>
          </div>
        </div>
      </div>

      {events.length > 0 && (
        <div className="border-t border-line pt-3">
          <div className="eyebrow mb-1">History</div>
          <ul className="space-y-1.5 text-xs">
            {events.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="text-muted whitespace-nowrap">{fmtDateTime(e.at)}</span>
                <span className="flex-1">
                  {MAINTENANCE_LABEL[e.from_status]} → <b>{MAINTENANCE_LABEL[e.to_status]}</b> · {e.actor}
                  {e.reason && <span className="text-muted"> · {e.reason}</span>}
                  {e.notes && <span className="text-muted"> · {e.notes}</span>}
                  {e.actual_cost != null && <span className="text-muted"> · {fmtMoney(e.actual_cost)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
