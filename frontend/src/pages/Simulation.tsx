import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Info, Video } from 'lucide-react';
import { useMission } from '@/hooks/useMission';
import { SimulationViewport } from '@/components/simulation/SimulationViewport';
import { CaptureStrip, MissionButtons, MissionSettings, SectionChecklist, TelemetryGrid, type Capture, type ViewState } from '@/components/simulation/MissionPanels';
import { PageHeader, Panel } from '@/components/ui/primitives';

export default function SimulationPage() {
  const m = useMission();
  const [view, setView] = useState<ViewState>({ view: 'free', showPath: true, showLabels: true, showPip: true, fov: 50 });
  const captureRef = useRef<(() => string | null) | null>(null);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [flash, setFlash] = useState(0);
  const id = useRef(0);

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
              opts={view}
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
