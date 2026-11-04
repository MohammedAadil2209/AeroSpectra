import { Component, useEffect, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import { AlertTriangle, Maximize2, Minimize2 } from 'lucide-react';
import type { MissionController, MissionSnapshot } from '@/services/simulationService';
import { SimulationScene, pipRect, type SceneOptions } from './SimulationScene';
import type { ModelSource } from './ModelAssets';
import { fmtClock } from '@/utils/format';
import { cx } from '@/components/ui/primitives';

class SceneBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    if (this.state.error)
      return (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <AlertTriangle className="size-6 text-warn mx-auto mb-2" />
            <div className="font-semibold">3D view unavailable</div>
            <div className="text-sm text-muted mt-1 max-w-sm">WebGL could not start in this browser ({this.state.error}). Enable hardware acceleration and reload.</div>
          </div>
        </div>
      );
    return this.props.children;
  }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Canvas + HTML overlays (simulation label, drone-camera HUD aligned to the PIP viewport). */
export function SimulationViewport({ mission, snap, opts, captureRef, className, flash }: {
  mission: MissionController;
  snap: MissionSnapshot;
  opts: SceneOptions;
  captureRef?: MutableRefObject<(() => string | null) | null>;
  className?: string;
  flash?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [aircraftSrc, setAircraftSrc] = useState<ModelSource>('checking');
  const [fs, setFs] = useState(false);
  const [flashOn, setFlashOn] = useState(false);
  const [gl] = useState(webglAvailable);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const on = () => setFs(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  useEffect(() => {
    if (!flash) return;
    setFlashOn(true);
    const t = setTimeout(() => setFlashOn(false), 180);
    return () => clearTimeout(t);
  }, [flash]);

  const r = pipRect(size.w, size.h);
  const zoom = (60 / opts.fov).toFixed(1);
  const droneMain = opts.view === 'drone';

  const hud = (full: boolean) => (
    <div className="absolute inset-0 pointer-events-none text-[10px] font-mono text-cream">
      <div className="absolute left-2 top-1.5 flex items-center gap-1.5">
        <span className="rounded-sm bg-crimson px-1 font-bold text-white">SIMULATED</span>
        <span className="bg-black/40 px-1 rounded-sm">DRONE CAM</span>
      </div>
      <div className="absolute right-2 top-1.5 bg-black/40 px-1 rounded-sm">{zoom}×</div>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        <div className={cx('border border-cream/70', full ? 'size-16' : 'size-7')} />
      </div>
      <div className="absolute left-2 bottom-1.5 bg-black/40 px-1 rounded-sm max-w-[55%] truncate">{snap.section.toUpperCase()}</div>
      {full ? (
        <div className="absolute right-2 bottom-1.5 bg-black/40 px-1 rounded-sm">
          PAN {snap.gimbalPan >= 0 ? '+' : ''}{snap.gimbalPan.toFixed(0)}° TILT {snap.gimbalTilt.toFixed(0)}° · FOV {opts.fov.toFixed(0)}° · T+{fmtClock(snap.elapsed)}
        </div>
      ) : (
        <div className="absolute right-2 bottom-1.5 bg-black/40 px-1 rounded-sm">T+{fmtClock(snap.elapsed)}</div>
      )}
    </div>
  );

  return (
    <div ref={box} className={cx('theme-dark relative overflow-hidden bg-[#071e2a]', className)}>
      {gl ? (
        <SceneBoundary>
          <SimulationScene mission={mission} opts={opts} captureRef={captureRef} onAircraftSource={setAircraftSrc} />
        </SceneBoundary>
      ) : (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted">WebGL is not available in this browser.</div>
      )}

      {/* scene labels */}
      <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 pointer-events-none">
        <span className="chip bg-abyss/80 border-cream/30 text-cream uppercase tracking-wider">3D Simulation · not real flight</span>
        <span className="chip bg-abyss/80 border-line text-muted">
          Aircraft model: {aircraftSrc === 'glb' ? 'Blender GLB' : aircraftSrc === 'checking' ? '…' : 'procedural'}
        </span>
      </div>
      <button
        className="absolute right-3 top-3 btn btn-sm bg-abyss/80"
        onClick={() => (document.fullscreenElement ? document.exitFullscreen() : box.current?.requestFullscreen())}
        aria-label={fs ? 'Exit full screen' : 'Full screen'}
      >
        {fs ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
      </button>

      {droneMain && hud(true)}
      {opts.showPip && size.w > 0 && (
        <div className="absolute rounded-sm border border-steel/60 shadow-lg shadow-black/40 pointer-events-none" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
          {droneMain ? (
            <div className="absolute left-1.5 top-1 text-[10px] font-semibold text-cream bg-black/40 px-1 rounded-sm">OVERVIEW</div>
          ) : (
            hud(false)
          )}
          {flashOn && !droneMain && <div className="absolute inset-0 bg-white/70" />}
        </div>
      )}
      {flashOn && droneMain && <div className="absolute inset-0 bg-white/50 pointer-events-none" />}
    </div>
  );
}
