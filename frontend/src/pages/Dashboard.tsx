import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Cpu,
  Database,
  History,
  PieChart,
  Plane,
  PlayCircle,
  Radio,
  ScanSearch,
  Server,
  ShieldAlert,
  TriangleAlert,
  Video,
} from 'lucide-react';
import { useApp } from '@/context/AppContext';
import { useAsync } from '@/hooks/useAsync';
import { aircraftService, analyticsService, detectionService, inspectionService } from '@/services/dataService';
import { ScopeNotice } from '@/components/layout/ScopeNotice';
import { AircraftHero } from '@/components/layout/AircraftHero';
import { CategoryDonut, DetectionTrendChart } from '@/components/analytics/Charts';
import { LiveOpsPanel } from '@/components/analytics/LiveOpsPanel';
import { DetectionTable } from '@/components/defects/DetectionTable';
import { NewInspectionDialog } from '@/components/inspection/NewInspectionDialog';
import {
  EmptyState,
  ErrorState,
  InspectionStatusChip,
  PageHeader,
  Panel,
  STATUS_TEXT,
  Skeleton,
  SourceChip,
  StatTile,
  StatusDot,
  cx,
} from '@/components/ui/primitives';
import { fmtDuration, fmtRelative } from '@/utils/format';
import { DETECTION_MODE_LABEL } from '@/utils/labels';

export default function Dashboard() {
  const { scope, dataVersion, health, backendOnline, active, wsState, kpi } = useApp();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState(false);
  const an = useAsync(() => analyticsService.get(scope), [scope, dataVersion, backendOnline]);
  const recent = useAsync(() => detectionService.list(scope), [scope, dataVersion, backendOnline]);
  const insp = useAsync(() => inspectionService.list(scope), [scope, dataVersion, backendOnline]);
  const fleet = useAsync(() => aircraftService.list(scope), [scope, dataVersion, backendOnline]);
  // live KPIs pushed by the server win over the last fetch
  const a = kpi[scope] ?? an.data;

  const camStatus = health?.camera.status ?? 'offline';
  const aiStatus = health?.ai_model.status ?? 'offline';

  return (
    <>
      <PageHeader
        eyebrow="AI-powered aircraft visual inspection"
        title="Operations Overview"
        subtitle="Current inspection activity, potential defects awaiting human review, and system readiness."
        actions={
          <>
            <Link to="/simulation" className="btn">
              <Boxes className="size-4" /> Drone simulator
            </Link>
            <button className="btn btn-primary h-10 px-5 text-sm" onClick={() => setDialog(true)}>
              <PlayCircle className="size-4" /> START NEW INSPECTION
            </button>
          </>
        }
      />
      <ScopeNotice />

      <AircraftHero detections={recent.data} fleet={fleet.data}>
        <div className="text-[11px] uppercase tracking-[0.18em] text-steel-bright">Airframe defect map</div>
        <h2 className="font-display text-3xl text-ink mt-1">Where the damage is</h2>
        <p className="text-sm text-muted mt-1">Hover any part of the aircraft to inspect its recorded findings.</p>
      </AircraftHero>

      {/* operational status strip */}
      {active && (
        <button onClick={() => navigate('/live')} className="w-full mb-4 panel border-crimson/50 bg-crimson/10 px-4 py-3 flex flex-wrap items-center gap-3 text-left hover:bg-crimson/15 transition-colors">
          <span className="size-2.5 rounded-full bg-crit pulse-dot" />
          <span className="font-semibold">Inspection in progress</span>
          <span className="num text-sm text-ink-2">{active.inspection_id} · {active.aircraft_id}</span>
          <SourceChip source={active.source} />
          <span className="text-sm text-muted">{active.detections} detection(s) · {fmtDuration(active.elapsed_s)}</span>
          <span className="ml-auto text-sm text-steel-bright inline-flex items-center gap-1">Open console <ArrowRight className="size-4" /></span>
        </button>
      )}

      {an.error ? (
        <Panel className="mb-4"><ErrorState message={an.error} onRetry={an.reload} /></Panel>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 2xl:grid-cols-8 gap-3 mb-4">
          {!a ? (
            Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[92px]" />)
          ) : (
            <>
              <StatTile label="Inspections" value={a.total_inspections} sub="inspection records" icon={<ClipboardCheck className="size-4" />} surface="dark" onClick={() => navigate('/inspections')} />
              <StatTile label="Potential defects" value={a.total_detections} sub={`${a.by_category.crack} crack · ${a.by_category.dent} dent · ${a.by_category.corrosion} corr.${a.by_category.defect ? ` · ${a.by_category.defect} defect` : ''}`} icon={<ScanSearch className="size-4" />} tone="steel" surface="secondary" onClick={() => navigate('/defects')} />
              <StatTile label="High-priority" value={a.high_priority} sub="AI-triaged, not certified" icon={<ShieldAlert className="size-4" />} tone="crit" onClick={() => navigate('/defects')} />
              <StatTile label="Pending review" value={a.pending_reviews} sub="awaiting human reviewer" icon={<TriangleAlert className="size-4" />} tone="warn" surface="highlight" onClick={() => navigate('/defects?status=pending')} />
              <StatTile label="Completed" value={a.completed_inspections} sub="inspection sessions" icon={<CheckCircle2 className="size-4" />} tone="ok" />
              <StatTile label="Active now" value={active ? 1 : 0} sub={active ? active.inspection_id : 'no session running'} icon={<Activity className="size-4" />} tone={active ? 'crit' : 'default'} onClick={() => navigate('/live')} />
              <StatTile
                label="Drone camera"
                value={<span className="flex items-center gap-2 text-base font-sans"><StatusDot status={camStatus} />{STATUS_TEXT[camStatus]}</span>}
                sub={health ? 'Elilvendan B2 · feed bridge pending' : 'backend offline'}
                icon={<Radio className="size-4" />}
                onClick={() => navigate('/settings')}
              />
              <StatTile
                label="AI model"
                value={<span className="flex items-center gap-2 text-base font-sans"><StatusDot status={aiStatus} />{aiStatus === 'online' ? 'Loaded' : 'Not loaded'}</span>}
                sub={aiStatus === 'online' ? `${health?.ai_model.model ?? 'YOLO'} · ${health?.ai_model.device ?? ''}` : 'no weights · sim mode only'}
                icon={<Cpu className="size-4" />}
                onClick={() => navigate('/settings')}
              />
            </>
          )}
        </div>
      )}

      {a && <LiveOpsPanel a={a} />}

      <div className="grid gap-4 xl:grid-cols-3 mb-4">
        <Panel className="xl:col-span-2" title="Detection trend" icon={<Activity className="text-steel" />} actions={<span className="text-xs text-muted">potential defects per day, by category</span>}>
          {a ? a.trend.length ? <DetectionTrendChart data={a.trend} /> : <EmptyState title="No detections yet" /> : <Skeleton className="h-[260px]" />}
        </Panel>
        <Panel title="Defect distribution" icon={<PieChart className="text-steel" />}>
          {a ? <CategoryDonut byCategory={a.by_category} /> : <Skeleton className="h-[200px]" />}
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-3 mb-4">
        <Panel
          className="xl:col-span-2"
          title="Recent detection records"
          icon={<ScanSearch className="text-steel" />}
          bodyClass="p-0"
          actions={<Link to="/defects" className="btn btn-ghost btn-sm">View all <ArrowRight className="size-3.5" /></Link>}
        >
          {recent.error ? (
            <ErrorState message={recent.error} onRetry={recent.reload} />
          ) : !recent.data ? (
            <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : recent.data.length === 0 ? (
            <EmptyState title="No detections recorded" body={scope === 'real' ? 'Run a camera or uploaded-video inspection with a loaded model to create real records.' : undefined} />
          ) : (
            <DetectionTable rows={recent.data.slice(0, 6)} compact onOpen={(d) => navigate(`/defects/${d.id}`)} />
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="System status" icon={<Server className="text-steel" />}>
            <ul className="space-y-0.5 text-sm">
              <SysRow icon={<Server className="size-4" />} label="Backend API" status={backendOnline ? 'online' : 'offline'} detail={backendOnline ? `v${health?.version}` : 'not reachable'} />
              <SysRow icon={<Database className="size-4" />} label="Database" status={health?.database.status ?? 'offline'} detail={health?.database.detail ?? '—'} />
              <SysRow icon={<Radio className="size-4" />} label="Live link (WebSocket)" status={wsState === 'open' ? 'online' : 'offline'} detail={wsState} />
              <SysRow icon={<Cpu className="size-4" />} label="AI model" status={aiStatus} detail={aiStatus === 'online' ? 'YOLO loaded' : 'no weights'} />
              <SysRow icon={<Video className="size-4" />} label="Drone camera" status={camStatus} detail={STATUS_TEXT[camStatus]} />
            </ul>
          </Panel>
          <Panel title="Recent inspection activity" icon={<History className="text-steel" />} bodyClass="p-0">
            {insp.data?.length ? (
              <ul className="divide-y divide-line">
                {insp.data.slice(0, 5).map((i) => (
                  <li key={i.id}>
                    <Link to={`/inspections/${i.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-ink num">{i.id}</div>
                        <div className="text-xs text-muted truncate">{i.aircraft_id} · {i.detection_count} detection(s) · {fmtRelative(i.started_at)}</div>
                      </div>
                      <InspectionStatusChip status={i.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : insp.loading ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : (
              <EmptyState title="No inspections yet" body={insp.error ?? undefined} />
            )}
          </Panel>
        </div>
      </div>

      <Panel title="Aircraft inspection summary" icon={<Plane className="size-4 text-steel" />} bodyClass="p-0" actions={<Link to="/aircraft" className="btn btn-ghost btn-sm">Fleet <ArrowRight className="size-3.5" /></Link>}>
        {fleet.data?.length ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5 gap-px bg-line">
            {fleet.data.map((f) => (
              <Link key={f.id} to={`/aircraft/${f.id}`} className="bg-surface p-4 hover:bg-surface-2 transition-colors">
                <div className="flex items-center justify-between">
                  <span className="num text-sm text-ink">{f.id}</span>
                  {f.open_finding_count > 0 ? <span className="chip text-warn-ink bg-warn/10 border-warn/35">{f.open_finding_count} open</span> : <span className="chip text-ok-ink bg-ok/10 border-ok/35">clear</span>}
                </div>
                <div className="text-sm text-ink-2 mt-1">{f.model}</div>
                <div className="text-xs text-muted">{f.registration} · {f.base || '—'}</div>
                <div className="flex gap-4 mt-3 text-xs">
                  <span><span className="num text-ink">{f.inspection_count}</span> <span className="text-muted">insp.</span></span>
                  <span><span className="num text-ink">{f.finding_count}</span> <span className="text-muted">findings</span></span>
                  <span className="text-muted ml-auto">{fmtRelative(f.last_inspection_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        ) : fleet.loading ? (
          <div className="p-4"><Skeleton className="h-24" /></div>
        ) : (
          <EmptyState title="No aircraft" body={fleet.error ?? (scope === 'real' ? 'Register aircraft under Aircraft.' : undefined)} />
        )}
      </Panel>

      <p className="text-[11px] text-faint mt-4">
        AeroSpectra detections are <b>potential defects</b> for human review — not certified maintenance diagnoses. Detection mode legend: {Object.values(DETECTION_MODE_LABEL).join(' · ')}.
      </p>
      <NewInspectionDialog open={dialog} onClose={() => setDialog(false)} />
    </>
  );
}

const SYS_CHIP: Record<string, string> = {
  online: 'text-ok-ink border-ok/35 bg-ok/10',
  degraded: 'text-warn-ink border-warn/40 bg-warn/10',
  connecting: 'text-warn-ink border-warn/40 bg-warn/10',
  unavailable: 'text-warn-ink border-warn/40 bg-warn/10',
  not_configured: 'text-muted border-line bg-surface-2',
  offline: 'text-crit-ink border-crit/35 bg-crit/10',
};

function SysRow({ icon, label, status, detail }: { icon: React.ReactNode; label: string; status: Parameters<typeof StatusDot>[0]['status']; detail: string }) {
  return (
    <li className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-surface-2/70">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-surface-2 text-steel">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-ink leading-tight">{label}</div>
        <div className="text-[11px] text-muted truncate mt-0.5">{detail}</div>
      </div>
      <span className={cx('chip !h-[20px] !px-1.5 !text-[9.5px] uppercase tracking-[0.06em]', SYS_CHIP[status] ?? SYS_CHIP.not_configured)}>{STATUS_TEXT[status]}</span>
    </li>
  );
}
