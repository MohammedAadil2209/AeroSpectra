import type { Detection, MaintenanceStatus, RiskBreakdown, RiskLevel } from '@/types';
import { cx } from '@/components/ui/primitives';
import {
  MAINTENANCE_LABEL,
  MAINTENANCE_STYLE,
  RISK_COLOR,
  RISK_FACTORS,
  RISK_FACTOR_COLOR,
  RISK_FACTOR_LABEL,
  RISK_LABEL,
  RISK_STYLE,
} from '@/utils/labels';
import { fmtMoneyRange } from '@/utils/format';

export function RiskBadge({ level, score, size = 'sm' }: { level?: RiskLevel; score?: number; size?: 'sm' | 'lg' }) {
  const lv = level ?? 'low';
  return (
    <span
      className={cx('chip font-semibold num', RISK_STYLE[lv], size === 'lg' && 'text-sm px-2.5 py-1')}
      title="Advisory risk score (0-100) for human review — not an airworthiness decision"
    >
      {lv === 'critical' && <span className="size-1.5 rounded-full bg-white pulse-dot" />}
      {RISK_LABEL[lv]}
      {score !== undefined && <span className="opacity-80">· {Math.round(score)}</span>}
    </span>
  );
}

export function MaintenanceChip({ status }: { status?: MaintenanceStatus }) {
  const s = status ?? 'detected';
  return <span className={cx('chip', MAINTENANCE_STYLE[s])}>{MAINTENANCE_LABEL[s]}</span>;
}

export function CostRange({ d, currency = 'INR', compact }: { d: Pick<Detection, 'cost_min' | 'cost_max'>; currency?: string; compact?: boolean }) {
  return (
    <span className="num" title="Estimate, based on editable assumptions (Cost & ROI → Assumptions)">
      {fmtMoneyRange(d.cost_min, d.cost_max, currency, compact)}
    </span>
  );
}

/** "Why this score" — stacked bar of each factor's contribution in points. */
export function RiskBreakdownBar({ breakdown, score, level, compact }: { breakdown?: RiskBreakdown; score?: number; level?: RiskLevel; compact?: boolean }) {
  if (!breakdown) return <div className="text-xs text-faint">No breakdown available.</div>;
  const parts = RISK_FACTORS.map((k) => ({ k, f: breakdown[k] })).filter((p) => p.f);
  const ctx = breakdown._context;
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative h-3.5 flex-1 rounded-full bg-ink/8 overflow-hidden flex" role="img" aria-label={`Risk score ${Math.round(score ?? 0)} of 100`}>
          {parts.map(({ k, f }) => (
            <div
              key={k}
              style={{ width: `${f!.points}%`, background: RISK_FACTOR_COLOR[k] }}
              className="h-full border-r border-white/40 last:border-r-0"
              title={`${RISK_FACTOR_LABEL[k]}: +${f!.points} pts (factor ${Math.round(f!.value * 100)}% × weight ${f!.weight})`}
            />
          ))}
        </div>
        <span className="num text-sm font-bold w-10 text-right" style={{ color: RISK_COLOR[level ?? 'low'] }}>{Math.round(score ?? 0)}</span>
      </div>
      {!compact && (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          {parts.map(({ k, f }) => (
            <li key={k} className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm shrink-0" style={{ background: RISK_FACTOR_COLOR[k] }} />
              <span className="text-muted flex-1 truncate">{RISK_FACTOR_LABEL[k]}</span>
              <span className="num text-ink">+{f!.points.toFixed(1)}</span>
            </li>
          ))}
        </ul>
      )}
      {!compact && ctx && (
        <div className="text-[11px] text-faint">
          {ctx.area_pct}% of frame · {ctx.neighbours} nearby finding(s) in this pass · {ctx.prior_findings} prior finding(s) in this section
        </div>
      )}
    </div>
  );
}

export function Advisory({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="rounded-lg border border-[#e0a43a]/40 bg-[#e0a43a]/10 px-3 py-2 text-xs text-warn-ink">
      <b>ADVISORY</b> — {text.replace(/^ADVISORY:\s*/, '')}
      <div className="text-[10px] opacity-75 mt-0.5">Not an airworthiness or maintenance-release decision. Certified engineers decide.</div>
    </div>
  );
}
