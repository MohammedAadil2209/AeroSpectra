import { useEffect, useRef, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Calculator, IndianRupee, Save, TrendingUp } from 'lucide-react';
import type { RiskLevel } from '@/types';
import { useApp } from '@/context/AppContext';
import { roiService, settingsService, type CostConfig, type RoiResult } from '@/services/dataService';
import { Banner, EmptyState, Loading, PageHeader, Panel, StatTile } from '@/components/ui/primitives';
import { RISK_LABEL, RISK_LEVELS } from '@/utils/labels';
import { fmtMoney } from '@/utils/format';

const EST = 'Estimate, based on editable assumptions';
const REVIEWER_KEY = 'aerospectra.reviewer';

function Num({ label, value, onChange, step = 1, suffix }: { label: string; value: number; onChange: (v: number) => void; step?: number; suffix?: string }) {
  return (
    <label className="block">
      <span className="label">{label}{suffix ? <span className="text-faint"> ({suffix})</span> : null}</span>
      <input type="number" className="field num" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export default function CostROI() {
  const { backendOnline, notify, subscribe } = useApp();
  const [fleet, setFleet] = useState(() => Number(localStorage.getItem('aerospectra.fleet') ?? 20));
  const [roi, setRoi] = useState<RoiResult | null>(null);
  const [cfg, setCfg] = useState<CostConfig | null>(null);
  const [version, setVersion] = useState(0);
  const [actor, setActor] = useState(() => localStorage.getItem(REVIEWER_KEY) ?? '');
  const [saving, setSaving] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRoi = (f: number) => roiService.get(f).then(setRoi).catch(() => undefined);
  const loadCfg = () => settingsService.get<CostConfig>('cost').then((s) => { setCfg(s.value); setVersion(s.version); }).catch(() => undefined);
  useEffect(() => {
    if (!backendOnline) return;
    loadRoi(fleet);
    loadCfg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendOnline]);
  useEffect(() => subscribe((e) => { if (e.type === 'settings.updated' && e.data.key === 'cost') { loadCfg(); loadRoi(fleet); } }), // eslint-disable-line react-hooks/exhaustive-deps
    [subscribe, fleet]);

  const setFleetN = (n: number) => {
    const v = Math.max(1, Math.min(2000, Math.round(n || 1)));
    setFleet(v);
    localStorage.setItem('aerospectra.fleet', String(v));
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => loadRoi(v), 100);
  };

  const edit = (fn: (c: CostConfig) => void) => setCfg((c) => { if (!c) return c; const n = structuredClone(c); fn(n); return n; });
  const save = async () => {
    if (!cfg) return;
    if (!actor.trim()) return notify({ tone: 'warn', title: 'Enter your name', body: 'Assumption changes are audited.' });
    setSaving(true);
    try {
      localStorage.setItem(REVIEWER_KEY, actor.trim());
      const s = await settingsService.put('cost', cfg, actor.trim());
      setVersion(s.version);
      await loadRoi(fleet);
      notify({ tone: 'ok', title: `Cost assumptions v${s.version} saved`, body: 'All detection cost estimates were recalculated.' });
    } catch (e) {
      notify({ tone: 'crit', title: 'Save failed', body: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!backendOnline) return (<><PageHeader eyebrow="Business case" title="Cost & ROI" /><EmptyState title="Backend offline" body="Cost and ROI estimates are computed by the backend." /></>);
  if (!roi || !cfg) return <Loading />;
  const cur = roi.currency;
  const m = (v: number | null | undefined, c = false) => fmtMoney(v ?? 0, cur, c);
  const perInsp = [
    { name: 'Manual walk-around', cost: roi.per_inspection.manual_cost, hours: roi.per_inspection.manual_hours },
    { name: 'AeroSpectra drone', cost: roi.per_inspection.drone_cost, hours: roi.per_inspection.drone_hours },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Business case"
        title="Cost & ROI"
        subtitle="Savings of drone-assisted inspection versus manual walk-arounds, for your fleet size."
        actions={<span className="chip border-[#e0a43a]/50 text-warn-ink bg-[#e0a43a]/10">{EST}</span>}
      />
      <div className="mb-4">
        <Banner tone="info"><b>{EST}.</b> Every figure below is derived from the assumptions panel at the bottom of this page — nothing is hidden. Edit them to match your operation.</Banner>
      </div>

      <Panel title="Fleet" icon={<Calculator className="size-4" />} className="mb-4">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-3 flex-1 min-w-[260px]">
            <span className="text-sm text-ink-2 whitespace-nowrap">Fleet size</span>
            <input type="range" min={1} max={300} value={Math.min(300, fleet)} onChange={(e) => setFleetN(Number(e.target.value))} className="flex-1 accent-[#7d0a0a]" aria-label="Fleet size" />
            <input type="number" className="field num w-24" value={fleet} onChange={(e) => setFleetN(Number(e.target.value))} />
            <span className="text-sm text-muted">aircraft</span>
          </label>
          <span className="text-xs text-muted">{roi.inspections_per_month} inspections / month · tier <b className="text-ink">{roi.subscription_tier}</b></span>
        </div>
      </Panel>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        <StatTile label="Saving per inspection" value={m(roi.per_inspection.total_saving)} sub={`${roi.per_inspection.hours_saved} h faster · ${EST.toLowerCase()}`} icon={<IndianRupee className="size-4" />} />
        <StatTile label="Net savings / month" value={m(roi.net_savings_month, true)} sub={`after ${m(roi.subscription_month, true)} subscription`} icon={<TrendingUp className="size-4" />} />
        <StatTile label="Net savings / year" value={m(roi.net_savings_year, true)} sub={EST} />
        <StatTile label="Payback period" value={roi.payback_months === null ? 'n/a' : roi.payback_months < 1 ? `${Math.max(1, Math.round(roi.payback_months * 30))} days` : `${roi.payback_months} mo`} sub={`setup ${m(roi.setup_cost, true)}`} />
        <StatTile label="First-year ROI" value={roi.roi_pct === null ? 'n/a' : `${Math.round(roi.roi_pct).toLocaleString()}%`} sub={`AOG hours avoided ≈ ${roi.aog_hours_avoided_month}/mo`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3 mb-4">
        <Panel title="Per inspection: manual vs drone" actions={<span className="text-[10px] text-muted">{EST}</span>}>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={perInsp} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,160,.2)" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="c" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtMoney(v, cur, true)} />
              <YAxis yAxisId="h" orientation="right" tick={{ fontSize: 10 }} unit=" h" />
              <Tooltip formatter={(v: number, n: string) => (n === 'Cost' ? m(v) : `${v} h`)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="c" dataKey="cost" name="Cost" fill="#7d0a0a" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar yAxisId="h" dataKey="hours" name="Hours" fill="#4f9bd4" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="text-xs text-muted mt-2">
            Direct saving {m(roi.per_inspection.direct_saving)} + ground-time value {m(roi.per_inspection.ground_time_value)} = <b className="text-ink">{m(roi.per_inspection.total_saving)}</b>
          </div>
        </Panel>
        <Panel title="Cumulative net savings (12 months)" actions={<span className="text-[10px] text-muted">{EST}</span>} className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={roi.monthly_series} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,160,.2)" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={(v) => `M${v}`} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtMoney(v, cur, true)} />
              <Tooltip formatter={(v: number) => m(v)} labelFormatter={(l) => `Month ${l}`} />
              <ReferenceLine y={0} stroke="#888" />
              <Area type="monotone" dataKey="cumulative_net" name="Cumulative net" stroke="#2e7d4f" fill="#2e7d4f" fillOpacity={0.18} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 mb-4">
        <Panel title="AeroSpectra revenue projection" actions={<span className="text-[10px] text-muted">subscription tiers × aircraft · {EST.toLowerCase()}</span>}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={roi.revenue_projection} margin={{ top: 8, right: 8, left: 12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,160,.2)" vertical={false} />
              <XAxis dataKey="aircraft" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v} ac`} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtMoney(v, cur, true)} />
              <Tooltip formatter={(v: number) => m(v)} labelFormatter={(l) => `${l} aircraft`} />
              <Bar dataKey="arr" name="Annual recurring revenue" fill="#092635" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
          <table className="table text-xs mt-2">
            <thead><tr><th>Aircraft</th><th>Tier</th><th>MRR</th><th>ARR</th></tr></thead>
            <tbody>{roi.revenue_projection.map((r) => <tr key={r.aircraft}><td className="num">{r.aircraft}</td><td>{r.tier}</td><td className="num">{m(r.mrr)}</td><td className="num">{m(r.arr)}</td></tr>)}</tbody>
          </table>
        </Panel>
        <Panel title="Repair cost table (per defect)" actions={<span className="text-[10px] text-muted">parts/materials min–max + labour hours</span>}>
          <div className="overflow-x-auto">
            <table className="table text-xs">
              <thead><tr><th>Type</th>{RISK_LEVELS.map((lv) => <th key={lv}>{RISK_LABEL[lv]}</th>)}</tr></thead>
              <tbody>
                {Object.entries(cfg.repair).map(([cat, row]) => (
                  <tr key={cat}>
                    <td className="capitalize font-semibold">{cat}</td>
                    {RISK_LEVELS.map((lv: RiskLevel) => (
                      <td key={lv} className="space-y-1">
                        <div className="flex gap-1">
                          <input aria-label={`${cat} ${lv} min`} className="field num !h-7 !px-1.5 w-20" type="number" value={row[lv].min} onChange={(e) => edit((c) => { c.repair[cat][lv].min = Number(e.target.value); })} />
                          <input aria-label={`${cat} ${lv} max`} className="field num !h-7 !px-1.5 w-20" type="number" value={row[lv].max} onChange={(e) => edit((c) => { c.repair[cat][lv].max = Number(e.target.value); })} />
                        </div>
                        <input aria-label={`${cat} ${lv} hours`} className="field num !h-7 !px-1.5 w-full" type="number" step={0.5} value={row[lv].labour_h} onChange={(e) => edit((c) => { c.repair[cat][lv].labour_h = Number(e.target.value); })} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-[11px] text-faint mt-2">Detection estimate = parts min/max + labour hours × labour rate. Columns follow the detection's advisory risk level.</div>
        </Panel>
      </div>

      <Panel title={`Assumptions (Settings → Cost assumptions) · v${version}`} icon={<Calculator className="size-4" />}>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block"><span className="label">Currency</span>
            <select className="field" value={cfg.currency} onChange={(e) => edit((c) => { c.currency = e.target.value; c.currency_symbol = e.target.value === 'INR' ? '₹' : e.target.value === 'USD' ? '$' : e.target.value === 'EUR' ? '€' : e.target.value; })}>
              {['INR', 'USD', 'EUR', 'AED', 'GBP'].map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <Num label="Labour rate" suffix={`${cfg.currency}/h`} value={cfg.labour_rate} onChange={(v) => edit((c) => { c.labour_rate = v; })} />
          <Num label="AOG cost" suffix={`${cfg.currency}/h`} value={cfg.aog_cost_per_hour} onChange={(v) => edit((c) => { c.aog_cost_per_hour = v; })} />
          <Num label="Ground-time value" suffix="fraction of AOG rate" step={0.01} value={cfg.ground_time_value_fraction} onChange={(v) => edit((c) => { c.ground_time_value_fraction = v; })} />
          <Num label="Manual inspection hours" value={cfg.manual_inspection.hours} step={0.5} onChange={(v) => edit((c) => { c.manual_inspection.hours = v; })} />
          <Num label="Manual crew" value={cfg.manual_inspection.crew} onChange={(v) => edit((c) => { c.manual_inspection.crew = v; })} />
          <Num label="Manual other cost" suffix="lift/equipment" value={cfg.manual_inspection.other_cost} onChange={(v) => edit((c) => { c.manual_inspection.other_cost = v; })} />
          <Num label="Inspections / aircraft / month" value={cfg.inspections_per_aircraft_month} step={0.5} onChange={(v) => edit((c) => { c.inspections_per_aircraft_month = v; })} />
          <Num label="Drone inspection hours" value={cfg.drone_inspection.hours} step={0.25} onChange={(v) => edit((c) => { c.drone_inspection.hours = v; })} />
          <Num label="Drone crew" value={cfg.drone_inspection.crew} onChange={(v) => edit((c) => { c.drone_inspection.crew = v; })} />
          <Num label="Drone other cost" suffix="battery/upkeep" value={cfg.drone_inspection.other_cost} onChange={(v) => edit((c) => { c.drone_inspection.other_cost = v; })} />
          <Num label="AOG h avoided / aircraft / month" suffix="early detection" step={0.05} value={cfg.early_detection_aog_hours_avoided_per_aircraft_month} onChange={(v) => edit((c) => { c.early_detection_aog_hours_avoided_per_aircraft_month = v; })} />
          <Num label="One-time setup" suffix="drone kit + onboarding" value={cfg.setup_cost} onChange={(v) => edit((c) => { c.setup_cost = v; })} />
          {cfg.subscription_tiers.map((tier, i) => (
            <Num key={tier.name} label={`${tier.name} price`} suffix={`per aircraft/month, ≤${tier.max_aircraft > 9999 ? '∞' : tier.max_aircraft} ac`} value={tier.price_per_aircraft_month} onChange={(v) => edit((c) => { c.subscription_tiers[i].price_per_aircraft_month = v; })} />
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2 mt-4">
          <div className="min-w-[200px]">
            <label className="label" htmlFor="cost-actor">Changed by</label>
            <input id="cost-actor" className="field" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Name / staff ID" />
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving}><Save className="size-4" /> Save assumptions & recalculate</button>
          <span className="text-[11px] text-faint">Saved versions are audited and pushed live to every open page.</span>
        </div>
      </Panel>
    </>
  );
}
