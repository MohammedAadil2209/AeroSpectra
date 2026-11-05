/**
 * Chart components (Recharts). Rules: one y-axis per chart, fixed categorical order
 * (crack, dent, corrosion), recessive grid, text in ink tokens, hover tooltips on every chart,
 * legend for >= 2 series, 2px surface gaps between stacked/adjacent fills.
 */
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import type { Analytics, Category, ReviewStatus } from '@/types';
import { CATEGORIES, CATEGORY_LABEL, REVIEW_LABEL, REVIEW_STATUSES } from '@/utils/labels';
import { DEFECT_CHART_COLOR } from '@/components/layout/defectMapColors';

export const SURFACE = '#ffffff';
export const AXIS = { stroke: 'transparent', tick: { fill: '#66717c', fontSize: 11 }, tickLine: false } as const;
export const GRID = { stroke: 'rgba(0,48,73,0.08)', vertical: false } as const;
const REVIEW_COLOR: Record<ReviewStatus, string> = { pending: '#e0a43a', reviewed: '#5c839e', confirmed: '#d3263a', false_positive: '#7a8794' };

export function ChartTooltip({ active, payload, label, labelFmt }: TooltipProps<number, string> & { labelFmt?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
  return (
    <div className="rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-xs shadow-xl shadow-navy/15 min-w-[140px]">
      {label != null && <div className="text-muted mb-1">{labelFmt ? labelFmt(String(label)) : label}</div>}
      {payload.map((p) => (
        <div key={String(p.dataKey ?? p.name)} className="flex items-center gap-2 py-0.5">
          <span className="size-2 rounded-[2px]" style={{ background: (p.payload?.fill as string) ?? p.color }} />
          <span className="text-ink-2 flex-1">{p.name}</span>
          <span className="num text-ink">{p.value}</span>
        </div>
      ))}
      {payload.length > 1 && (
        <div className="flex justify-between border-t border-line mt-1 pt-1 text-muted">
          <span>Total</span>
          <span className="num text-ink">{total}</span>
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string; value?: number }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-ink-2">
          <span className="size-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
          {i.value != null && <span className="num text-muted">{i.value}</span>}
        </span>
      ))}
    </div>
  );
}

const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: '2-digit', month: 'short' });

/** Detections per day stacked by category. */
export function DetectionTrendChart({ data, height = 240 }: { data: Analytics['trend']; height?: number }) {
  return (
    <div>
      <Legend items={CATEGORIES.map((c) => ({ label: CATEGORY_LABEL[c], color: DEFECT_CHART_COLOR[c] }))} />
      <div style={{ height }} className="mt-3">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="22%">
            <defs>
              {CATEGORIES.map((c) => (
                <linearGradient key={c} id={`grad-${c}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={DEFECT_CHART_COLOR[c]} stopOpacity={0.98} />
                  <stop offset="100%" stopColor={DEFECT_CHART_COLOR[c]} stopOpacity={0.8} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={18} />
            <YAxis {...AXIS} allowDecimals={false} />
            <Tooltip cursor={{ fill: 'rgba(102,155,188,0.08)' }} content={<ChartTooltip labelFmt={shortDate} />} />
            {CATEGORIES.map((c, i) => (
              <Bar
                isAnimationActive={false}
                key={c}
                dataKey={c}
                name={CATEGORY_LABEL[c]}
                stackId="a"
                fill={`url(#grad-${c})`}
                stroke={SURFACE}
                strokeWidth={2}
                radius={i === CATEGORIES.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function InspectionsPerDayChart({ data, height = 200 }: { data: Analytics['trend']; height?: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="grad-inspections" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6f95ae" />
              <stop offset="100%" stopColor="#5c839e" stopOpacity={0.82} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="date" {...AXIS} tickFormatter={shortDate} minTickGap={18} />
          <YAxis {...AXIS} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgba(102,155,188,0.08)' }} content={<ChartTooltip labelFmt={shortDate} />} />
          <Bar isAnimationActive={false} dataKey="inspections" name="Inspections" fill="url(#grad-inspections)" radius={[4, 4, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Category share — donut with centre total. */
export function CategoryDonut({ byCategory, height = 200 }: { byCategory: Record<Category, number>; height?: number }) {
  const data = CATEGORIES.map((c) => ({ name: CATEGORY_LABEL[c], value: byCategory[c] ?? 0, fill: DEFECT_CHART_COLOR[c] }));
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="@container">
    <div className="flex flex-col @[400px]:flex-row items-center gap-4">
      <div className="relative shrink-0" style={{ width: height, height }}>
        <ResponsiveContainer>
          <PieChart>
            <Tooltip content={<ChartTooltip />} />
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="96%" stroke={SURFACE} strokeWidth={2} startAngle={90} endAngle={-270} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <div className="text-center">
            <div className="font-display text-2xl font-semibold num text-ink">{total}</div>
            <div className="eyebrow">Detections</div>
          </div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2.5 text-sm">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 rounded-[3px]" style={{ background: d.fill }} />
            <span className="text-ink-2 flex-1">{d.name}</span>
            <span className="num text-ink">{d.value}</span>
            <span className="num text-muted w-11 text-right">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
    </div>
  );
}

function HBar({ rows, height }: { rows: { name: string; value: number; fill: string }[]; height: number }) {
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }} barCategoryGap="28%">
          <CartesianGrid stroke="rgba(0,48,73,0.08)" horizontal={false} />
          <XAxis type="number" {...AXIS} allowDecimals={false} />
          <YAxis type="category" dataKey="name" {...AXIS} width={112} tick={{ fill: '#3b4148', fontSize: 12 }} />
          <Tooltip cursor={{ fill: 'rgba(102,155,188,0.08)' }} content={<ChartTooltip />} />
          <Bar isAnimationActive={false} dataKey="value" name="Detections" radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: 'right', fill: '#3b4148', fontSize: 11 }}>
            {rows.map((r) => (
              <Cell key={r.name} fill={r.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ReviewStatusChart({ byStatus }: { byStatus: Record<ReviewStatus, number> }) {
  const rows = REVIEW_STATUSES.map((s) => ({ name: REVIEW_LABEL[s], value: byStatus[s] ?? 0, fill: REVIEW_COLOR[s] }));
  return <HBar rows={rows} height={180} />;
}

export function SectionChart({ bySection }: { bySection: Record<string, number> }) {
  const rows = Object.entries(bySection).slice(0, 8).map(([name, value]) => ({ name, value, fill: '#5c839e' }));
  return <HBar rows={rows} height={Math.max(140, rows.length * 34)} />;
}

export function ConfidenceHistogram({ data }: { data: Analytics['confidence_histogram'] }) {
  return (
    <div style={{ height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }} barCategoryGap="12%">
          <defs>
            <linearGradient id="grad-confidence" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6f95ae" />
              <stop offset="100%" stopColor="#5c839e" stopOpacity={0.8} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="range" {...AXIS} />
          <YAxis {...AXIS} allowDecimals={false} />
          <Tooltip cursor={{ fill: 'rgba(102,155,188,0.08)' }} content={<ChartTooltip />} />
          <Bar isAnimationActive={false} dataKey="count" name="Detections" fill="url(#grad-confidence)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
