import type { ReactNode } from 'react';
import { Battery, Camera, CheckCircle2, Circle, Gauge, MapPin, Navigation, Pause, Play, RotateCcw, Timer, TrendingUp } from 'lucide-react';
import type { MissionParams, MissionSnapshot } from '@/services/simulationService';
import { LIMITS } from './simulationConfig';
import type { ViewMode } from './SimulationScene';
import { Segmented, cx } from '@/components/ui/primitives';
import { SECTIONS } from '@/utils/labels';
import { fmtClock } from '@/utils/format';

export const STATUS_TEXT: Record<MissionSnapshot['status'], string> = {
  ready: 'Ready',
  running: 'Running',
  paused: 'Paused — hovering',
  completed: 'Completed',
};
const PHASE_TEXT: Record<MissionSnapshot['phase'], string> = {
  grounded: 'On ground',
  takeoff: 'Take-off',
  survey: 'Inspection survey',
  landing: 'Landing',
};

export function MissionButtons({ snap, onStart, onPause, onResume, onReset, compact }: {
  snap: MissionSnapshot; onStart: () => void; onPause: () => void; onResume: () => void; onReset: () => void; compact?: boolean;
}) {
  const sz = compact ? 'btn-sm' : '';
  return (
    <div className="flex flex-wrap gap-2">
      {snap.status === 'ready' || snap.status === 'completed' ? (
        <button className={cx('btn btn-primary flex-1', sz)} onClick={onStart}>
          <Play className="size-4" /> {snap.status === 'completed' ? 'Restart Mission' : 'Start Mission'}
        </button>
      ) : snap.status === 'running' ? (
        <button className={cx('btn btn-steel flex-1', sz)} onClick={onPause}>
          <Pause className="size-4" /> Pause Mission
        </button>
      ) : (
        <button className={cx('btn btn-primary flex-1', sz)} onClick={onResume}>
          <Play className="size-4" /> Resume Mission
        </button>
      )}
      <button className={cx('btn', sz)} onClick={onReset} disabled={snap.status === 'ready' && snap.elapsed === 0}>
        <RotateCcw className="size-4" /> Reset
      </button>
    </div>
  );
}

function Slider({ label, value, min, max, step, unit, onChange, hint }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; hint?: string;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className="text-ink-2 font-medium">{label}</span>
        <span className="num text-ink">{value.toFixed(step < 1 ? 1 : 0)} {unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[#669bbc]" />
      {hint && <div className="text-[11px] text-faint mt-0.5">{hint}</div>}
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs cursor-pointer py-1">
      <span className="text-ink-2 font-medium">{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 rounded-full border transition-colors', checked ? 'bg-steel border-steel' : 'bg-surface-3 border-line-strong')}
      >
        <span className={cx('absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  );
}

export interface ViewState {
  view: ViewMode;
  showPath: boolean;
  showLabels: boolean;
  showPip: boolean;
  fov: number;
}

export function MissionSettings({ params, onParams, view, onView, snap }: {
  params: MissionParams; onParams: (p: Partial<MissionParams>) => void; view: ViewState; onView: (v: Partial<ViewState>) => void; snap: MissionSnapshot;
}) {
  return (
    <div className="space-y-4">
      <Slider label="Drone speed" value={params.speed} min={LIMITS.speed[0]} max={LIMITS.speed[1]} step={0.5} unit="m/s" onChange={(v) => onParams({ speed: v })} />
      <Slider label="Inspection height" value={params.height} min={LIMITS.height[0]} max={LIMITS.height[1]} step={0.5} unit="m AGL" onChange={(v) => onParams({ height: v })} hint="Path climbs +3 m around the tail to view the fin." />
      <Slider
        label="Inspection clearance"
        value={params.clearance}
        min={LIMITS.clearance[0]}
        max={LIMITS.clearance[1]}
        step={0.5}
        unit="m"
        onChange={(v) => onParams({ clearance: v })}
        hint={`Computed min. horizontal standoff: ${snap.minClearance.toFixed(1)} m · loop ${snap.pathLength.toFixed(0)} m`}
      />
      <Slider label="Camera zoom (FOV)" value={view.fov} min={18} max={75} step={1} unit="°" onChange={(v) => onView({ fov: v })} />
      <div className="border-t border-line pt-3 space-y-1">
        <Toggle label="Flight path visible" checked={view.showPath} onChange={(v) => onView({ showPath: v })} />
        <Toggle label="Waypoint labels" checked={view.showLabels} onChange={(v) => onView({ showLabels: v })} />
        <Toggle label="Drone camera preview" checked={view.showPip} onChange={(v) => onView({ showPip: v })} />
        <Toggle label="Repeat loops" checked={params.repeat} onChange={(v) => onParams({ repeat: v })} />
      </div>
      <div>
        <div className="text-xs text-ink-2 font-medium mb-1.5">Camera view</div>
        <Segmented<ViewMode>
          size="sm"
          ariaLabel="Camera view"
          value={view.view}
          onChange={(v) => onView({ view: v })}
          options={[
            { value: 'free', label: 'Orbit' },
            { value: 'follow', label: 'Follow', title: 'Camera follow mode' },
            { value: 'top', label: 'Top' },
            { value: 'side', label: 'Side' },
            { value: 'drone', label: 'Drone', title: 'Drone camera full view' },
          ]}
        />
      </div>
    </div>
  );
}

function Metric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted font-semibold">
        {icon}
        {label}
      </div>
      <div className="num text-ink text-[15px] mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-faint">{sub}</div>}
    </div>
  );
}

export function TelemetryGrid({ snap }: { snap: MissionSnapshot }) {
  const batt = snap.battery;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="eyebrow">Simulated telemetry</span>
        <span className={cx('chip', snap.status === 'running' ? 'text-ok-ink border-ok/35 bg-ok/10' : snap.status === 'paused' ? 'text-warn-ink border-warn/35 bg-warn/10' : 'text-ink-2 border-line bg-ink/5')}>
          {STATUS_TEXT[snap.status]}
        </span>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-muted">Mission progress</span>
          <span className="num text-ink">{(snap.progress * 100).toFixed(0)}%{snap.loops > 0 && ` · loop ${snap.loops + (snap.status === 'completed' ? 0 : 1)}`}</span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-3 overflow-hidden" role="progressbar" aria-valuenow={Math.round(snap.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-steel transition-[width] duration-100" style={{ width: `${snap.progress * 100}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Metric icon={<MapPin className="size-3" />} label="Section" value={<span className="font-sans text-[13px]">{snap.section}</span>} />
        <Metric icon={<Navigation className="size-3" />} label="Phase" value={<span className="font-sans text-[13px]">{PHASE_TEXT[snap.phase]}</span>} />
        <Metric icon={<Timer className="size-3" />} label="Elapsed" value={fmtClock(snap.elapsed)} />
        <Metric icon={<Battery className="size-3" />} label="Battery (sim)" value={<span className={batt < 30 ? 'text-warn' : ''}>{batt.toFixed(0)}%</span>} />
        <Metric icon={<TrendingUp className="size-3" />} label="Altitude (sim)" value={`${snap.altitude.toFixed(1)} m`} />
        <Metric icon={<Gauge className="size-3" />} label="Velocity (sim)" value={`${snap.velocity.toFixed(1)} m/s`} sub={`HDG ${snap.heading.toFixed(0).padStart(3, '0')}°`} />
      </div>
      <div className="rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-xs">
        <div className="text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">Drone position (sim, m)</div>
        <div className="num text-ink-2 flex gap-3">
          <span>X {snap.position.x.toFixed(1)}</span>
          <span>Y {snap.position.y.toFixed(1)}</span>
          <span>Z {snap.position.z.toFixed(1)}</span>
          <span className="text-faint ml-auto">{snap.distance.toFixed(0)} m flown</span>
        </div>
      </div>
      {snap.completionReason && <div className="text-xs text-steel-bright">{snap.completionReason}</div>}
    </div>
  );
}

export function SectionChecklist({ snap }: { snap: MissionSnapshot }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">Inspection waypoints</span>
        <span className="text-xs num text-muted">{snap.sectionsVisited.length}/{SECTIONS.length}</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {SECTIONS.map((s) => {
          const done = snap.sectionsVisited.includes(s);
          const cur = snap.section === s && snap.status !== 'ready';
          return (
            <li key={s} className={cx('flex items-center gap-1.5 text-xs', cur ? 'text-ink font-semibold' : done ? 'text-ink-2' : 'text-faint')}>
              {done ? <CheckCircle2 className={cx('size-3.5', cur ? 'text-crit' : 'text-ok')} /> : <Circle className="size-3.5" />}
              {s}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-faint mt-2">Simulated waypoints along the route, not proof of physical coverage.</p>
    </div>
  );
}

export interface Capture {
  id: number;
  dataUrl: string;
  section: string;
  t: number;
  at: string;
}

export function CaptureStrip({ captures, onCapture, onClear, canCapture }: { captures: Capture[]; onCapture: () => void; onClear: () => void; canCapture: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <span className="eyebrow">Image capture (simulated)</span>
        <div className="flex gap-1.5">
          {captures.length > 0 && <button className="btn btn-ghost btn-sm" onClick={onClear}>Clear</button>}
          <button className="btn btn-sm" onClick={onCapture} disabled={!canCapture} title={canCapture ? 'Capture drone camera frame' : 'Enable the drone camera preview or Drone view'}>
            <Camera className="size-3.5" /> Capture
          </button>
        </div>
      </div>
      {captures.length === 0 ? (
        <div className="text-xs text-faint">No captures yet. Frames are rendered from the simulated gimbal camera.</div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {captures.map((c) => (
            <a key={c.id} href={c.dataUrl} download={`aerospectra-sim-capture-${c.id}.jpg`} className="shrink-0 w-32 group" title="Download capture">
              <div className="relative">
                <img src={c.dataUrl} alt={`Simulated capture ${c.section}`} className="w-32 aspect-video object-cover rounded border border-line group-hover:border-steel" />
                <span className="absolute left-1 top-1 rounded-sm bg-crimson px-1 text-[8px] font-bold text-white">SIM</span>
              </div>
              <div className="text-[10px] text-ink-2 mt-0.5 truncate">{c.section}</div>
              <div className="text-[10px] text-faint num">T+{fmtClock(c.t)}</div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
