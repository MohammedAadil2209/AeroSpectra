import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, CircleAlert, Repeat, Wrench } from 'lucide-react';
import type { Aircraft, MaintenanceStatus } from '@/types';
import { useApp } from '@/context/AppContext';
import { aircraftService, maintenanceService, type AircraftMaintenance } from '@/services/dataService';
import { EmptyState, Loading, PageHeader, Panel, StatTile, cx } from '@/components/ui/primitives';
import { MaintenanceChip, RiskBadge } from '@/components/risk/RiskBits';
import { CATEGORY_LABEL, MAINTENANCE_LABEL } from '@/utils/labels';
import { fmtDateTime, fmtMoney, fmtMoneyRange } from '@/utils/format';
import { mediaUrl } from '@/services/api';
import type { Category } from '@/types';

export default function Maintenance() {
  const { scope, backendOnline, dataVersion } = useApp();
  const [params, setParams] = useSearchParams();
  const [fleet, setFleet] = useState<Aircraft[]>([]);
  const aircraftId = params.get('aircraft') ?? '';
  const [data, setData] = useState<AircraftMaintenance | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    aircraftService.list(scope).then((l) => {
      setFleet(l);
      if (!l.some((a) => a.id === aircraftId) && l[0]) setParams({ aircraft: l[0].id }, { replace: true });
    }).catch(() => setFleet([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, backendOnline]);

  // refetches on every live maintenance/defect event (dataVersion)
  useEffect(() => {
    if (!aircraftId || !backendOnline) return;
    maintenanceService.aircraft(aircraftId).then((d) => { setData(d); setErr(null); }).catch((e) => setErr((e as Error).message));
  }, [aircraftId, backendOnline, dataVersion]);

  if (!backendOnline) return (<><PageHeader eyebrow="Maintenance" title="Maintenance History" /><EmptyState title="Backend offline" body="Maintenance history is stored by the backend." /></>);
  const cur = data?.currency ?? 'INR';
  const eva = (data?.estimate_vs_actual ?? []).map((r) => ({ id: r.detection_id, est_mid: Math.round((r.estimate_min + r.estimate_max) / 2), actual: r.actual }));

  return (
    <>
      <PageHeader
        eyebrow="Maintenance & damage-cleared history"
        title="Maintenance History"
        subtitle="Every defect, work order, repair and clearance per aircraft — updated live."
        actions={
          <select className="field !w-auto" value={aircraftId} onChange={(e) => setParams({ aircraft: e.target.value })} aria-label="Aircraft">
            {fleet.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.registration} · {a.model}</option>)}
          </select>
        }
      />
      {err && <div className="text-crit text-sm mb-3">{err}</div>}
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            <StatTile label="Open defects" value={data.open} icon={<CircleAlert className="size-4" />} tone={data.open ? 'warn' : 'default'} />
            <StatTile label="Verified & cleared" value={data.cleared} icon={<CheckCircle2 className="size-4" />} />
            <StatTile label="Recurring sections" value={data.by_section.filter((s) => s.recurring).length} icon={<Repeat className="size-4" />} sub="defects in 2+ inspections" />
            <StatTile label="Estimated cost" value={fmtMoneyRange(data.estimated_cost_min, data.estimated_cost_max, cur, true)} sub={`${data.estimated_labour_hours} h · estimate`} />
            <StatTile label="Actual cost (recorded)" value={fmtMoney(data.actual_cost, cur, true)} sub={`${data.actual_labour_hours} h actual`} icon={<Wrench className="size-4" />} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <Panel title="Timeline" bodyClass="p-0">
              <ol className="max-h-[70vh] overflow-y-auto">
                {data.timeline.length === 0 && <li className="p-6 text-sm text-muted">No defects recorded for this aircraft.</li>}
                {data.timeline.map((e, i) => (
                  <li key={i} className="flex gap-3 px-4 py-3 border-b border-line">
                    <div className={cx('mt-1 size-2.5 rounded-full shrink-0', e.kind === 'detected' ? 'bg-[#e0a43a]' : e.to_status === 'cleared' ? 'bg-ok' : e.to_status === 'false_positive' ? 'bg-ink/30' : 'bg-steel')} />
                    <div className="min-w-0 flex-1 text-sm">
                      {e.kind === 'detected' ? (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <b>Detected</b>
                            <span>{CATEGORY_LABEL[e.category as Category] ?? e.category}</span>
                            <RiskBadge level={e.risk_level} />
                            <span className="text-muted">{e.section}</span>
                          </div>
                          <div className="text-xs text-muted">
                            <Link to={`/defects/${e.detection_id}`} className="num text-steel-bright hover:underline">{e.detection_id}</Link> · inspection{' '}
                            <Link to={`/inspections/${e.inspection_id}`} className="num hover:underline">{e.inspection_id}</Link> · est. {fmtMoneyRange(e.cost_min, e.cost_max, cur, true)}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex flex-wrap items-center gap-2">
                            <MaintenanceChip status={e.from_status as MaintenanceStatus} /> → <MaintenanceChip status={e.to_status as MaintenanceStatus} />
                            <span className="text-muted">by {e.actor}</span>
                          </div>
                          <div className="text-xs text-muted">
                            <Link to={`/defects/${e.detection_id}`} className="num text-steel-bright hover:underline">{e.detection_id}</Link>
                            {e.reason && <> · reason: {e.reason}</>}
                            {e.notes && <> · {e.notes}</>}
                            {e.actual_cost != null && <> · actual {fmtMoney(e.actual_cost, cur)}</>}
                            {e.actual_labour_hours != null && <> · {e.actual_labour_hours} h</>}
                          </div>
                          {e.photo_url && <img src={mediaUrl(e.photo_url) ?? ''} alt="After repair" className="mt-1 h-16 rounded border border-line" />}
                        </>
                      )}
                    </div>
                    <div className="text-[11px] text-muted whitespace-nowrap">{fmtDateTime(e.at)}</div>
                  </li>
                ))}
              </ol>
            </Panel>
            <div className="space-y-4">
              <Panel title="By section (recurring defects)">
                <table className="table text-xs">
                  <thead><tr><th>Section</th><th>Total</th><th>Open</th><th>Cleared</th><th>Insp.</th></tr></thead>
                  <tbody>
                    {data.by_section.map((s) => (
                      <tr key={s.section}>
                        <td>{s.section} {s.recurring && <span className="chip border-crimson/40 text-crit-ink ml-1"><Repeat className="size-3" /> recurring</span>}</td>
                        <td className="num">{s.total}</td><td className="num">{s.open}</td><td className="num">{s.cleared}</td><td className="num">{s.inspections}</td>
                      </tr>
                    ))}
                    {!data.by_section.length && <tr><td colSpan={5} className="text-muted">No findings.</td></tr>}
                  </tbody>
                </table>
              </Panel>
              <Panel title="Estimated vs actual repair cost" actions={<span className="text-[10px] text-muted">estimate = midpoint</span>}>
                {eva.length ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={eva} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,140,160,.2)" vertical={false} />
                      <XAxis dataKey="id" tick={{ fontSize: 9 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtMoney(v, cur, true)} />
                      <Tooltip formatter={(v: number) => fmtMoney(v, cur)} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="est_mid" name="Estimate" fill="#c9d3dc" />
                      <Bar dataKey="actual" name="Actual" fill="#7d0a0a" />
                    </BarChart>
                  </ResponsiveContainer>
                ) : <div className="text-xs text-muted">Record actual cost when moving a defect to Repaired / Cleared to compare.</div>}
              </Panel>
              <div className="text-[11px] text-faint">Statuses: {Object.values(MAINTENANCE_LABEL).join(' → ')}. Clearance is a human decision recorded here, not made by the AI.</div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
