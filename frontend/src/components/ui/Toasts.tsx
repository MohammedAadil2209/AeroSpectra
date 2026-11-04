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
        return (
          <div key={t.id} className="panel shadow-xl shadow-navy/15 px-3.5 py-3 flex gap-3 items-start bg-surface-2">
            <Icon className={cx('size-4 mt-0.5 shrink-0', tone)} />
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
