import type { ReactNode } from 'react';
import { AlertTriangle, FlaskConical, Inbox, Loader2, RefreshCw, X } from 'lucide-react';
import type { Category, ComponentStatus, InspectionStatus, Priority, ReviewStatus, SourceType } from '@/types';
import {
  CATEGORY_COLOR,
  CATEGORY_LABEL,
  INSPECTION_STATUS_STYLE,
  PRIORITY_LABEL,
  PRIORITY_STYLE,
  REVIEW_LABEL,
  REVIEW_STYLE,
  SOURCE_LABEL,
} from '@/utils/labels';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function Panel({ title, icon, actions, children, className, bodyClass }: {
  title?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClass?: string;
}) {
  return (
    <section className={cx('panel flex flex-col min-w-0', className)}>
      {(title || actions) && (
        <header className="panel-head">
          <h2 className="panel-title">{icon}{title}</h2>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cx('flex-1 min-h-0', bodyClass ?? 'p-4')}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between mb-5">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-1">{eyebrow}</div>}
        <h1 className="text-xl md:text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1 max-w-3xl">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CategoryChip({ category }: { category: Category }) {
  return (
    <span className="chip bg-ink/[.04] border-ink/10 text-ink">
      <span className="size-2 rounded-[2px]" style={{ background: CATEGORY_COLOR[category] }} aria-hidden />
      {CATEGORY_LABEL[category]}
    </span>
  );
}

export function ReviewChip({ status }: { status: ReviewStatus }) {
  return <span className={cx('chip', REVIEW_STYLE[status])}>{REVIEW_LABEL[status]}</span>;
}

export function PriorityChip({ priority }: { priority: Priority }) {
  return <span className={cx('chip', PRIORITY_STYLE[priority])} title="Rule-based triage priority — not a certified severity">{PRIORITY_LABEL[priority]}</span>;
}

export function InspectionStatusChip({ status }: { status: InspectionStatus }) {
  return <span className={cx('chip capitalize', INSPECTION_STATUS_STYLE[status])}>{status}</span>;
}

export function SourceChip({ source }: { source: SourceType }) {
  const style = source === 'camera' ? 'text-ok-ink border-ok/35 bg-ok/10' : source === 'upload' ? 'text-steel-bright border-steel/35 bg-steel/10' : 'text-demo-ink border-demo-line bg-demo-bg';
  return <span className={cx('chip uppercase tracking-wider', style)}>{SOURCE_LABEL[source]}</span>;
}

/** Explicit marker for demonstration / simulated content. */
export function DemoBadge({ label = 'Demo data', className }: { label?: string; className?: string }) {
  return (
    <span className={cx('chip uppercase tracking-wider text-demo-ink border-demo-line bg-demo-bg', className)} title="Fictional demonstration data — not real inspection results">
      <FlaskConical className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export function OriginBadge({ origin }: { origin: 'ai' | 'simulated' }) {
  return origin === 'ai' ? (
    <span className="chip text-steel-bright border-steel/40 bg-steel/10 uppercase tracking-wider" title="Produced by a loaded YOLO model — still a potential defect pending human review">AI prediction</span>
  ) : (
    <span className="chip text-demo-ink border-demo-line bg-demo-bg uppercase tracking-wider" title="Synthetic ground truth — no AI model involved">Simulated</span>
  );
}

const STATUS_DOT: Record<ComponentStatus['status'] | 'connecting', string> = {
  online: 'bg-ok',
  degraded: 'bg-warn',
  connecting: 'bg-warn',
  not_configured: 'bg-faint',
  unavailable: 'bg-warn',
  offline: 'bg-crit',
};
export const STATUS_TEXT: Record<ComponentStatus['status'] | 'connecting', string> = {
  online: 'Online',
  degraded: 'Degraded',
  connecting: 'Connecting',
  not_configured: 'Not configured',
  unavailable: 'Unavailable',
  offline: 'Offline',
};
export function StatusDot({ status, pulse }: { status: ComponentStatus['status'] | 'connecting'; pulse?: boolean }) {
  return <span className={cx('inline-block size-2 rounded-full shrink-0', STATUS_DOT[status], pulse && status === 'online' && 'pulse-dot')} aria-hidden />;
}

export function StatTile({ label, value, sub, icon, tone = 'default', to, onClick }: {
  label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'default' | 'crit' | 'warn' | 'ok' | 'steel'; to?: string; onClick?: () => void;
}) {
  const accent = { default: 'before:bg-line-strong', crit: 'before:bg-crimson', warn: 'before:bg-warn', ok: 'before:bg-ok', steel: 'before:bg-steel' }[tone];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      data-to={to}
      className={cx(
        'panel relative overflow-hidden text-left px-4 py-3.5 before:absolute before:left-0 before:top-3 before:bottom-3 before:w-[3px] before:rounded-r',
        accent,
        onClick && 'hover:border-line-strong transition-colors cursor-pointer',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">{label}</span>
        <span className="text-faint">{icon}</span>
      </div>
      <div className="mt-1.5 text-2xl font-semibold font-display text-ink num leading-tight">{value}</div>
      {sub && <div className="text-xs text-muted mt-0.5 truncate">{sub}</div>}
    </Comp>
  );
}

export function Loading({ label = 'Loading…', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2 py-10 text-sm text-muted', className)} role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-md bg-surface-2', className)} />;
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-12 px-6">
      <div className="size-10 rounded-full bg-surface-2 border border-line grid place-items-center text-muted mb-3">{icon ?? <Inbox className="size-5" />}</div>
      <div className="font-medium text-ink">{title}</div>
      {body && <div className="text-sm text-muted mt-1 max-w-md">{body}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 px-6">
      <div className="size-10 rounded-full bg-crimson/15 border border-crimson/40 grid place-items-center text-crit mb-3">
        <AlertTriangle className="size-5" />
      </div>
      <div className="font-medium text-ink">Could not load data</div>
      <div className="text-sm text-muted mt-1 max-w-md">{message}</div>
      {onRetry && (
        <button className="btn btn-sm mt-4" onClick={onRetry}>
          <RefreshCw className="size-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

export function Banner({ tone = 'info', children, onClose }: { tone?: 'info' | 'warn' | 'crit' | 'demo'; children: ReactNode; onClose?: () => void }) {
  const style = {
    info: 'border-steel/35 bg-steel/10 text-ink-2',
    warn: 'border-warn/40 bg-warn/10 text-warn-ink',
    crit: 'border-crimson/50 bg-crimson/15 text-crit-ink',
    demo: 'border-demo-line demo-ribbon text-demo-ink',
  }[tone];
  return (
    <div className={cx('flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm', style)} role={tone === 'crit' ? 'alert' : 'status'}>
      <div className="flex-1 min-w-0">{children}</div>
      {onClose && (
        <button className="text-muted hover:text-ink" onClick={onClose} aria-label="Dismiss">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange, size = 'md', ariaLabel }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md'; ariaLabel?: string;
}) {
  return (
    <div className="inline-flex rounded-lg border border-line-strong bg-surface-2 p-0.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'rounded-md font-semibold transition-colors inline-flex items-center gap-1.5',
            size === 'sm' ? 'px-2.5 h-6 text-[11px]' : 'px-3 h-7 text-xs',
            value === o.value ? 'bg-navy text-white' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function KeyValue({ k, v, mono }: { k: string; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-line last:border-0 text-sm">
      <span className="text-muted shrink-0">{k}</span>
      <span className={cx('text-ink text-right min-w-0 break-words', mono && 'num text-[13px]')}>{v}</span>
    </div>
  );
}
