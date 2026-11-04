import { useState } from 'react';
import { Table2 } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAsync } from '@/hooks/useAsync';
import { analyticsService } from '@/services/dataService';
import { ScopeNotice } from '@/components/layout/ScopeNotice';
import { CategoryDonut, ConfidenceHistogram, DetectionTrendChart, InspectionsPerDayChart, ReviewStatusChart, SectionChart } from '@/components/analytics/Charts';
import { EmptyState, ErrorState, Loading, PageHeader, Panel, StatTile } from '@/components/ui/primitives';
import { CATEGORY_LABEL } from '@/utils/labels';

export default function Analytics() {
  const { scope, dataVersion, backendOnline } = useApp();
  const r = useAsync(() => analyticsService.get(scope), [scope, dataVersion, backendOnline]);
  const [table, setTable] = useState(false);
  const a = r.data;

  return (
    <>
      <PageHeader
        eyebrow="Inspection analytics"
        title="Analytics"
        subtitle="Computed from the stored inspection and detection records in the selected data scope."
        actions={<button className="btn" onClick={() => setTable((t) => !t)} aria-pressed={table}><Table2 className="size-4" /> {table ? 'Chart view' : 'Table view'}</button>}
      />
      <ScopeNotice />
      {r.error ? <Panel><ErrorState message={r.error} onRetry={r.reload} /></Panel> : !a ? <Loading /> : a.total_detections === 0 && a.total_inspections === 0 ? (
        <Panel><EmptyState title="No data in this scope yet" body="Run inspections to populate analytics." /></Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-4">
            <StatTile label="Inspections completed" value={a.completed_inspections} sub={`of ${a.total_inspections}`} tone="ok" />
            <StatTile label="Potential defects" value={a.total_detections} tone="steel" />
            <StatTile label="Pending reviews" value={a.pending_reviews} tone="warn" />
            <StatTile label="Confirmed findings" value={a.confirmed} tone="crit" />
            <StatTile label="False positives" value={a.false_positives} sub={a.total_detections ? `${Math.round((a.false_positives / a.total_detections) * 100)}% of detections` : undefined} />
            <StatTile label="High-priority open" value={a.high_priority} sub="rule-based triage" tone="crit" />
          </div>

          {table ? (
            <Panel title="Daily breakdown" bodyClass="p-0">
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>Date</th><th className="text-right">Inspections</th><th className="text-right">{CATEGORY_LABEL.crack}</th><th className="text-right">{CATEGORY_LABEL.dent}</th><th className="text-right">{CATEGORY_LABEL.corrosion}</th></tr></thead>
                  <tbody>
                    {a.trend.map((t) => (
                      <tr key={t.date}><td className="num">{t.date}</td><td className="text-right num">{t.inspections}</td><td className="text-right num">{t.crack}</td><td className="text-right num">{t.dent}</td><td className="text-right num">{t.corrosion}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <>
              <div className="grid gap-4 xl:grid-cols-3 mb-4">
                <Panel className="xl:col-span-2" title="Detection trend" actions={<span className="text-xs text-muted">per day, stacked by category</span>}>
                  <DetectionTrendChart data={a.trend} height={260} />
                </Panel>
                <Panel title="Defects by category"><CategoryDonut byCategory={a.by_category} /></Panel>
              </div>
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <Panel title="Inspections completed per day"><InspectionsPerDayChart data={a.trend} /></Panel>
                <Panel title="Review outcomes"><ReviewStatusChart byStatus={a.by_status} /></Panel>
                <Panel title="Detections by aircraft section"><SectionChart bySection={a.by_section} /></Panel>
                <Panel title="Confidence distribution" className="xl:col-span-3"><ConfidenceHistogram data={a.confidence_histogram} /></Panel>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
