import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, FilterX, Search } from 'lucide-react';
import type { Category, Detection, ReviewStatus } from '@/types';
import { useApp } from '@/context/AppContext';
import { useAsync } from '@/hooks/useAsync';
import { aircraftService, detectionService } from '@/services/dataService';
import { ScopeNotice } from '@/components/layout/ScopeNotice';
import { DetectionTable } from '@/components/defects/DetectionTable';
import { DefectDetail } from '@/components/defects/DefectDetail';
import { Drawer } from '@/components/ui/Drawer';
import { EmptyState, ErrorState, Loading, PageHeader, Panel } from '@/components/ui/primitives';
import { CATEGORIES, CATEGORY_LABEL, REVIEW_LABEL, REVIEW_STATUSES } from '@/utils/labels';

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

function toCsv(rows: Detection[]) {
  const head = ['id', 'aircraft_id', 'inspection_id', 'category', 'confidence', 'detected_at', 'video_time_s', 'section', 'priority', 'origin', 'review_status', 'reviewer', 'reviewer_notes', 'is_demo'];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return [head.join(','), ...rows.map((r) => head.map((h) => esc(r[h as keyof Detection])).join(','))].join('\n');
}

export default function DefectRecords() {
  const { scope, dataVersion, backendOnline } = useApp();
  const { id } = useParams();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('q') ?? '');
  const dq = useDebounced(q);
  const f = {
    category: (sp.get('category') ?? '') as Category | '',
    review_status: (sp.get('status') ?? '') as ReviewStatus | '',
    aircraft_id: sp.get('aircraft') ?? '',
    date_from: sp.get('from') ?? '',
    date_to: sp.get('to') ?? '',
    min: sp.get('min') ?? '',
    max: sp.get('max') ?? '',
  };
  const set = (k: string, v: string) => {
    if (v) sp.set(k, v);
    else sp.delete(k);
    setSp(sp, { replace: true });
  };
  const filters = {
    category: f.category,
    review_status: f.review_status,
    aircraft_id: f.aircraft_id,
    date_from: f.date_from,
    date_to: f.date_to,
    min_confidence: f.min ? Number(f.min) / 100 : undefined,
    max_confidence: f.max ? Number(f.max) / 100 : undefined,
    q: dq,
  };
  const list = useAsync(() => detectionService.list(scope, filters), [scope, dataVersion, backendOnline, JSON.stringify(filters)]);
  const fleet = useAsync(() => aircraftService.list(scope), [scope, backendOnline]);
  const selected = useAsync(() => (id ? detectionService.get(id, scope) : Promise.resolve(null)), [id, scope, backendOnline]);
  const active = Object.values(f).some(Boolean) || !!dq;

  const counts = useMemo(() => {
    const c = { pending: 0, confirmed: 0, false_positive: 0 };
    list.data?.forEach((d) => d.review_status in c && c[d.review_status as keyof typeof c]++);
    return c;
  }, [list.data]);

  const exportCsv = () => {
    if (!list.data) return;
    const url = URL.createObjectURL(new Blob([toCsv(list.data)], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `aerospectra-defects-${scope}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        eyebrow="Defect detection records"
        title="Defect Records"
        subtitle="Search, filter and review every potential defect. Click a record to open its evidence and record a human review."
        actions={
          <button className="btn" onClick={exportCsv} disabled={!list.data?.length}>
            <Download className="size-4" /> Export CSV
          </button>
        }
      />
      <ScopeNotice />

      <Panel className="mb-4" bodyClass="p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-[1.6fr_repeat(6,1fr)_auto]">
          <div className="relative sm:col-span-2 lg:col-span-4 xl:col-span-1">
            <Search className="size-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="field pl-8" placeholder="Search ID, aircraft, session, section…" value={q} onChange={(e) => (setQ(e.target.value), set('q', e.target.value))} aria-label="Search defects" />
          </div>
          <select className="field" value={f.category} onChange={(e) => set('category', e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <select className="field" value={f.review_status} onChange={(e) => set('status', e.target.value)} aria-label="Review status">
            <option value="">All statuses</option>
            {REVIEW_STATUSES.map((s) => <option key={s} value={s}>{REVIEW_LABEL[s]}</option>)}
          </select>
          <select className="field" value={f.aircraft_id} onChange={(e) => set('aircraft', e.target.value)} aria-label="Aircraft">
            <option value="">All aircraft</option>
            {fleet.data?.map((a) => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select>
          <input type="date" className="field" value={f.date_from} onChange={(e) => set('from', e.target.value)} aria-label="From date" title="From date" />
          <input type="date" className="field" value={f.date_to} onChange={(e) => set('to', e.target.value)} aria-label="To date" title="To date" />
          <div className="flex items-center gap-1">
            <input type="number" min={0} max={100} className="field px-2" placeholder="min %" value={f.min} onChange={(e) => set('min', e.target.value)} aria-label="Minimum confidence %" />
            <span className="text-faint">–</span>
            <input type="number" min={0} max={100} className="field px-2" placeholder="max %" value={f.max} onChange={(e) => set('max', e.target.value)} aria-label="Maximum confidence %" />
          </div>
          <button className="btn" disabled={!active} onClick={() => (setQ(''), setSp(new URLSearchParams(), { replace: true }))}>
            <FilterX className="size-4" /> Clear
          </button>
        </div>
      </Panel>

      <Panel
        title={list.data ? `${list.data.length} record${list.data.length === 1 ? '' : 's'}` : 'Records'}
        bodyClass="p-0"
        actions={
          list.data && (
            <div className="hidden sm:flex gap-3 text-xs text-muted">
              <span><b className="num text-ink">{counts.pending}</b> pending</span>
              <span><b className="num text-ink">{counts.confirmed}</b> confirmed</span>
              <span><b className="num text-ink">{counts.false_positive}</b> false positive</span>
            </div>
          )
        }
      >
        {list.error ? (
          <ErrorState message={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <Loading />
        ) : list.data.length === 0 ? (
          <EmptyState title={active ? 'No records match these filters' : 'No defect records'} body={active ? 'Adjust or clear the filters.' : scope === 'real' ? 'Real records appear after camera or uploaded-video inspections with a loaded AI model.' : undefined} />
        ) : (
          <div className={list.loading ? 'opacity-60 transition-opacity' : ''}>
            <DetectionTable rows={list.data} onOpen={(d) => navigate(`/defects/${d.id}${location.search}`)} selectedId={id} />
          </div>
        )}
      </Panel>

      <Drawer open={!!id} onClose={() => navigate(`/defects${location.search}`)} title={<span className="num">{id}</span>}>
        {selected.error ? (
          <ErrorState message={selected.error} onRetry={selected.reload} />
        ) : selected.data ? (
          <DefectDetail
            detection={selected.data}
            scope={selected.data.is_demo ? 'demo' : 'real'}
            onUpdated={(d) => {
              selected.setData(() => d);
              list.setData((rows) => rows?.map((r) => (r.id === d.id ? d : r)) ?? rows);
            }}
          />
        ) : (
          <Loading />
        )}
      </Drawer>
    </>
  );
}
