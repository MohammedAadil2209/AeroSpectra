import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAsync } from '@/hooks/useAsync';
import { inspectionService } from '@/services/dataService';
import { ScopeNotice } from '@/components/layout/ScopeNotice';
import { ReportButton } from '@/components/reports/ReportButton';
import { DemoBadge, EmptyState, ErrorState, InspectionStatusChip, Loading, PageHeader, Panel, SourceChip } from '@/components/ui/primitives';
import { fmtDateTime, fmtDuration } from '@/utils/format';

export default function Reports() {
  const { scope, dataVersion, backendOnline } = useApp();
  const navigate = useNavigate();
  const list = useAsync(() => inspectionService.list(scope), [scope, dataVersion, backendOnline]);
  return (
    <>
      <PageHeader
        eyebrow="Documentation"
        title="Inspection Reports"
        subtitle="Generate a PDF report per inspection: session metadata, sections inspected, potential defects with confidence, evidence images, human review status and reviewer notes. Simulated findings are labelled in the report."
      />
      <ScopeNotice />
      <Panel bodyClass="p-0">
        {list.error ? <ErrorState message={list.error} onRetry={list.reload} /> : !list.data ? <Loading /> : list.data.length === 0 ? (
          <EmptyState icon={<FileText className="size-5" />} title="No inspections to report" />
        ) : (
          <ul className="divide-y divide-line">
            {list.data.map((i) => (
              <li key={i.id} className="flex flex-col md:flex-row md:items-center gap-3 px-4 py-3 hover:bg-surface-2/50">
                <button className="flex-1 min-w-0 text-left" onClick={() => navigate(`/inspections/${i.id}`)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="num text-sm text-ink">{i.id}</span>
                    <SourceChip source={i.source} />
                    <InspectionStatusChip status={i.status} />
                    {i.is_demo && <DemoBadge label="simulated findings" />}
                  </div>
                  <div className="text-xs text-muted mt-1">{i.aircraft_id} · {fmtDateTime(i.started_at)} · {fmtDuration(i.duration_s)} · {i.detection_count} potential defect(s)</div>
                </button>
                <ReportButton inspectionId={i.id} scope={i.is_demo ? 'demo' : 'real'} className="btn-sm" label="PDF report" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
