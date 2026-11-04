import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Boxes, Camera, Upload, X } from 'lucide-react';
import type { Aircraft, SourceType } from '@/types';
import { aircraftService } from '@/services/dataService';
import { useApp } from '@/context/AppContext';
import { cx } from '@/components/ui/primitives';

const SOURCES: { value: SourceType; label: string; icon: typeof Camera; body: string }[] = [
  { value: 'simulation', label: 'Simulation', icon: Boxes, body: 'Synthetic footage + 3D drone mission.' },
  { value: 'upload', label: 'Uploaded Video', icon: Upload, body: 'Process a recorded drone video file.' },
  { value: 'camera', label: 'Live Camera', icon: Camera, body: 'Real camera feed via OpenCV (device index or verified stream URL).' },
];

/** Step 1 of the workflow: choose source + aircraft, then open the Live Inspection console. */
export function NewInspectionDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { backendOnline } = useApp();
  const [source, setSource] = useState<SourceType>('simulation');
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [aircraftId, setAircraftId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scope = source === 'simulation' ? 'demo' : 'real';

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    aircraftService
      .list(scope)
      .then((a) => {
        setAircraft(a);
        setAircraftId(a[0]?.id ?? '');
      })
      .catch((e) => {
        setAircraft([]);
        setError(e.message);
      })
      .finally(() => setLoading(false));
  }, [open, scope]);

  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="new-insp-title">
      <div className="absolute inset-0 bg-navy/40" onClick={onClose} />
      <div className="relative panel w-full max-w-xl bg-surface shadow-2xl">
        <div className="panel-head">
          <h2 id="new-insp-title" className="panel-title">Start new inspection</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="p-5 space-y-5">
          <div>
            <div className="label">1 · Video source</div>
            <div className="grid sm:grid-cols-3 gap-2">
              {SOURCES.map(({ value, label, icon: Icon, body }) => (
                <button
                  key={value}
                  onClick={() => setSource(value)}
                  className={cx('text-left rounded-lg border p-3 transition-colors', source === value ? 'border-steel bg-steel/10' : 'border-line hover:border-line-strong bg-surface-2/50')}
                  aria-pressed={source === value}
                >
                  <Icon className={cx('size-4 mb-1.5', source === value ? 'text-steel-bright' : 'text-muted')} />
                  <div className="text-sm font-semibold text-ink">{label}</div>
                  <div className="text-[11px] text-muted mt-0.5 leading-snug">{body}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="label flex items-center gap-2">
              2 · Aircraft {scope === 'demo' ? null : <span className="chip text-ink-2 border-line">Registered fleet</span>}
            </div>
            {loading ? (
              <div className="field flex items-center text-muted">Loading aircraft…</div>
            ) : aircraft.length ? (
              <select className="field" value={aircraftId} onChange={(e) => setAircraftId(e.target.value)}>
                {aircraft.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id} · {a.registration} · {a.model}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn-ink">
                {error ?? 'No registered aircraft yet.'}{' '}
                {scope === 'real' && backendOnline && (
                  <button className="underline font-semibold" onClick={() => (onClose(), navigate('/aircraft?register=1'))}>Register an aircraft</button>
                )}
              </div>
            )}
            {scope === 'real' && <p className="text-[11px] text-faint mt-1.5">Camera/upload inspections are stored as REAL records and kept separate from demo data.</p>}
          </div>
          {!backendOnline && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn-ink">
              Backend offline: the inspection console will open, but video processing and detection storage require the FastAPI backend.
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-5">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={!aircraftId && source !== 'simulation'}
            onClick={() => {
              onClose();
              navigate(`/live?source=${source}${aircraftId ? `&aircraft=${encodeURIComponent(aircraftId)}` : ''}`);
            }}
          >
            Open inspection console
          </button>
        </div>
      </div>
    </div>
  );
}
