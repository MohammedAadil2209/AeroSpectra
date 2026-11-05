import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { History, RotateCcw, Save, ShieldAlert } from 'lucide-react';
import type { RiskLevel } from '@/types';
import { useApp } from '@/context/AppContext';
import { riskService, settingsService, type AuditEntry, type RiskConfig } from '@/services/dataService';
import { Banner, EmptyState, Loading, PageHeader, Panel, cx } from '@/components/ui/primitives';
import { RiskBadge } from '@/components/risk/RiskBits';
import { RISK_COLOR, RISK_FACTORS, RISK_FACTOR_COLOR, RISK_FACTOR_LABEL, RISK_LABEL, RISK_LEVELS } from '@/utils/labels';
import { fmtDateTime } from '@/utils/format';

type Preview = Awaited<ReturnType<typeof riskService.preview>>;
const REVIEWER_KEY = 'aerospectra.reviewer';

function Slider({ label, value, min, max, step, onChange, color, suffix }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; color?: string; suffix?: string }) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="flex items-center gap-1.5 text-ink-2">{color && <span className="size-2.5 rounded-sm" style={{ background: color }} />}{label}</span>
        <span className="num text-ink font-semibold">{value}{suffix}</span>
      </div>
      <input type="range" className="w-full accent-[#7d0a0a]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </label>
  );
}

export default function RiskEngine() {
  const { backendOnline, scope, notify, subscribe } = useApp();
  const [saved, setSaved] = useState<{ value: RiskConfig; version: number; updated_by: string; updated_at: string | null } | null>(null);
  const [cfg, setCfg] = useState<RiskConfig | null>(null);
  const [presets, setPresets] = useState<Record<string, Partial<RiskConfig>>>({});
  const [disclaimer, setDisclaimer] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [base, setBase] = useState<Preview | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [actor, setActor] = useState(() => localStorage.getItem(REVIEWER_KEY) ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = () => {
    settingsService.get<RiskConfig>('risk').then((s) => {
      setSaved(s);
      setCfg(s.value);
      riskService.preview(s.value, scope).then((p) => { setBase(p); setPreview(p); }).catch(() => undefined);
    }).catch(() => undefined);
    settingsService.audit('risk').then(setAudit).catch(() => undefined);
  };
  useEffect(() => {
    if (!backendOnline) return;
    load();
    riskService.presets().then((p) => { setPresets(p.presets); setDisclaimer(p.disclaimer); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendOnline, scope]);
  // another user saved new weights -> reload
  useEffect(() => subscribe((e) => { if (e.type === 'settings.updated' && e.data.key === 'risk') load(); }), // eslint-disable-line react-hooks/exhaustive-deps
    [subscribe, scope]);

  const update = (fn: (c: RiskConfig) => RiskConfig) => {
    setCfg((c) => {
      if (!c) return c;
      const next = fn(structuredClone(c));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => riskService.preview(next, scope).then(setPreview).catch(() => undefined), 120);
      return next;
    });
  };

  const dirty = useMemo(() => !!cfg && !!saved && JSON.stringify(cfg) !== JSON.stringify(saved.value), [cfg, saved]);
  const chart = RISK_LEVELS.map((lv) => ({ level: RISK_LABEL[lv], lv, saved: base?.counts[lv] ?? 0, preview: preview?.counts[lv] ?? 0 }));
  const hist = useMemo(() => {
    const b = Array.from({ length: 10 }, (_, i) => ({ range: `${i * 10}-${i * 10 + 10}`, count: 0, mid: i * 10 + 5 }));
    (preview?.detections ?? []).forEach((d) => b[Math.min(9, Math.floor(d.risk_score / 10))].count++);
    return b;
  }, [preview]);
  const levelOf = (score: number): RiskLevel => (!cfg ? 'low' : score >= cfg.thresholds.critical ? 'critical' : score >= cfg.thresholds.high ? 'high' : score >= cfg.thresholds.medium ? 'medium' : 'low');
  const top = useMemo(() => [...(preview?.detections ?? [])].sort((a, b) => b.risk_score - a.risk_score).slice(0, 8), [preview]);
  const totalW = cfg ? RISK_FACTORS.reduce((a, k) => a + cfg.weights[k], 0) || 1 : 1;

  const save = async () => {
    if (!cfg) return;
    if (!actor.trim()) return notify({ tone: 'warn', title: 'Enter your name', body: 'Changes to the risk engine are audited.' });
    setSaving(true);
    try {
      localStorage.setItem(REVIEWER_KEY, actor.trim());
      const s = await settingsService.put('risk', cfg, actor.trim(), note);
      setSaved(s);
      setNote('');
      notify({ tone: 'ok', title: `Risk engine v${s.version} saved`, body: 'All current and historical detections re-scored live.' });
      load();
    } catch (e) {
      notify({ tone: 'crit', title: 'Save failed', body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!backendOnline) return (<><PageHeader eyebrow="Decision support" title="Risk Engine" /><EmptyState title="Backend offline" body="The risk engine runs on the AeroSpectra backend." /></>);
  if (!cfg || !saved) return <Loading />;

  return (
    <>
      <PageHeader
        eyebrow="Decision support · advisory"
        title="Risk Engine Tuner"
        subtitle="Every detection gets a 0–100 advisory risk score in real time. Move a slider to instantly re-score all current and historical detections."
        actions={
          <div className="flex items-center gap-2 text-xs">
            <span className="chip border-line text-ink-2 num">v{saved.version} · {saved.updated_by}</span>
            {dirty && <span className="chip border-[#e0a43a]/50 text-warn-ink bg-[#e0a43a]/10">Unsaved preview</span>}
          </div>
        }
      />
      <div className="mb-4">
        <Banner tone="warn"><b>Advisory only.</b> {disclaimer || 'Risk scores help engineers prioritise review. They are not airworthiness decisions.'}</Banner>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Panel title="Presets">
            <div className="flex flex-wrap gap-2">
              {Object.entries(presets).map(([name, p]) => (
                <button key={name} className="btn btn-sm capitalize" onClick={() => update((c) => ({ ...c, weights: { ...c.weights, ...(p.weights ?? {}) }, thresholds: { ...c.thresholds, ...(p.thresholds ?? {}) } }))}>
                  {name}
                </button>
              ))}
              <button className="btn btn-sm btn-ghost" onClick={() => { setCfg(saved.value); setPreview(base); }} disabled={!dirty}><RotateCcw className="size-3.5" /> Revert</button>
            </div>
          </Panel>

          <Panel title="Factor weights" actions={<span className="text-[11px] text-muted">share of score</span>}>
            <div className="space-y-3">
              {RISK_FACTORS.map((k) => (
                <Slider key={k} label={`${RISK_FACTOR_LABEL[k]} (${Math.round((cfg.weights[k] / totalW) * 100)}%)`} color={RISK_FACTOR_COLOR[k]} value={cfg.weights[k]} min={0} max={50} step={1}
                  onChange={(v) => update((c) => ({ ...c, weights: { ...c.weights, [k]: v } }))} />
              ))}
            </div>
          </Panel>

          <Panel title="Level thresholds (score ≥)">
            <div className="space-y-3">
              {(['medium', 'high', 'critical'] as const).map((k) => (
                <Slider key={k} label={RISK_LABEL[k]} color={RISK_COLOR[k]} value={cfg.thresholds[k]} min={0} max={100} step={1} onChange={(v) => update((c) => ({ ...c, thresholds: { ...c.thresholds, [k]: v } }))} />
              ))}
              {!(cfg.thresholds.medium < cfg.thresholds.high && cfg.thresholds.high < cfg.thresholds.critical) && (
                <div className="text-xs text-crit">Thresholds should increase: medium &lt; high &lt; critical.</div>
              )}
            </div>
          </Panel>

          <Panel title="Context factors">
            <div className="space-y-3">
              <Slider label="Size reference (bbox % of frame = full size factor)" value={Math.round(cfg.size_ref * 100)} min={1} max={30} step={1} suffix="%" onChange={(v) => update((c) => ({ ...c, size_ref: v / 100 }))} />
              <Slider label="Cluster: neighbours for full factor" value={cfg.cluster_ref} min={1} max={10} step={1} onChange={(v) => update((c) => ({ ...c, cluster_ref: v }))} />
              <Slider label="Cluster window" value={cfg.cluster_window_s} min={1} max={60} step={1} suffix=" s" onChange={(v) => update((c) => ({ ...c, cluster_window_s: v }))} />
              <Slider label="Recurrence: prior findings for full factor" value={cfg.recurrence_ref} min={1} max={10} step={1} onChange={(v) => update((c) => ({ ...c, recurrence_ref: v }))} />
            </div>
          </Panel>
        </div>

        <div className="space-y-4 min-w-0">
          <Panel title={`Live preview · ${preview?.detections.length ?? 0} ${scope} detections re-scored`} icon={<ShieldAlert className="size-4" />}>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <div className="eyebrow mb-1">Risk levels — saved vs preview</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,160,.2)" vertical={false} />
                    <XAxis dataKey="level" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="saved" name="Saved" fill="#c9d3dc" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="preview" name="Preview" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                      {chart.map((c) => <Cell key={c.lv} fill={RISK_COLOR[c.lv]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="eyebrow mb-1">Score distribution (preview)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={hist} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,160,.2)" vertical={false} />
                    <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Detections" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                      {hist.map((h) => <Cell key={h.range} fill={RISK_COLOR[levelOf(h.mid)]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="mt-3">
              <div className="eyebrow mb-1">Highest-risk findings (preview)</div>
              <ul className="divide-y divide-line text-xs">
                {top.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 py-1.5">
                    <RiskBadge level={d.risk_level} score={d.risk_score} />
                    <Link className="num text-steel-bright hover:underline" to={`/defects/${d.id}`}>{d.id}</Link>
                    <span className="text-muted">{d.category} · {d.section} · {d.aircraft_id}</span>
                  </li>
                ))}
                {!top.length && <li className="py-2 text-muted">No detections in the {scope} scope yet.</li>}
              </ul>
            </div>
          </Panel>

          <div className="grid md:grid-cols-2 gap-4">
            <Panel title="Defect type severity (0–1)">
              <div className="space-y-3">
                {Object.entries(cfg.severity).map(([k, v]) => (
                  <Slider key={k} label={k} value={v} min={0} max={1} step={0.05} onChange={(x) => update((c) => ({ ...c, severity: { ...c.severity, [k]: x } }))} />
                ))}
              </div>
            </Panel>
            <Panel title="Section criticality (0–1)">
              <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                {Object.entries(cfg.section_criticality).map(([k, v]) => (
                  <Slider key={k} label={k} value={v} min={0} max={1} step={0.05} onChange={(x) => update((c) => ({ ...c, section_criticality: { ...c.section_criticality, [k]: x } }))} />
                ))}
              </div>
            </Panel>
          </div>

          <Panel title="Save & audit" icon={<History className="size-4" />}>
            <div className="flex flex-wrap items-end gap-2 mb-4">
              <div className="flex-1 min-w-[160px]">
                <label className="label" htmlFor="actor">Changed by</label>
                <input id="actor" className="field" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Name / staff ID" />
              </div>
              <div className="flex-[2] min-w-[200px]">
                <label className="label" htmlFor="note">Reason / note</label>
                <input id="note" className="field" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Engine findings must escalate faster" />
              </div>
              <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}><Save className="size-4" /> Save v{saved.version + 1}</button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="table text-xs">
                <thead><tr><th>Version</th><th>When</th><th>Who</th><th>Changes</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.version}>
                      <td className="num">v{a.version}</td>
                      <td>{fmtDateTime(a.changed_at)}</td>
                      <td>{a.changed_by}</td>
                      <td className="text-[11px]">
                        {Object.entries(a.changes).slice(0, 6).map(([p, [o, n]]) => (
                          <div key={p} className="num"><span className="text-muted">{p}</span> {String(o)} → <b>{String(n)}</b></div>
                        ))}
                        {Object.keys(a.changes).length > 6 && <div className="text-muted">+{Object.keys(a.changes).length - 6} more</div>}
                        {a.note && <div className="text-faint italic">“{a.note}”</div>}
                      </td>
                    </tr>
                  ))}
                  {!audit.length && <tr><td colSpan={4} className="text-muted">No changes yet — defaults in use.</td></tr>}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
      <div className={cx('mt-4 text-[11px] text-faint')}>
        Preview scope: <b>{scope === 'demo' ? 'Demo data' : 'Real data'}</b> — switch in the top bar. Saving re-scores both scopes.
      </div>
    </>
  );
}
