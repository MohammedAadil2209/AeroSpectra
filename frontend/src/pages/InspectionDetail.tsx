import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Circle, Film } from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAsync } from '@/hooks/useAsync';
import { inspectionService } from '@/services/dataService';
import { mediaUrl } from '@/services/api';
import { DetectionTable } from '@/components/defects/DetectionTable';
import { ReportButton } from '@/components/reports/ReportButton';
import { CategoryDonut } from '@/components/analytics/Charts';
import { Banner, EmptyState, ErrorState, InspectionStatusChip, KeyValue, Loading, PageHeader, Panel, SourceChip, StatTile } from '@/components/ui/primitives';
import { fmtDateTime, fmtDuration, fmtMoneyRange } from '@/utils/format';
import { DETECTION_MODE_LABEL, SECTIONS } from '@/utils/labels';
import type { Category } from '@/types';

export default function InspectionDetail() {
  const { id = '' } = useParams();
  const { scope, dataVersion, backendOnline } = useApp();
  const navigate = useNavigate();
  const r = useAsync(() => inspectionService.get(id, scope), [id, scope, dataVersion, backendOnline]);
  if (r.error) return <Panel><ErrorState message={r.error} onRetry={r.reload} /></Panel>;
  if (!r.data) return <Loading />;
  const i = r.data;
  const d = i.detections;
  const byCat = d.reduce((acc, x) => ((acc[x.category] = (acc[x.category] ?? 0) + 1), acc), { crack: 0, dent: 0, corrosion: 0, defect: 0 } as Record<Category, number>);

  return (
    <>
      <Link to="/inspections" className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink mb-3"><ArrowLeft className="size-3.5" /> Inspection history</Link>
      <PageHeader
        eyebrow="Inspection session"
        title={i.id}
        subtitle={<span className="flex flex-wrap items-center gap-2"><SourceChip source={i.source} /><InspectionStatusChip status={i.status} /><span>{DETECTION_MODE_LABEL[i.detection_mode]}</span></span>}
        actions={<ReportButton inspectionId={i.id} scope={i.is_demo ? 'demo' : 'real'} className="btn-primary" />}
      />
      {i.error && <div className="mb-4"><Banner tone="warn">{i.error}</Banner></div>}
      {i.detection_mode === 'none' && <div className="mb-4"><Banner tone="warn">No AI model was loaded for this session — video was processed but no automated detections were made.</Banner></div>}

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-4">
        <StatTile label="Detections" value={d.length} tone="steel" />
        <StatTile label="Critical / high risk" value={d.filter((x) => x.review_status !== 'false_positive' && (x.risk_level === 'critical' || x.risk_level === 'high')).length} tone="crit" sub="advisory" />
        <StatTile
          label="Est. repair cost"
          value={<span className="text-base">{fmtMoneyRange(d.filter((x) => x.review_status !== 'false_positive').reduce((a, x) => a + (x.cost_min ?? 0), 0), d.filter((x) => x.review_status !== 'false_positive').reduce((a, x) => a + (x.cost_max ?? 0), 0), 'INR', true)}</span>}
          sub={`${d.filter((x) => x.review_status !== 'false_positive').reduce((a, x) => a + (x.labour_hours ?? 0), 0).toFixed(1)} h · estimate`}
        />
        <StatTile label="Pending review" value={d.filter((x) => x.review_status === 'pending').length} tone="warn" />
        <StatTile label="Confirmed" value={d.filter((x) => x.review_status === 'confirmed').length} tone="crit" />
        <StatTile label="False positive" value={d.filter((x) => x.review_status === 'false_positive').length} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <Panel title="Session details">
          <KeyValue k="Aircraft" v={<Link className="text-steel-bright hover:underline" to={`/aircraft/${i.aircraft_id}`}>{i.aircraft_id}</Link>} />
          <KeyValue k="Model" v={`${i.aircraft.model} · ${i.aircraft.registration}`} />
          <KeyValue k="Started" v={fmtDateTime(i.started_at)} />
          <KeyValue k="Ended" v={fmtDateTime(i.ended_at)} />
          <KeyValue k="Duration" v={fmtDuration(i.duration_s)} />
          <KeyValue k="Frames processed" v={i.frames_processed.toLocaleString()} mono />
          <KeyValue k="Source detail" v={i.source_detail} mono />
          <KeyValue
            k="Recording"
            v={i.recording_url ? <a className="inline-flex items-center gap-1 text-steel-bright hover:underline" href={mediaUrl(i.recording_url) ?? '#'} download><Film className="size-3.5" /> Download</a> : 'None'}
          />
        </Panel>
        <Panel title="Sections inspected" actions={i.source === 'simulation' ? <span className="text-[11px] text-faint">simulated waypoints</span> : undefined}>
          <ul className="grid grid-cols-2 gap-y-1.5 text-sm">
            {SECTIONS.map((s) => {
              const done = i.sections_inspected.includes(s);
              return <li key={s} className={done ? 'text-ink-2 flex items-center gap-1.5' : 'text-faint flex items-center gap-1.5'}>{done ? <CheckCircle2 className="size-3.5 text-ok" /> : <Circle className="size-3.5" />}{s}</li>;
            })}
          </ul>
          {!i.sections_inspected.length && <p className="text-xs text-faint mt-2">No section data was recorded for this session.</p>}
        </Panel>
        <Panel title="Findings by category">
          <CategoryDonut byCategory={byCat} height={150} />
        </Panel>
      </div>

      <Panel title="Potential defects" bodyClass="p-0">
        {d.length ? <DetectionTable rows={d} showAircraft={false} onOpen={(x) => navigate(`/defects/${x.id}`)} /> : <EmptyState title="No potential defects recorded" />}
      </Panel>
    </>
  );
}
