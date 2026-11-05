import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Boxes, Camera, CircleDot, FileText, Pause, Play, Plane, Square, Upload, Video } from 'lucide-react';
import type { Aircraft, SourceType, UploadInfo } from '@/types';
import { useApp } from '@/context/AppContext';
import { aircraftService, inspectionService } from '@/services/dataService';
import { getApiBase } from '@/services/api';
import { inspectionSocket } from '@/services/wsClient';
import { useMission } from '@/hooks/useMission';
import { VideoStage } from '@/components/inspection/VideoStage';
import { DetectionPanel } from '@/components/inspection/DetectionPanel';
import { ConfidenceSlider, LiveAIRecord } from '@/components/inspection/LiveAIRecord';
import { CAMERA_URI_KEY, CameraSetup, UploadSetup } from '@/components/inspection/SourceSetup';
import { DRONE_IP_KEY, DroneSetup } from '@/components/inspection/DroneSetup';
import { SimulationViewport } from '@/components/simulation/SimulationViewport';
import { MissionButtons, SectionChecklist, TelemetryGrid } from '@/components/simulation/MissionPanels';
import { Banner, KeyValue, PageHeader, Panel, Segmented, cx } from '@/components/ui/primitives';
import { DETECTION_MODE_LABEL, SECTIONS, SOURCE_LABEL } from '@/utils/labels';

const SOURCE_OPTS: { value: SourceType; label: React.ReactNode }[] = [
  { value: 'drone_direct', label: <><Plane className="size-3.5" /> Drone</> },
  { value: 'camera', label: <><Camera className="size-3.5" /> Camera</> },
  { value: 'simulation', label: <><Boxes className="size-3.5" /> Simulation</> },
  { value: 'upload', label: <><Upload className="size-3.5" /> Video file</> },
];

export default function LiveInspection() {
  const [params, setParams] = useSearchParams();
  const { backendOnline, active, setActive, liveDetections, clearLiveDetections, notify, healthChecked, health, ai, presentMode } = useApp();
  const [source, setSourceState] = useState<SourceType>((params.get('source') as SourceType) || 'drone_direct');
  const [aircraft, setAircraft] = useState<Aircraft[]>([]);
  const [aircraftId, setAircraftId] = useState(params.get('aircraft') ?? '');
  const [cameraUri, setCameraUri] = useState(() => localStorage.getItem(CAMERA_URI_KEY) ?? 'rtsp://192.168.1.1:7070/webcam');
  const [droneIp, setDroneIp] = useState(() => localStorage.getItem(DRONE_IP_KEY) ?? '');
  const [upload, setUpload] = useState<UploadInfo | null>(null);
  const [localFile, setLocalFile] = useState<File | null>(null);
  const [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSession, setLastSession] = useState<string | null>(null);
  const [localOnly, setLocalOnly] = useState(false);
  const [operatorSection, setOperatorSection] = useState('Unassigned');
  const m = useMission({ speed: 3 });

  const running = !!active || localOnly;
  const effSource: SourceType = active?.source ?? source;
  const scope = effSource === 'simulation' ? 'demo' : 'real';

  const setSource = (s: SourceType) => {
    setSourceState(s);
    params.set('source', s);
    setParams(params, { replace: true });
  };

  // sync active session on mount (another tab may have started it)
  useEffect(() => {
    if (!backendOnline) return;
    inspectionService.active().then((r) => setActive(r.active)).catch(() => undefined);
  }, [backendOnline, setActive]);

  useEffect(() => {
    if (active) setAircraftId(active.aircraft_id);
  }, [active]);

  useEffect(() => {
    aircraftService
      .list(scope)
      .then((list) => {
        setAircraft(list);
        setAircraftId((cur) => (list.some((a) => a.id === cur) ? cur : list[0]?.id ?? ''));
      })
      .catch(() => setAircraft([]));
  }, [scope, backendOnline]);

  const localUrl = useMemo(() => (localFile ? URL.createObjectURL(localFile) : null), [localFile]);
  useEffect(() => () => void (localUrl && URL.revokeObjectURL(localUrl)), [localUrl]);

  // ---- 3D mission ↔ inspection session sync (simulation source)
  const simActive = active?.source === 'simulation';
  useEffect(() => {
    if (!simActive || !active) return;
    if (active.status === 'active' && m.snap.status !== 'running' && m.snap.status !== 'completed') m.start();
    if (active.status === 'paused' && m.snap.status === 'running') m.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simActive, active?.status]);
  useEffect(() => {
    if (simActive && m.snap.status !== 'ready') inspectionSocket.send('telemetry', { section: m.snap.section });
  }, [simActive, m.snap.section, m.snap.status]);

  // ---- smooth timer between 2 Hz WS frame updates
  const [, tick] = useState(0);
  const lastSync = useRef({ v: 0, at: Date.now() });
  useEffect(() => {
    if (active) lastSync.current = { v: active.elapsed_s, at: Date.now() };
  }, [active?.elapsed_s, active]);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, []);
  const elapsed = active
    ? active.status === 'active'
      ? lastSync.current.v + Math.min(1.2, (Date.now() - lastSync.current.at) / 1000)
      : active.elapsed_s
    : localOnly
      ? m.snap.elapsed
      : 0;

  const sessionDetections = useMemo(
    () => liveDetections.filter((d) => !active || d.inspection_id === active.inspection_id || d.inspection_id === lastSession),
    [liveDetections, active, lastSession],
  );

  // ---- controls
  const start = async () => {
    if (!backendOnline) {
      if (source === 'simulation') {
        m.reset();
        m.start();
        setLocalOnly(true);
        notify({ tone: 'warn', title: 'Backend offline — 3D mission only', body: 'No video processing or records will be created.' });
      } else notify({ tone: 'crit', title: 'Backend offline', body: `${SOURCE_LABEL[source]} inspections require the FastAPI backend.` });
      return;
    }
    if (!aircraftId) return notify({ tone: 'warn', title: 'Select an aircraft first' });
    if (source === 'upload' && !upload) return notify({ tone: 'warn', title: 'Upload a video first' });
    setBusy(true);
    try {
      if (source === 'simulation') m.reset();
      const insp = await inspectionService.start({
        aircraft_id: aircraftId,
        source,
        camera_uri: source === 'camera' ? cameraUri.trim() : source === 'drone_direct' ? droneIp.trim() || 'auto' : undefined,
        upload_id: source === 'upload' ? upload?.upload_id : undefined,
        record,
      });
      clearLiveDetections();
      setLastSession(null);
      setActive({
        inspection_id: insp.id, aircraft_id: aircraftId, source, detection_mode: insp.detection_mode, detector: '', status: 'active',
        recording: record, frames: 0, detections: 0, elapsed_s: 0, section: 'Unassigned', is_demo: insp.is_demo,
      });
      if (source === 'simulation') m.start();
      else if (operatorSection !== 'Unassigned') inspectionService.setSection(operatorSection).catch(() => undefined);
      notify({ tone: 'ok', title: `Inspection ${insp.id} started`, body: `${SOURCE_LABEL[source]} · ${DETECTION_MODE_LABEL[insp.detection_mode]}` });
    } catch (e) {
      notify({ tone: 'crit', title: 'Could not start inspection', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok?: () => void) => {
    setBusy(true);
    try {
      await fn();
      ok?.();
    } catch (e) {
      notify({ tone: 'crit', title: 'Command failed', body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const pause = () =>
    localOnly ? m.pause() : act(inspectionService.pause, () => (setActive(active && { ...active, status: 'paused' }), simActive && m.pause()));
  const resume = () =>
    localOnly ? m.resume() : act(inspectionService.resume, () => (setActive(active && { ...active, status: 'active' }), simActive && m.resume()));
  const stop = useCallback(() => {
    if (localOnly) {
      m.pause();
      setLocalOnly(false);
      return;
    }
    if (!active) return;
    const id = active.inspection_id;
    act(() => inspectionService.stop(id), () => {
      setLastSession(id);
      setActive(null);
      if (simActive) m.pause();
      notify({ tone: 'info', title: `Inspection ${id} stopped`, body: 'Findings are available for review.' });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, localOnly, simActive]);
  const toggleRec = () =>
    active && act(() => inspectionService.setRecording(!active.recording), () => setActive({ ...active, recording: !active.recording }));

  // auto-stop the session when the 3D inspection loop completes
  useEffect(() => {
    if (simActive && m.snap.status === 'completed') stop();
    if (localOnly && m.snap.status === 'completed') setLocalOnly(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.snap.status]);

  // the session that ended may have come from end-of-video (WS)
  const prevActive = useRef(active);
  useEffect(() => {
    if (prevActive.current && !active) setLastSession(prevActive.current.inspection_id);
    prevActive.current = active;
  }, [active]);

  const streamUrl = active && backendOnline ? `${getApiBase()}/api/video/stream?n=${active.inspection_id}` : null;
  const paused = active ? active.status === 'paused' : localOnly && m.snap.status === 'paused';
  const showSim = effSource === 'simulation';
  const canStart = !running && !busy && (source !== 'upload' || !!upload || !backendOnline) && (!!aircraftId || !backendOnline);

  return (
    <>
      <PageHeader
        eyebrow="Inspection console"
        title="Live Inspection"
        subtitle="Monitor drone footage, run defect detection and review potential defects as they are found."
        actions={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="chip border-line text-ink-2 num">SESSION {active?.inspection_id ?? '—'}</span>
            <span className="chip border-line text-ink-2 num">AIRCRAFT {active?.aircraft_id ?? (aircraftId || '—')}</span>
            {active && <span className="chip border-line text-ink-2">{DETECTION_MODE_LABEL[active.detection_mode]}</span>}
          </div>
        }
      />

      {healthChecked && !backendOnline && (
        <div className="mb-4">
          <Banner tone="warn">
            <b>Backend connection unavailable.</b> Live camera and uploaded-video processing, detection and recording need the FastAPI backend. Simulation can still run the 3D mission
            locally; uploaded files can be previewed locally without processing.
          </Banner>
        </div>
      )}

      <div className={cx('grid gap-4', presentMode ? 'xl:grid-cols-[minmax(0,1fr)_520px]' : 'xl:grid-cols-[minmax(0,1fr)_400px]')}>
        <div className="space-y-4 min-w-0">
          <VideoStage
            streamUrl={streamUrl}
            localVideoUrl={effSource === 'upload' && !streamUrl ? localUrl : null}
            source={effSource}
            recording={!!active?.recording}
            paused={paused}
            elapsed={elapsed}
            inspectionId={active?.inspection_id ?? null}
            aircraftId={active?.aircraft_id ?? (aircraftId || null)}
            connection={streamUrl ? 'connected' : backendOnline ? 'idle' : 'offline'}
            idle={
              <div className="text-center max-w-md">
                <Video className="size-9 text-faint mx-auto mb-3" />
                <div className="font-display font-semibold text-lg">{localOnly ? '3D mission running (local only)' : 'No active inspection'}</div>
                <div className="text-sm text-muted mt-1">
                  {localOnly
                    ? 'The synthetic video feed and detections need the backend. Follow the drone in the 3D mission view below.'
                    : effSource === 'drone_direct'
                      ? 'Connect the laptop Wi-Fi to the drone, press Test drone, then Start Inspection. The video heartbeat starts automatically.'
                      : effSource === 'camera'
                      ? 'Configure the camera source and press Start Inspection.'
                      : effSource === 'upload'
                        ? 'Upload a drone video, then press Start Inspection to process it.'
                        : 'Simulation streams clearly-labelled synthetic footage while the 3D drone flies its inspection loop.'}
                </div>
              </div>
            }
          />

          {/* control bar */}
          <div className={cx('panel p-3 flex flex-wrap items-center gap-2', presentMode && 'dev-only')}>
            {!running ? (
              <button className="btn btn-primary" onClick={start} disabled={!canStart}>
                <Play className="size-4" /> Start Inspection
              </button>
            ) : (
              <button className="btn btn-primary" onClick={stop} disabled={busy}>
                <Square className="size-4" /> Stop Inspection
              </button>
            )}
            <button className="btn" onClick={pause} disabled={!running || paused || busy}>
              <Pause className="size-4" /> Pause
            </button>
            <button className="btn" onClick={resume} disabled={!running || !paused || busy}>
              <Play className="size-4" /> Resume
            </button>
            <div className="w-px h-6 bg-line mx-1 hidden sm:block" />
            <button className={cx('btn', active?.recording && 'border-crimson text-crit-ink')} onClick={toggleRec} disabled={!active || busy} title={!active ? 'Recording requires an active backend session' : undefined}>
              <CircleDot className="size-4" /> {active?.recording ? 'Stop Recording' : 'Start Recording'}
            </button>
            {!running && (
              <label className="flex items-center gap-2 text-xs text-ink-2 ml-1 cursor-pointer">
                <input type="checkbox" checked={record} onChange={(e) => setRecord(e.target.checked)} className="accent-[#7d0a0a]" /> Record from start
              </label>
            )}
            <div className="ml-auto text-xs text-muted">
              {active ? `${active.frames} frames · ${active.detections} detection(s)` : lastSession ? (
                <Link to={`/inspections/${lastSession}`} className="inline-flex items-center gap-1 text-steel-bright hover:underline">
                  <FileText className="size-3.5" /> Review {lastSession} & report
                </Link>
              ) : 'Ready'}
            </div>
          </div>

          {showSim && (
            <Panel title="Autonomous drone mission · 3D simulation" bodyClass="p-0" actions={<Link to="/simulation" className="btn btn-ghost btn-sm">Open full simulator</Link>}>
              <div className="grid lg:grid-cols-[minmax(0,1fr)_300px]">
                <SimulationViewport mission={m.mission} snap={m.snap} opts={{ view: 'free', showPath: true, showLabels: false, showPip: true, fov: 50, lowPower: true, quality: 'low', defects: sessionDetections.map((d) => ({ id: d.id, section: d.section, risk_level: d.risk_level })), visibleSections: m.snap.sectionsVisited }} className={presentMode ? 'h-[460px]' : 'h-[340px]'} />
                <div className="p-4 space-y-4 border-t lg:border-t-0 lg:border-l border-line">
                  {!running && <MissionButtons compact snap={m.snap} onStart={m.start} onPause={m.pause} onResume={m.resume} onReset={m.reset} />}
                  <TelemetryGrid snap={m.snap} />
                </div>
              </div>
              <div className="px-4 py-3 border-t border-line"><SectionChecklist snap={m.snap} /></div>
            </Panel>
          )}
        </div>

        {/* right column */}
        <div className="space-y-4">
          <LiveAIRecord detections={sessionDetections} big={presentMode} />
          <Panel title={running ? 'Session' : 'Inspection setup'} className="dev-only">
            <div className="space-y-4">
              <div>
                <div className="label">Video source</div>
                <Segmented<SourceType> ariaLabel="Video source" value={effSource} onChange={(v) => !running && setSource(v)} options={SOURCE_OPTS} size="sm" />
              </div>
              <div>
                <label className="label flex items-center gap-2" htmlFor="ac">Aircraft</label>
                {aircraft.length ? (
                  <select id="ac" className="field" value={aircraftId} disabled={running} onChange={(e) => setAircraftId(e.target.value)}>
                    {aircraft.map((a) => (
                      <option key={a.id} value={a.id}>{a.id} · {a.registration} · {a.model}</option>
                    ))}
                  </select>
                ) : (
                  <div className="text-xs text-warn-ink rounded-lg border border-warn/40 bg-warn/10 p-2.5">
                    {scope === 'real' ? (
                      <>No registered aircraft. <Link className="underline font-semibold" to="/aircraft?register=1">Register one</Link> to run real inspections.</>
                    ) : 'Fleet unavailable.'}
                  </div>
                )}
              </div>
              {effSource === 'drone_direct' && <DroneSetup ip={droneIp} onIp={setDroneIp} disabled={running} backendOnline={backendOnline} active={active} />}
              {effSource === 'camera' && <CameraSetup uri={cameraUri} onUri={setCameraUri} disabled={running} backendOnline={backendOnline} />}
              {effSource === 'upload' && <UploadSetup info={upload} onInfo={setUpload} onLocalFile={setLocalFile} disabled={running} backendOnline={backendOnline} />}
              {effSource === 'simulation' && (
                <p className="text-xs text-muted leading-relaxed">
                  Synthetic aircraft-skin footage is generated by the backend with painted-in defects; the simulated detector reports them as ground truth. Inspection section follows the 3D drone automatically.
                </p>
              )}
              {effSource !== 'simulation' && (
                <div>
                  <label className="label" htmlFor="sec">Current section (operator)</label>
                  <select
                    id="sec"
                    className="field"
                    value={operatorSection}
                    onChange={(e) => {
                      setOperatorSection(e.target.value);
                      if (active) inspectionService.setSection(e.target.value).catch(() => undefined);
                    }}
                  >
                    {['Unassigned', ...SECTIONS].map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              )}
              <div className="border-t border-line pt-3 space-y-1">
                <ConfidenceSlider />
                <KeyValue k="Backend" v={backendOnline ? 'Connected' : 'Offline'} />
                <KeyValue k="AI model" v={health?.ai_model.status === 'online' ? `${ai?.model ?? 'Loaded'}` : 'Not loaded'} />
                <KeyValue k="AI device" v={ai?.device ? `${ai.device}${ai.half ? ' · FP16' : ''}` : '—'} />
                <KeyValue k="Inference" v={ai?.inference_fps ? `${ai.inference_fps.toFixed(1)} inf/s · ${ai.inference_ms ?? 0} ms` : '—'} mono />
                {(active?.source === 'camera' || active?.source === 'drone_direct') && <KeyValue k={active.source === 'drone_direct' ? 'Drone link' : 'Camera link'} v={active.connected === false ? 'Reconnecting…' : `Connected${active.reconnects ? ` (${active.reconnects} reconnects)` : ''}`} />}
                <KeyValue k="Detection" v={active ? DETECTION_MODE_LABEL[active.detection_mode] : effSource === 'simulation' ? DETECTION_MODE_LABEL.simulated : health?.ai_model.status === 'online' ? DETECTION_MODE_LABEL.ai : DETECTION_MODE_LABEL.none} />
                {active && <KeyValue k="Section" v={active.section} />}
              </div>
            </div>
          </Panel>

          <Panel title="Detections" bodyClass="p-0" className="xl:sticky xl:top-20 dev-only" actions={<span className="text-xs text-muted">potential defects · human review required</span>}>
            <div className="pt-3 max-h-[70vh] flex flex-col">
              <DetectionPanel detections={sessionDetections} mode={active?.detection_mode ?? null} scope={scope} running={!!active && active.status === 'active'} />
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
