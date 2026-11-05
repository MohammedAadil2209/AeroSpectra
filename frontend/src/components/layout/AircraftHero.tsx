import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, MousePointer2, Rotate3d } from 'lucide-react';
import { ReviewChip, cx } from '@/components/ui/primitives';
import { CATEGORIES, CATEGORY_LABEL, PRIORITY_LABEL, SECTIONS } from '@/utils/labels';
import { DEFECT_MAP_COLOR } from './defectMapColors';
import { fmtRelative, pct } from '@/utils/format';
import type { Aircraft, Category, Detection } from '@/types';

const AircraftHero3D = lazy(() => import('./AircraftHero3D'));

type Row = { section: string; total: number; pending: number; high: number } & Record<Category, number>;
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Stacked category bar (red wine / navy / grey blue). */
function CatBar({ row, className }: { row: Pick<Row, Category | 'total'>; className?: string }) {
  return (
    <span className={cx('flex h-1.5 rounded-full overflow-hidden bg-white/10', className)}>
      {row.total > 0 && CATEGORIES.map((c) => row[c] > 0 && <span key={c} style={{ flex: row[c], background: DEFECT_MAP_COLOR[c] }} />)}
    </span>
  );
}

function Kpi({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="px-3.5 py-2 rounded-lg bg-white/[.04] border border-line min-w-[92px]">
      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={cx('text-xl font-black num leading-tight font-sans', tone ?? 'text-ink')}>{value}</div>
    </div>
  );
}

/**
 * Overview: airframe defect map. Large 3D aircraft in the centre; hovering a part lights it up and shows
 * the damage recorded on that part, with the details in the right-hand panel.
 */
export function AircraftHero({ detections, fleet, children }: { detections: Detection[] | null; fleet: Aircraft[] | null; children?: ReactNode }) {
  const navigate = useNavigate();
  const [aircraft, setAircraft] = useState('all');
  const [hoverPart, setHoverPart] = useState<string | null>(null); // pointer over a part in 3D
  const [listPart, setListPart] = useState<string | null>(null); // pointer over a row in the parts list
  const [pinned, setPinned] = useState<string | null>(null); // clicked part
  const [sticky, setSticky] = useState<string | null>(null); // last hovered part, so the pointer can travel to the panel
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const shown = useMemo(
    () => (detections ?? []).filter((d) => d.review_status !== 'false_positive' && (aircraft === 'all' || d.aircraft_id === aircraft)),
    [detections, aircraft],
  );
  const rows = useMemo(() => {
    const m = new Map<string, Row>(SECTIONS.map((s) => [s, { section: s, total: 0, pending: 0, high: 0, crack: 0, dent: 0, corrosion: 0, defect: 0 }]));
    for (const d of shown) {
      const r = m.get(d.section) ?? { section: d.section, total: 0, pending: 0, high: 0, crack: 0, dent: 0, corrosion: 0, defect: 0 };
      r.total++; r[d.category]++;
      if (d.review_status === 'pending') r.pending++;
      if (d.priority === 'high') r.high++;
      m.set(d.section, r);
    }
    return [...m.values()];
  }, [shown]);

  const active = hoverPart ?? listPart ?? pinned ?? sticky;
  const activeRow = rows.find((r) => r.section === active);
  const activeList = useMemo(
    () => shown.filter((d) => d.section === active).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.confidence - a.confidence),
    [shown, active],
  );
  const totals = {
    pending: shown.filter((d) => d.review_status === 'pending').length,
    high: shown.filter((d) => d.priority === 'high').length,
    parts: rows.filter((r) => r.total > 0).length,
  };
  const worst = [...rows].sort((a, b) => b.high - a.high || b.total - a.total).filter((r) => r.total > 0).slice(0, 3);

  const onHover3D = (s: string | null) => { setHoverPart(s); if (s) setSticky(s); };
  const clear = () => { setPinned(null); setSticky(null); setFocusedId(null); };

  const panel = 'rounded-xl border border-line bg-[#071e2a]/75 backdrop-blur-md shadow-[0_20px_50px_-20px_rgba(0,0,0,.6)]';

  return (
    <div className="theme-dark relative overflow-hidden rounded-xl border border-line mb-4 bg-[radial-gradient(ellipse_at_50%_55%,#1a4a66_0%,#0c2f43_38%,#092635_62%,#051923_100%)]">
      <div className="pointer-events-none absolute inset-0 opacity-[0.06] bg-[linear-gradient(#9fc0d6_1px,transparent_1px),linear-gradient(90deg,#9fc0d6_1px,transparent_1px)] bg-[size:36px_36px] [mask-image:radial-gradient(ellipse_at_center,black_30%,transparent_75%)]" />

      {/* header */}
      <div className="relative z-10 flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">{children}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Kpi label="Findings" value={shown.length} />
          <Kpi label="Pending review" value={totals.pending} tone="text-warn-ink" />
          <Kpi label="High priority" value={totals.high} tone="text-[#e98a9a]" />
          <Kpi label="Parts affected" value={<>{totals.parts}<span className="text-sm text-muted font-bold">/{SECTIONS.length}</span></>} />
          <select
            aria-label="Aircraft"
            value={aircraft}
            onChange={(e) => { setAircraft(e.target.value); clear(); }}
            className="h-[52px] rounded-lg bg-white/[.04] border border-line px-3 text-sm text-ink min-w-[170px] focus:outline-none focus:border-steel"
          >
            <option value="all">All aircraft ({(fleet ?? []).length})</option>
            {(fleet ?? []).map((a) => <option key={a.id} value={a.id}>{a.id} · {a.model}</option>)}
          </select>
        </div>
      </div>

      {/* stage: plane (full view, never covered) + details panel beside it */}
      <div className="relative grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 px-5 pt-4">
        <div className="relative h-[380px] sm:h-[460px] lg:h-[520px] rounded-xl">
          <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-xs text-muted">Loading 3D model…</div>}>
            <AircraftHero3D
              detections={shown}
              active={active}
              preview={listPart}
              focusedId={focusedId}
              onHover={onHover3D}
              onSelect={(s) => setPinned((p) => (p === s ? null : s))}
              onClear={clear}
            />
          </Suspense>
          <div className="pointer-events-none absolute left-0 right-0 bottom-2 flex justify-center">
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 rounded-full border border-line bg-[#071e2a]/70 backdrop-blur px-4 py-1.5 text-[11px] text-ink-2">
              {CATEGORIES.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: DEFECT_MAP_COLOR[c] }} />{CATEGORY_LABEL[c]}</span>
              ))}
              <span className="text-muted">Larger mark = higher priority · pulse = pending review</span>
              <span className="inline-flex items-center gap-1 text-muted"><Rotate3d className="size-3.5" /> drag to rotate</span>
            </div>
          </div>
        </div>

        {/* right: part details */}
        <aside className={cx(panel, 'flex flex-col min-h-[320px] lg:h-[520px]')}>
          {active && activeRow ? (
            <>
              <div className="p-4 pb-3 border-b border-line">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-[#7fc4ff]">{pinned === active ? 'Selected part' : 'Inspecting'}</span>
                  {pinned === active && <button className="text-[11px] text-muted hover:text-ink" onClick={clear}>Clear</button>}
                </div>
                <h3 className="font-display text-2xl text-ink mt-1 leading-tight">{active}</h3>
                <div className="text-xs text-muted mt-1">
                  <span className="num text-ink font-sans font-bold">{activeRow.total}</span> findings ·{' '}
                  <span className="num text-ink font-sans font-bold">{activeRow.pending}</span> pending ·{' '}
                  <span className="num text-ink font-sans font-bold">{activeRow.high}</span> high priority
                </div>
                <CatBar row={activeRow} className="mt-3 h-2" />
                <div className="flex gap-3 mt-2 text-[11px] text-ink-2">
                  {CATEGORIES.map((c) => (
                    <span key={c} className="inline-flex items-center gap-1.5">
                      <span className="size-2 rounded-full" style={{ background: DEFECT_MAP_COLOR[c] }} />
                      {CATEGORY_LABEL[c]} <span className="num font-sans font-bold text-ink">{activeRow[c]}</span>
                    </span>
                  ))}
                </div>
              </div>
              {activeList.length ? (
                <ul className="flex-1 min-h-0 overflow-auto p-2" onMouseLeave={() => setFocusedId(null)}>
                  {activeList.map((d) => (
                    <li key={d.id}>
                      <button
                        onMouseEnter={() => setFocusedId(d.id)}
                        onClick={() => navigate(`/defects/${d.id}`)}
                        className="w-full text-left grid grid-cols-[10px_1fr_auto] items-center gap-x-2.5 rounded-lg px-2.5 py-2 hover:bg-white/[.06] transition-colors"
                      >
                        <span className="size-2.5 rounded-full" style={{ background: DEFECT_MAP_COLOR[d.category] }} />
                        <span className="min-w-0">
                          <span className="block text-[13px] text-ink truncate">
                            {CATEGORY_LABEL[d.category]} <span className="text-muted">· {PRIORITY_LABEL[d.priority]}</span>
                          </span>
                          <span className="block text-[11px] text-muted truncate"><span className="num">{d.id}</span> · {d.aircraft_id} · {fmtRelative(d.detected_at)}</span>
                        </span>
                        <span className="text-right">
                          <span className="block num text-sm font-sans font-bold text-ink">{pct(d.confidence)}</span>
                          <span className="block scale-90 origin-right"><ReviewChip status={d.review_status} /></span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="flex-1 grid place-items-center text-sm text-muted p-6 text-center">No findings recorded on this part.</div>
              )}
              <Link to="/defects" className="flex items-center justify-between px-4 py-3 border-t border-line text-xs text-steel-bright hover:text-ink">
                Open defect records <ArrowRight className="size-3.5" />
              </Link>
            </>
          ) : (
            <div className="flex-1 flex flex-col p-5">
              <div className="size-11 rounded-full bg-[#4fb0ff]/15 ring-1 ring-[#4fb0ff]/35 grid place-items-center text-[#7fc4ff]"><MousePointer2 className="size-5" /></div>
              <h3 className="font-display text-2xl text-ink mt-4 leading-tight">Hover a part of the aircraft</h3>
              <p className="text-sm text-muted mt-1.5">The part lights up and its recorded damage appears on the surface. Click to keep it selected.</p>
              {worst.length > 0 && (
                <div className="mt-auto">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted mb-2">Most affected</div>
                  <div className="space-y-1.5">
                    {worst.map((r) => (
                      <button key={r.section} onClick={() => setPinned(r.section)} className="w-full flex items-center justify-between rounded-lg px-3 py-2 bg-white/[.04] border border-line hover:border-[#4fb0ff]/50 transition-colors">
                        <span className="text-[13px] text-ink">{r.section}</span>
                        <span className="text-[11px] text-muted"><span className="num font-sans font-bold text-ink">{r.total}</span> · {r.high} high</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </aside>

      </div>

      {/* parts strip: hover a part to light it up on the plane, click to keep it selected */}
      <div className="px-5 pt-4 pb-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted">Airframe parts</span>
          <span className="text-[10px] text-faint">findings per part</span>
        </div>
        <ul className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2" onMouseLeave={() => setListPart(null)}>
          {rows.map((r) => (
            <li key={r.section}>
              <button
                onMouseEnter={() => setListPart(r.section)}
                onClick={() => setPinned((p) => (p === r.section ? null : r.section))}
                className={cx(
                  'w-full text-left rounded-lg px-3 py-2.5 border transition-colors',
                  active === r.section ? 'bg-[#4fb0ff]/15 border-[#4fb0ff]/45' : 'bg-white/[.03] border-line hover:bg-white/[.06]',
                )}
              >
                <div className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className={cx('truncate', r.total ? 'text-ink' : 'text-faint')}>{r.section}</span>
                  <span className="flex items-center gap-1.5">
                    {r.high > 0 && <span className="size-1.5 rounded-full bg-[#e98a9a]" title={`${r.high} high priority`} />}
                    <span className={cx('num text-sm font-sans font-bold', r.total ? 'text-ink' : 'text-faint')}>{r.total}</span>
                  </span>
                </div>
                <CatBar row={r} className="mt-2" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
