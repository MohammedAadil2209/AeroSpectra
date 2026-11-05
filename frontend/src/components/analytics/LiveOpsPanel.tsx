import { useNavigate } from 'react-router-dom';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Activity, CheckCircle2, CircleAlert, IndianRupee, ShieldAlert } from 'lucide-react';
import type { Analytics } from '@/types';
import { useApp } from '@/context/AppContext';
import { EmptyState, Panel, StatTile } from '@/components/ui/primitives';
import { AXIS, ChartTooltip, GRID, Legend } from '@/components/analytics/Charts';
import { RISK_COLOR, RISK_LABEL, RISK_LEVELS } from '@/utils/labels';
import { fmtMoneyRange } from '@/utils/format';

/** Open vs Cleared, advisory risk mix and estimated repair exposure — pushed live (kpi.updated). */
export function LiveOpsPanel({ a }: { a: Analytics }) {
  const navigate = useNavigate();
  const { wsState, presentMode } = useApp();
  const risk = RISK_LEVELS.map((lv) => ({ lv, name: RISK_LABEL[lv], count: a.by_risk?.[lv] ?? 0 }));
  const trend = a.open_vs_cleared_trend ?? [];
  const big = presentMode ? 'text-4xl' : undefined;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <StatTile label="Open defects" value={<span className={big}>{a.open_defects ?? 0}</span>} sub="detected → repaired, deferred" icon={<CircleAlert className="size-4" />} tone="warn" onClick={() => navigate('/defects')} />
        <StatTile label="Verified & cleared" value={<span className={big}>{a.cleared_defects ?? 0}</span>} sub="damage cleared by engineers" icon={<CheckCircle2 className="size-4" />} tone="ok" onClick={() => navigate('/maintenance')} />
        <StatTile label="Critical / high risk" value={<span className={big}>{(a.by_risk?.critical ?? 0) + (a.by_risk?.high ?? 0)}</span>} sub="advisory risk engine" icon={<ShieldAlert className="size-4" />} tone="crit" onClick={() => navigate('/risk')} />
        <StatTile label="Est. repair exposure" value={<span className={presentMode ? 'text-2xl' : 'text-lg'}>{fmtMoneyRange(a.estimated_cost_min, a.estimated_cost_max, a.currency ?? 'INR', true)}</span>} sub="estimate · editable assumptions" icon={<IndianRupee className="size-4" />} onClick={() => navigate('/roi')} />
      </div>
      <div className="grid gap-4 xl:grid-cols-3 mb-4">
        <Panel className="xl:col-span-2" title="Open vs cleared" icon={<Activity className="text-steel" />} actions={<span className="text-xs text-muted">{wsState === 'open' ? 'live' : 'last update'} · new / cleared per day, open backlog</span>}>
          {trend.length ? (
            <>
              <Legend items={[
                { label: 'New', color: '#7d0a0a' },
                { label: 'Cleared', color: '#2e7d4f' },
                { label: 'Open backlog', color: '#e0a43a' },
              ]} />
              <div className="mt-2">
                <ResponsiveContainer width="100%" height={210}>
                  <ComposedChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="open-backlog" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e0a43a" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="#e0a43a" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...GRID} />
                    <XAxis dataKey="date" {...AXIS} tickFormatter={(d: string) => d.slice(5)} />
                    <YAxis {...AXIS} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Area type="monotone" dataKey="open" name="Open backlog" stroke="#e0a43a" fill="url(#open-backlog)" strokeWidth={2} isAnimationActive={false} />
                    <Bar dataKey="new" name="New" fill="#7d0a0a" barSize={10} radius={[2, 2, 0, 0]} />
                    <Bar dataKey="cleared" name="Cleared" fill="#2e7d4f" barSize={10} radius={[2, 2, 0, 0]} />
                    <Line type="monotone" dataKey="cleared" stroke="#2e7d4f" dot={false} legendType="none" />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : <EmptyState title="No findings yet" />}
        </Panel>
        <Panel title="Advisory risk mix" icon={<ShieldAlert className="text-steel" />} actions={<button className="btn btn-ghost btn-sm" onClick={() => navigate('/risk')}>Tune</button>}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={risk} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="name" {...AXIS} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'rgba(102,155,188,0.08)' }} content={<ChartTooltip />} />
              <Bar dataKey="count" name="Findings" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {risk.map((r) => <Cell key={r.lv} fill={RISK_COLOR[r.lv]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </>
  );
}
