import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeInfo, Cpu, Gauge, Radio, SlidersHorizontal, Timer, X } from 'lucide-react';
import type { ActiveInspection, Detection, ModelCard, RiskLevel } from '@/types';
import { useApp } from '@/context/AppContext';
import { aiService } from '@/services/dataService';
import { mediaUrl } from '@/services/api';
import { EvidenceImage } from '@/components/ui/EvidenceImage';
import { CategoryChip, cx } from '@/components/ui/primitives';
import { CostRange, RiskBadge } from '@/components/risk/RiskBits';
import { RISK_COLOR, RISK_LABEL, RISK_LEVELS } from '@/utils/labels';
import { fmtClock, fmtMoneyRange, pct } from '@/utils/format';

/** Model card popover: metrics of the deployed model (backend/models/model_card.json). */
export function ModelCardButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<ModelCard | null | undefined>(undefined);
  useEffect(() => {
    if (!open || card !== undefined) return;
    aiService.info().then((i) => setCard(i.model_card ?? null)).catch(() => setCard(null));
  }, [open, card]);
  return (
    <div className={cx('relative', className)}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <BadgeInfo className="size-3.5" /> Model card
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-40 w-[320px] panel p-4 shadow-xl text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="font-display font-semibold text-sm">Model card</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="Close"><X className="size-3.5" /></button>
          </div>
          {card === undefined ? (
            <div className="text-muted">Loading…</div>
          ) : card === null ? (
            <div className="text-muted">No trained model deployed yet (backend/models/model_card.json missing).</div>
          ) : (
            <>
              <div className="num text-ink">{card.model_name}</div>
              <div className="text-muted">Base {card.base_model} · classes: {card.classes.join(', ')} · trained {card.train_date} on {card.device}</div>
              <div className="grid grid-cols-4 gap-2 pt-1">
                {(['precision', 'recall', 'mAP50', 'mAP50-95'] as const).map((k) => (
                  <div key={k} className="rounded-md border border-line p-2 text-center">
                    <div className="num text-base font-bold text-ink">{(card.metrics[k] * 100).toFixed(1)}%</div>
                    <div className="text-[10px] text-muted">{k === 'precision' ? 'P' : k === 'recall' ? 'R' : k}</div>
                  </div>
                ))}
              </div>
              {card.per_class && (
                <table className="w-full text-[11px] num">
                  <thead><tr className="text-muted"><th className="text-left font-normal">Class</th><th className="font-normal">P</th><th className="font-normal">R</th><th className="font-normal">mAP50</th></tr></thead>
                  <tbody>
                    {Object.entries(card.per_class).map(([k, v]) => (
                      <tr key={k}><td className="capitalize">{k}</td><td className="text-center">{(v.precision * 100).toFixed(0)}%</td><td className="text-center">{(v.recall * 100).toFixed(0)}%</td><td className="text-center">{(v.mAP50 * 100).toFixed(0)}%</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="text-muted">
                False-alarm guards: {card.negatives_in_training ?? 0} people/room/object images in training · COCO scene gate suppresses boxes on people &amp; objects · findings must persist across frames.
              </div>
              <div className="text-muted">
                Evaluated on the held-out <b>{card.metrics.split ?? 'test'}</b> split · dataset{' '}
                {Object.entries(card.dataset_size).map(([k, v]) => `${k} ${v}`).join(' · ')}
              </div>
              {card.notes && <div className="text-faint">{card.notes}</div>}
              <div className="text-[10px] text-faint border-t border-line pt-2">Outputs are potential defects for human review.</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Live confidence threshold, applied to the running pipeline immediately (0.10–0.80). */
export function ConfidenceSlider() {
  const { ai, setAi, backendOnline, notify } = useApp();
  const [v, setV] = useState(ai?.confidence ?? 0.25);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (ai?.confidence !== undefined) setV(ai.confidence);
  }, [ai?.confidence]);
  const change = (x: number) => {
    setV(x);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      aiService.update({ confidence: x }).then((info) => setAi({ ...(ai ?? info), ...info })).catch((e) => notify({ tone: 'warn', title: 'Could not set confidence', body: (e as Error).message }));
    }, 120);
  };
  return (
    <label className="flex items-center gap-2 text-xs">
      <SlidersHorizontal className="size-3.5 text-muted" />
      <span className="text-muted whitespace-nowrap">Confidence ≥</span>
      <input type="range" min={0.1} max={0.8} step={0.01} value={v} disabled={!backendOnline} onChange={(e) => change(Number(e.target.value))} className="flex-1 accent-[#7d0a0a]" aria-label="Detection confidence threshold" />
      <span className="num w-9 text-right text-ink">{v.toFixed(2)}</span>
    </label>
  );
}

function useTicker(active: ActiveInspection | null) {
  const [, tick] = useState(0);
  const last = useRef({ v: 0, at: Date.now() });
  useEffect(() => {
    if (active) last.current = { v: active.elapsed_s, at: Date.now() };
  }, [active?.elapsed_s, active]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  if (!active) return 0;
  return active.status === 'active' ? last.current.v + Math.min(1.2, (Date.now() - last.current.at) / 1000) : active.elapsed_s;
}

/** Streaming record of every detection as it happens — built for presenting. */
export function LiveAIRecord({ detections, big }: { detections: Detection[]; big?: boolean }) {
  const { active, ai, presentMode } = useApp();
  const elapsed = useTicker(active);
  const counts: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  let lo = 0;
  let hi = 0;
  for (const d of detections) {
    if (d.review_status === 'false_positive') continue;
    counts[d.risk_level ?? 'low']++;
    lo += d.cost_min ?? 0;
    hi += d.cost_max ?? 0;
  }
  const disconnected = (active?.source === 'camera' || active?.source === 'drone_direct') && active.connected === false;
  return (
    <div className={cx('panel overflow-hidden flex flex-col', big && 'text-[15px]')}>
      <div className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2 bg-surface-2/50">
        <span className={cx('size-2.5 rounded-full', active ? (active.status === 'paused' ? 'bg-warn' : 'bg-crit pulse-dot') : 'bg-ink/20')} />
        <span className="font-display font-bold tracking-wide">LIVE AI RECORD</span>
        <span className="text-[10px] text-muted uppercase tracking-wider">potential defects · human review</span>
        <div className="ml-auto flex items-center gap-1.5">{!presentMode && <ModelCardButton />}</div>
      </div>

      <div className={cx('grid grid-cols-4 border-b border-line text-center', big ? 'py-3' : 'py-2')}>
        <div>
          <div className={cx('num font-bold text-ink', big ? 'text-3xl' : 'text-xl')}>{detections.length}</div>
          <div className="text-[10px] text-muted uppercase">Detections</div>
        </div>
        <div>
          <div className={cx('num font-bold text-ink flex items-center justify-center gap-1', big ? 'text-3xl' : 'text-xl')}><Timer className="size-4 text-muted" />{fmtClock(elapsed)}</div>
          <div className="text-[10px] text-muted uppercase">Session</div>
        </div>
        <div>
          <div className={cx('num font-bold text-ink flex items-center justify-center gap-1', big ? 'text-3xl' : 'text-xl')}><Gauge className="size-4 text-muted" />{(active?.source_fps ?? 0).toFixed(0)}</div>
          <div className="text-[10px] text-muted uppercase">Video FPS</div>
        </div>
        <div>
          <div className={cx('num font-bold text-ink flex items-center justify-center gap-1', big ? 'text-3xl' : 'text-xl')}><Cpu className="size-4 text-muted" />{(active?.inference_fps ?? ai?.inference_fps ?? 0).toFixed(0)}</div>
          <div className="text-[10px] text-muted uppercase">AI inf/s</div>
        </div>
      </div>

      <div className="px-4 py-2 border-b border-line flex flex-wrap items-center gap-2 text-xs">
        {RISK_LEVELS.slice().reverse().map((lv) => (
          <span key={lv} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: RISK_COLOR[lv] }} />
            <span className="text-muted">{RISK_LABEL[lv]}</span>
            <span className="num font-semibold text-ink">{counts[lv]}</span>
          </span>
        ))}
        <span className="ml-auto text-muted" title="Estimate, based on editable assumptions">
          Est. repair <b className="num text-ink">{fmtMoneyRange(lo, hi, 'INR', true)}</b>
        </span>
      </div>

      {disconnected && (
        <div className="px-4 py-2 text-xs bg-warn/15 text-warn-ink flex items-center gap-2"><Radio className="size-3.5" /> Drone link lost — reconnecting automatically (session kept).</div>
      )}

      <ul className={cx('overflow-y-auto flex-1', big ? 'max-h-[62vh]' : 'max-h-[420px]')} aria-live="polite">
        {detections.length === 0 && (
          <li className="p-6 text-center text-sm text-muted">{active ? 'Scanning… detections stream here in real time.' : 'Start an inspection to begin recording.'}</li>
        )}
        {detections.map((d, i) => (
          <li key={d.id} className={cx('border-b border-line', i === 0 && 'feed-in')}>
            <Link to={`/defects/${d.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-2">
              {d.thumb_url ? (
                <img src={mediaUrl(d.thumb_url) ?? ''} alt={`${d.category} crop`} className={cx('rounded-md object-cover border border-line shrink-0 bg-black', big ? 'size-20' : 'size-14')} />
              ) : (
                <EvidenceImage url={d.evidence_url} bbox={d.bbox} category={d.category} className={cx('shrink-0', big ? 'w-24' : 'w-16')} thumb />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <CategoryChip category={d.category} />
                  <RiskBadge level={d.risk_level} score={d.risk_score} />
                  <span className="num text-xs text-ink">{pct(d.confidence)}</span>
                </div>
                <div className="text-[11px] text-muted mt-0.5 truncate">
                  <span className="num">{new Date(d.detected_at.endsWith('Z') ? d.detected_at : d.detected_at + 'Z').toLocaleTimeString()}</span> · t={fmtClock(d.video_time_s)} · {d.section}
                </div>
                <div className="text-[11px] text-muted"><CostRange d={d} compact /> est.</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
