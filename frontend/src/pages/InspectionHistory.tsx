import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import type { InspectionStatus, SourceType } from '@/types';
import { useApp } from '@/context/AppContext';
import { useAsync } from '@/hooks/useAsync';
import { inspectionService } from '@/services/dataService';
import { ScopeNotice } from '@/components/layout/ScopeNotice';
import { InspectionTable } from '@/components/inspection/InspectionTable';
import { EmptyState, ErrorState, Loading, PageHeader, Panel } from '@/components/ui/primitives';
import { SOURCE_LABEL } from '@/utils/labels';

export default function InspectionHistory() {
  const { scope, dataVersion, backendOnline } = useApp();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<InspectionStatus | ''>('');
  const [source, setSource] = useState<SourceType | ''>('');
  const list = useAsync(() => inspectionService.list(scope), [scope, dataVersion, backendOnline]);

  const rows = useMemo(
    () =>
      (list.data ?? []).filter(
        (i) => (!status || i.status === status) && (!source || i.source === source) && (!q || `${i.id} ${i.aircraft_id}`.toLowerCase().includes(q.toLowerCase())),
      ),
    [list.data, q, status, source],
  );

  return (
    <>
      <PageHeader eyebrow="Inspection sessions" title="Inspection History" subtitle="Every inspection session with its duration, outcome and findings. Open a session to review its detections and generate a report." />
      <ScopeNotice />
      <Panel bodyClass="p-0" title={`${rows.length} session${rows.length === 1 ? '' : 's'}`} actions={
        <div className="flex flex-wrap gap-2">
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
            <input className="field h-8 pl-8 w-44" placeholder="Search ID / aircraft" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search inspections" />
          </div>
          <select className="field h-8 w-36" value={status} onChange={(e) => setStatus(e.target.value as InspectionStatus | '')} aria-label="Status">
            <option value="">All statuses</option>
            {['active', 'paused', 'completed', 'aborted', 'failed'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select className="field h-8 w-40" value={source} onChange={(e) => setSource(e.target.value as SourceType | '')} aria-label="Source">
            <option value="">All sources</option>
            {(Object.keys(SOURCE_LABEL) as SourceType[]).map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </div>
      }>
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : rows.length === 0 ? (
          <EmptyState title="No inspection sessions" body={scope === 'real' ? 'Start a Live Camera or Uploaded Video inspection to create real sessions.' : 'No sessions match these filters.'} />
        ) : (
          <InspectionTable rows={rows} onOpen={(i) => navigate(`/inspections/${i.id}`)} />
        )}
      </Panel>
    </>
  );
}
