import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, PlayCircle } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAsync } from '@/hooks/useAsync';
import { aircraftService, detectionService, inspectionService } from '@/services/dataService';
import { InspectionTable } from '@/components/inspection/InspectionTable';
import { DetectionTable } from '@/components/defects/DetectionTable';
import { CategoryDonut } from '@/components/analytics/Charts';
import { DemoBadge, EmptyState, ErrorState, KeyValue, Loading, PageHeader, Panel, StatTile } from '@/components/ui/primitives';
import { fmtDateTime } from '@/utils/format';
import type { Category } from '@/types';

export default function AircraftDetail() {
  const { id = '' } = useParams();
  const { scope, dataVersion, backendOnline } = useApp();
  const navigate = useNavigate();
  const ac = useAsync(() => aircraftService.get(id, scope), [id, scope, dataVersion, backendOnline]);
  const sc = ac.data ? (ac.data.is_demo ? 'demo' : 'real') : scope;
  const insp = useAsync(() => inspectionService.list(sc, id), [id, sc, dataVersion, backendOnline]);
  const dets = useAsync(() => detectionService.list(sc, { aircraft_id: id }), [id, sc, dataVersion, backendOnline]);

  if (ac.error) return <Panel><ErrorState message={ac.error} onRetry={ac.reload} /></Panel>;
  if (!ac.data) return <Loading />;
  const a = ac.data;
  const byCat = (dets.data ?? []).reduce((m, d) => ((m[d.category] = (m[d.category] ?? 0) + 1), m), { crack: 0, dent: 0, corrosion: 0 } as Record<Category, number>);

  return (
    <>
      <Link to="/aircraft" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink mb-3"><ArrowLeft className="size-3.5" /> Aircraft</Link>
      <PageHeader
        eyebrow="Aircraft record"
        title={`${a.id} · ${a.model}`}
        subtitle={<span className="flex items-center gap-2">{a.registration} · {a.operator || 'Operator not set'} {a.is_demo && <DemoBadge label="Fictional demo aircraft" />}</span>}
        actions={
          <button className="btn btn-primary" onClick={() => navigate(`/live?source=${a.is_demo ? 'simulation' : 'upload'}&aircraft=${encodeURIComponent(a.id)}`)}>
            <PlayCircle className="size-4" /> Inspect this aircraft
          </button>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label="Inspections" value={a.inspection_count} />
        <StatTile label="Recorded findings" value={a.finding_count} sub="excl. false positives" tone="steel" />
        <StatTile label="Open findings" value={a.open_finding_count} sub="pending review" tone="warn" />
        <StatTile label="Last inspection" value={<span className="text-base font-sans">{fmtDateTime(a.last_inspection_at)}</span>} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <Panel title="Aircraft information">
          <KeyValue k="Aircraft ID" v={a.id} mono />
          <KeyValue k="Model" v={a.model} />
          <KeyValue k="Registration" v={a.registration} mono />
          <KeyValue k="Operator" v={a.operator || '—'} />
          <KeyValue k="Base" v={a.base || '—'} />
          <KeyValue k="Record type" v={a.is_demo ? 'Demonstration (fictional)' : 'Registered (real)'} />
        </Panel>
        <Panel title="Findings by category" className="lg:col-span-2">
          <CategoryDonut byCategory={byCat} height={170} />
        </Panel>
      </div>
      <Panel title="Inspection history" bodyClass="p-0" className="mb-4">
        {insp.data?.length ? <InspectionTable rows={insp.data} showAircraft={false} onOpen={(i) => navigate(`/inspections/${i.id}`)} /> : insp.loading ? <Loading /> : <EmptyState title="No inspections for this aircraft" />}
      </Panel>
      <Panel title="Recorded findings" bodyClass="p-0">
        {dets.data?.length ? <DetectionTable rows={dets.data} showAircraft={false} onOpen={(d) => navigate(`/defects/${d.id}`)} /> : dets.loading ? <Loading /> : <EmptyState title="No findings recorded" />}
      </Panel>
    </>
  );
}
