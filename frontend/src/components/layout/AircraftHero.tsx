import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CategoryChip, PriorityChip, ReviewChip } from '@/components/ui/primitives';
import { CATEGORIES, CATEGORY_COLOR, CATEGORY_LABEL, SECTIONS } from '@/utils/labels';
import { fmtRelative, pct } from '@/utils/format';
import type { Aircraft, Category, Detection } from '@/types';

const AircraftHero3D = lazy(() => import('./AircraftHero3D'));

/** Overview hero: interactive 3D aircraft with every recorded finding pinned to the section it was found on. */
export function AircraftHero({ detections, fleet, children }: { detections: Detection[] | null; fleet: Aircraft[] | null; children?: ReactNode }) {
  const navigate = useNavigate();
  const [aircraft, setAircraft] = useState<string>('all');
  const [hovered, setHovered] = useState<Detection | null>(null);

  const shown = useMemo(
    () => (detections ?? []).filter((d) => d.review_status !== 'false_positive' && (aircraft === 'all' || d.aircraft_id === aircraft)),
    [detections, aircraft],
  );
  const bySection = useMemo(() => {
    type Row = { total: number } & Record<Category, number>;
    const m = new Map<string, Row>();
    for (const d of shown) {
      const row: Row = m.get(d.section) ?? { total: 0, crack: 0, dent: 0, corrosion: 0 };
      row.total++;
      row[d.category]++;
      m.set(d.section, row);
    }
    const order = [...SECTIONS, ...[...m.keys()].filter((k) => !(SECTIONS as readonly string[]).includes(k))];
    return order.filter((s) => m.has(s)).map((s) => ({ section: s, ...m.get(s)! }));
  }, [shown]);
  const maxSection = Math.max(1, ...bySection.map((r) => r.total));

  return (
    <div className="theme-dark relative overflow-hidden rounded-lg border border-line mb-4 bg-[radial-gradient(ellipse_at_65%_40%,#0a3d5a_0%,#011d2d_55%,#00131e_100%)]">
      <div className="absolute inset-0 opacity-[0.07] bg-[linear-gradient(#669bbc_1px,transparent_1px),linear-gradient(90deg,#669bbc_1px,transparent_1px)] bg-[size:28px_28px]" />

      <div className="relative grid lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)] gap-4 p-5">
        {/* left: title, aircraft filter, findings by section */}
        <div className="space-y-4 z-10 min-w-0">
          {children}
          <div className="flex items-center gap-2">
            <label htmlFor="hero-ac" className="text-[11px] uppercase tracking-wider text-muted">Aircraft</label>
            <select id="hero-ac" value={aircraft} onChange={(e) => setAircraft(e.target.value)} className="input h-8 text-sm flex-1 bg-surface-2 border border-line rounded-md px-2 text-ink">
              <option value="all">All aircraft ({(fleet ?? []).length})</option>
              {(fleet ?? []).map((a) => <option key={a.id} value={a.id}>{a.id} · {a.model}</option>)}
            </select>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[11px] uppercase tracking-wider text-muted">Findings by airframe section</span>
              <span className="num text-sm text-ink">{shown.length}</span>
            </div>
            {bySection.length === 0 ? (
              <p className="text-sm text-muted">{detections ? 'No recorded findings for this selection.' : 'Loading findings…'}</p>
            ) : (
              <ul className="space-y-1.5">
                {bySection.map((r) => (
                  <li key={r.section} className="grid grid-cols-[110px_1fr_28px] items-center gap-2 text-xs">
                    <span className="text-ink-2 truncate">{r.section}</span>
                    <span className="flex h-2 rounded-sm overflow-hidden bg-surface-3" style={{ width: `${(r.total / maxSection) * 100}%` }}>
                      {CATEGORIES.map((c) => r[c] > 0 && <span key={c} style={{ flex: r[c], background: CATEGORY_COLOR[c] }} />)}
                    </span>
                    <span className="num text-ink text-right">{r.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
            {CATEGORIES.map((c) => (
              <span key={c} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: CATEGORY_COLOR[c] }} />{CATEGORY_LABEL[c]}</span>
            ))}
            <span>Larger pin = higher priority · pulsing = pending review</span>
          </div>
        </div>

        {/* right: 3D airframe */}
        <div className="relative h-[300px] sm:h-[360px] lg:h-[400px] cursor-grab active:cursor-grabbing">
          <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-xs text-muted">Loading 3D model…</div>}>
            <AircraftHero3D detections={shown} hoveredId={hovered?.id ?? null} onHover={setHovered} onSelect={(d) => navigate(`/defects/${d.id}`)} />
          </Suspense>

          {hovered && (
            <div className="pointer-events-none absolute left-2 top-2 w-64 rounded-md border border-line-strong bg-surface/90 backdrop-blur px-3 py-2.5 shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <span className="num text-sm text-ink">{hovered.id}</span>
                <span className="text-[11px] text-muted">{fmtRelative(hovered.detected_at)}</span>
              </div>
              <div className="text-xs text-ink-2 mt-0.5">{hovered.section} · {hovered.aircraft_id}</div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <CategoryChip category={hovered.category} />
                <PriorityChip priority={hovered.priority} />
                <ReviewChip status={hovered.review_status} />
              </div>
              <div className="text-[11px] text-muted mt-2">Confidence <span className="num text-ink">{pct(hovered.confidence)}</span> · click to open record</div>
            </div>
          )}

          <div className="pointer-events-none absolute right-2 bottom-2 text-[10px] text-muted bg-black/30 px-1.5 py-0.5 rounded-sm">
            Drag to rotate · pins show the recorded section, not exact position
          </div>
        </div>
      </div>
    </div>
  );
}
