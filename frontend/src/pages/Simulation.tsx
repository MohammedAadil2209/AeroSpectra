import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Video } from 'lucide-react';
import { useMission } from '@/hooks/useMission';
import { SimulationViewport } from '@/components/simulation/SimulationViewport';
import { CaptureStrip, MissionButtons, MissionSettings, SectionChecklist, TelemetryGrid, type Capture, type ViewState } from '@/components/simulation/MissionPanels';
import { PageHeader, Panel, Segmented } from '@/components/ui/primitives';
import { useApp } from '@/context/AppContext';
import { aircraftService, detectionService } from '@/services/dataService';
import type { Aircraft, Detection } from '@/types';
import { RISK_COLOR, RISK_LABEL, RISK_LEVELS } from '@/utils/labels';

export default function SimulationPage() {
  const m = useMission();
  const [view, setView] = useState<ViewState>({ view: 'free', showPath: true, showLabels: true, showPip: true, fov: 50 });
  const captureRef = useRef<(() => string | null) | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [flash, setFlash] = useState(0);
  const id = useRef(0);
  const { scope, dataVersion } = useApp();
  const [quality, setQuality] = useState<'low' | 'high'>(() => (localStorage.getItem('aerospectra.simQuality') as 'low' | 'high') || 'high');
  const [fleet, setFleet] = useState<Aircraft[]>([]);
  const [aircraftId, setAircraftId] = useState('');
  const [dets, setDets] = useState<Detection[]>([]);
  useEffect(() => {
    aircraftService.list(scope).then((l) => { setFleet(l); setAircraftId((c) => (l.some((a) => a.id === c) ? c : l[0]?.id ?? '')); }).catch(() => setFleet([]));
  }, [scope]);
  useEffect(() => {
    if (!aircraftId) return setDets([]);
    detectionService.list(scope, { aircraft_id: aircraftId }).then(setDets).catch(() => setDets([]));
  }, [aircraftId, scope, dataVersion]);
  const defects = useMemo(
    () => dets.filter((d) => d.review_status !== 'false_positive' && d.maintenance_status !== 'cleared').map((d) => ({ id: d.id, section: d.section, risk_level: d.risk_level })),
    [dets],
  );
  const sceneOpts = useMemo(() => ({ ...view, quality, defects, visibleSections: m.snap.sectionsVisited }), [view, quality, defects, m.snap.sectionsVisited]);
  // live render FPS readout (performance target 50-60 FPS)
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let frames = 0;
    let raf = 0;
    let t0 = performance.now();
    const loop = () => {
      frames++;
      const now = performance.now();
      if (now - t0 >= 1000) {
        setFps(Math.round((frames * 1000) / (now - t0)));
        frames = 0;
        t0 = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const capture = useCallback(() => {
    const url = captureRef.current?.();
    if (!url) return;
    setFlash((f) => f + 1);
    setCaptures((c) => [{ id: ++id.current, dataUrl: url, section: m.snap.section, t: m.snap.elapsed, at: new Date().toISOString() }, ...c].slice(0, 12));
  }, [m.snap.section, m.snap.elapsed]);

  return (
    <>
      <PageHeader
        eyebrow="Autonomous drone inspection · Simulation"
        title="Drone Inspection Simulator"
        subtitle="An interactive 3D simulation of a quadcopter flying an elongated oval route around a stationary passenger aircraft. All telemetry on this page is simulated."
        actions={
          <Link to="/live?source=simulation" className="btn">
            <Video className="size-4" /> Run as inspection session
          </Link>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 min-w-0">
          <div className="panel overflow-hidden">
            <SimulationViewport
              mission={m.mission}
              snap={m.snap}
              opts={sceneOpts}
              captureRef={captureRef}
              flash={flash}
              className="h-[58vh] min-h-[360px] md:min-h-[460px]"
            />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Inspection coverage">
              <SectionChecklist snap={m.snap} />
            </Panel>
            <Panel title="Drone camera">
              <CaptureStrip captures={captures} onCapture={capture} onClear={() => setCaptures([])} canCapture={view.showPip || view.view === 'drone'} />
            </Panel>
          </div>
        </div>

        <div className="space-y-4">
          <Panel title="Mission control">
            <div className="space-y-4">
              <MissionButtons snap={m.snap} onStart={m.start} onPause={m.pause} onResume={m.resume} onReset={m.reset} />
              <TelemetryGrid snap={m.snap} />
            </div>
          </Panel>
          <Panel title="Hangar & defect overlay">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted text-xs">Render quality</span>
                <Segmented<'low' | 'high'>
                  ariaLabel="Render quality"
                  size="sm"
                  value={quality}
                  onChange={(q) => { setQuality(q); localStorage.setItem('aerospectra.simQuality', q); }}
                  options={[{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }]}
                />
              </div>
              <div className="text-[11px] text-muted">Display {fps} FPS · High adds floor reflections, contact shadows and dust.</div>
              <label className="block">
                <span className="label">Aircraft (stored defects)</span>
                <select className="field" value={aircraftId} onChange={(e) => setAircraftId(e.target.value)}>
                  {fleet.map((a) => <option key={a.id} value={a.id}>{a.id} · {a.registration} · {a.model}</option>)}
                </select>
              </label>
              <div className="text-[11px] text-muted">
                {defects.length} open defect(s) on record. Markers appear on the airframe as the drone camera covers each section, coloured by advisory risk:
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {RISK_LEVELS.map((lv) => (
                  <span key={lv} className="flex items-center gap-1"><span className="size-2.5 rounded-full" style={{ background: RISK_COLOR[lv] }} />{RISK_LABEL[lv]}</span>
                ))}
              </div>
            </div>
          </Panel>
          <Panel title="Mission parameters">
            <MissionSettings params={m.params} onParams={m.update} view={view} onView={(v) => setView((s) => ({ ...s, ...v }))} snap={m.snap} />
          </Panel>
          <div className="flex gap-2 text-xs text-muted px-1">
            <Info className="size-4 shrink-0 text-steel" />
            <p>
              Route: start beside the left wing → forward around the nose → down the right side → around the tail → back along the left side. Path is an editable closed CatmullRom
              curve generated from the airframe planform plus the chosen clearance. Drop Blender exports in <code className="num">frontend/public/models/</code> to replace the procedural models.
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
