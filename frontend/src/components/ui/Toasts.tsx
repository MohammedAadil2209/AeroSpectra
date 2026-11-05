import { AlertTriangle, CheckCircle2, Info, OctagonAlert, X } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { cx } from './primitives';

export function Toasts() {
  const { toasts, dismiss } = useApp();
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[min(360px,calc(100vw-2rem))]" aria-live="polite">
      {toasts.map((t) => {
        const Icon = { info: Info, ok: CheckCircle2, warn: AlertTriangle, crit: OctagonAlert }[t.tone];
        const tone = { info: 'text-steel', ok: 'text-ok', warn: 'text-warn', crit: 'text-crit' }[t.tone];
        const accent = { info: 'border-l-steel', ok: 'border-l-ok', warn: 'border-l-warn', crit: 'border-l-crit' }[t.tone];
        const badge = { info: 'bg-steel/10 border-steel/30', ok: 'bg-ok/10 border-ok/30', warn: 'bg-warn/10 border-warn/30', crit: 'bg-crit/10 border-crit/30' }[t.tone];
        return (
          <div key={t.id} className={cx('panel toast-in shadow-float px-3.5 py-3 flex gap-3 items-start bg-surface/95 backdrop-blur border-l-[3px]', accent)}>
            <span className={cx('grid size-7 place-items-center rounded-lg border shrink-0', badge)}>
              <Icon className={cx('size-4', tone)} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-ink">{t.title}</div>
              {t.body && <div className="text-xs text-muted mt-0.5 break-words">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-faint hover:text-ink" aria-label="Dismiss notification">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
