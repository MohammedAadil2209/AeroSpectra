import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

export function Drawer({ open, onClose, title, children, width = 'max-w-2xl' }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-navy/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative h-full w-full ${width} bg-surface border-l border-line-strong flex flex-col shadow-2xl`}>
        <header className="flex items-center justify-between gap-3 px-5 h-14 border-b border-line shrink-0">
          <div className="font-display font-semibold text-ink min-w-0 truncate">{title}</div>
          <button onClick={onClose} className="btn btn-ghost btn-sm" aria-label="Close">
            <X className="size-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
