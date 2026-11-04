/**
 * MissionController — rendering-independent autonomous-inspection mission logic.
 *
 * - Builds an elongated oval (ellipse sampled into an editable closed CatmullRomCurve3)
 *   whose semi-axes guarantee the requested minimum clearance around the planform.
 * - Advances the drone along the curve by arc length at the requested speed.
 * - Phases: grounded → takeoff → survey → landing → grounded. Pause holds position (hover).
 * - Produces SIMULATED telemetry. Nothing here represents real flight data.
 */
import * as THREE from 'three';
import { AIRCRAFT, AIRFRAME_SKELETON, LIMITS, MISSION_DEFAULTS, PLANFORM_POINTS, SECTION_RANGES } from '@/components/simulation/simulationConfig';

export type MissionStatus = 'ready' | 'running' | 'paused' | 'completed';
export type MissionPhase = 'grounded' | 'takeoff' | 'survey' | 'landing';

export interface MissionParams {
  speed: number;
  clearance: number;
  height: number;
  repeat: boolean;
}

export interface MissionSnapshot {
  status: MissionStatus;
  phase: MissionPhase;
  progress: number; // 0..1 of current loop
  loops: number;
  elapsed: number;
  battery: number;
  altitude: number;
  velocity: number;
  heading: number; // deg, 0 = toward nose (+X), clockwise seen from above
  position: { x: number; y: number; z: number };
  section: string;
  sectionsVisited: string[];
  distance: number;
  gimbalPan: number; // deg relative to drone nose, + = right
  gimbalTilt: number; // deg, - = looking down
  pathLength: number;
  minClearance: number;
  completionReason: string | null;
  pathVersion: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const smooth = (t: number) => t * t * (3 - 2 * t);

export function sectionAt(u: number): string {
  const x = ((u % 1) + 1) % 1;
  return SECTION_RANGES.find((r) => x >= r.from && x < r.to)?.section ?? 'Left Wing';
}

export class MissionController {
  params: MissionParams = { ...MISSION_DEFAULTS };
  curve!: THREE.CatmullRomCurve3;
  pathLength = 0;
  minClearance = 0;
  pathVersion = 0;

  status: MissionStatus = 'ready';
  phase: MissionPhase = 'grounded';
  u = 0;
  loops = 0;
  elapsed = 0;
  battery = 100;
  distance = 0;
  velocity = 0;
  completionReason: string | null = null;
  visited = new Set<string>();

  /** Pose consumed by the renderer */
  readonly position = new THREE.Vector3();
  readonly tangent = new THREE.Vector3(1, 0, 0);
  readonly lookTarget = new THREE.Vector3();
  yaw = 0;
  bank = 0;
  pitch = 0;
  private altitude = 0.0;
  private lastPos = new THREE.Vector3();
  private listeners = new Set<() => void>();

  constructor(params?: Partial<MissionParams>) {
    Object.assign(this.params, params);
    this.buildPath();
    this.placeAtStart();
  }

  // ------------------------------------------------------------ path
  /** Semi-axes chosen so the ellipse clears nose/tail, wing tips and stabiliser tips by `clearance`. */
  private axes(clearance: number) {
    const cx = (AIRCRAFT.noseX + AIRCRAFT.tailX) / 2;
    const a = (AIRCRAFT.noseX - AIRCRAFT.tailX) / 2 + clearance;
    const need = (pt: { x: number; z: number }) => (pt.z + clearance) / Math.sqrt(Math.max(0.05, 1 - ((pt.x - cx) / a) ** 2));
    const b = Math.max(need(AIRCRAFT.wingTip), need(AIRCRAFT.stabTip), AIRCRAFT.fuselageRadius + clearance);
    return { cx, a, b };
  }

  buildPath() {
    const want = this.params.clearance;
    let { cx, a, b } = this.axes(want);
    // Grow the oval until the true (normal-direction) clearance meets the requested value.
    for (let iter = 0; iter < 30; iter++) {
      this.curve = this.makeCurve(cx, a, b);
      this.minClearance = this.computeMinClearance();
      if (this.minClearance >= want - 0.05) break;
      const grow = Math.max(0.15, (want - this.minClearance) * 0.8);
      a += grow;
      b += grow;
    }
    this.curve.arcLengthDivisions = 600;
    this.curve.updateArcLengths();
    this.pathLength = this.curve.getLength();
    this.pathVersion++;
  }

  private makeCurve(cx: number, a: number, b: number) {
    const n = MISSION_DEFAULTS.pathSamples;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const u = i / n;
      // θ = -90° at u=0 → beside the LEFT wing (z<0); increasing θ heads to the nose (+X) first
      const th = -Math.PI / 2 + u * Math.PI * 2;
      const tailness = Math.max(0, -Math.cos(th)); // 1 at the tail
      const y = this.params.height + MISSION_DEFAULTS.tailClimb * smooth(tailness ** 3);
      pts.push(new THREE.Vector3(cx + a * Math.cos(th), y, b * Math.sin(th)));
    }
    return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
  }

  private computeMinClearance() {
    let best = Infinity;
    const pts = this.curve.getSpacedPoints(400);
    for (const p of pts) for (const [x, z] of PLANFORM_POINTS) best = Math.min(best, Math.hypot(p.x - x, p.z - z));
    return best;
  }

  // ------------------------------------------------------------ controls
  start() {
    if (this.status === 'running') return;
    if (this.status === 'completed') this.reset();
    if (this.status === 'paused') return this.resume();
    this.status = 'running';
    this.phase = this.altitude > this.surveyAltitudeAt(this.u) - 0.05 ? 'survey' : 'takeoff';
    this.emit();
  }
  pause() {
    if (this.status !== 'running') return;
    this.status = 'paused';
    this.emit();
  }
  resume() {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.emit();
  }
  reset() {
    this.status = 'ready';
    this.phase = 'grounded';
    this.u = 0;
    this.loops = 0;
    this.elapsed = 0;
    this.battery = 100;
    this.distance = 0;
    this.velocity = 0;
    this.completionReason = null;
    this.visited.clear();
    this.placeAtStart();
    this.emit();
  }
  setParams(p: Partial<MissionParams>) {
    const prev = { ...this.params };
    Object.assign(this.params, p);
    this.params.speed = clamp(this.params.speed, ...LIMITS.speed);
    this.params.clearance = clamp(this.params.clearance, ...LIMITS.clearance);
    this.params.height = clamp(this.params.height, ...LIMITS.height);
    if (prev.clearance !== this.params.clearance || prev.height !== this.params.height) {
      this.buildPath();
      if (this.phase === 'grounded') this.placeAtStart();
    }
    this.emit();
  }
  onChange(fn: () => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  private surveyAltitudeAt(u: number) {
    return this.curve.getPointAt(((u % 1) + 1) % 1).y;
  }

  private placeAtStart() {
    const p = this.curve.getPointAt(0);
    this.altitude = 0.0;
    this.position.set(p.x, 0.0, p.z);
    this.lastPos.copy(this.position);
    this.curve.getTangentAt(0, this.tangent);
    this.yaw = Math.atan2(-this.tangent.z, this.tangent.x);
    this.bank = 0;
    this.pitch = 0;
    this.updateLookTarget(true);
  }

  // ------------------------------------------------------------ simulation step
  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 0.1);
    const running = this.status === 'running';
    if (running) {
      this.elapsed += dt;
      this.battery = Math.max(0, this.battery - dt * (0.06 + 0.035 * this.params.speed));
    }
    const u0 = ((this.u % 1) + 1) % 1;
    const onPath = this.curve.getPointAt(u0);

    if (running && this.phase === 'takeoff') {
      this.altitude = Math.min(onPath.y, this.altitude + MISSION_DEFAULTS.takeoffRate * dt);
      if (this.altitude >= onPath.y - 1e-3) this.phase = 'survey';
    } else if (running && this.phase === 'survey') {
      const du = (this.params.speed * dt) / this.pathLength;
      this.u += du;
      this.distance += this.params.speed * dt;
      if (this.u >= this.loops + 1) {
        this.loops++;
        if (!this.params.repeat) {
          this.u = this.loops; // exactly at start
          this.phase = 'landing';
        }
      }
      if (this.battery <= MISSION_DEFAULTS.batteryReturnPct && this.phase === 'survey') {
        this.phase = 'landing';
        this.completionReason = 'Simulated low battery — mission ended, drone landed in place.';
      }
      this.altitude = this.curve.getPointAt(((this.u % 1) + 1) % 1).y;
    } else if (running && this.phase === 'landing') {
      this.altitude = Math.max(0, this.altitude - MISSION_DEFAULTS.takeoffRate * dt);
      if (this.altitude <= 0) {
        this.phase = 'grounded';
        this.status = 'completed';
        this.completionReason ??= this.loops > 0 ? 'Inspection loop complete — drone returned to start position.' : 'Mission ended.';
        this.emit();
      }
    }

    const uNow = ((this.u % 1) + 1) % 1;
    const p = this.curve.getPointAt(uNow);
    // Smooth toward target pose to avoid jumps when the path is edited mid-flight
    const target = new THREE.Vector3(p.x, this.altitude, p.z);
    const k = 1 - Math.exp(-dt * 12);
    this.position.lerp(target, this.phase === 'grounded' && this.status === 'ready' ? 1 : k);

    this.curve.getTangentAt(uNow, this.tangent);
    const targetYaw = Math.atan2(-this.tangent.z, this.tangent.x);
    let dy = targetYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * (1 - Math.exp(-dt * 6));

    const moving = running && this.phase === 'survey';
    // Route turns to starboard continuously (aircraft on the right): roll right, pitch nose-down with speed
    this.bank += ((moving ? 0.12 * (this.params.speed / 4) : 0) - this.bank) * (1 - Math.exp(-dt * 3));
    this.pitch += ((moving ? -0.05 - 0.02 * this.params.speed : 0) - this.pitch) * (1 - Math.exp(-dt * 3));

    this.velocity = dt > 0 ? this.position.distanceTo(this.lastPos) / dt : 0;
    this.lastPos.copy(this.position);
    if (this.phase !== 'grounded' && this.phase !== 'takeoff') this.visited.add(sectionAt(uNow));
    this.updateLookTarget(false, dt);
  }

  private _tmp = new THREE.Vector3();
  private _seg = new THREE.Line3();
  private updateLookTarget(snap: boolean, dt = 0.016) {
    let best = Infinity;
    const out = this._tmp;
    const target = new THREE.Vector3();
    for (const [x0, y0, z0, x1, y1, z1] of AIRFRAME_SKELETON) {
      this._seg.set(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
      this._seg.closestPointToPoint(this.position, true, out);
      const d = out.distanceToSquared(this.position);
      if (d < best) {
        best = d;
        target.copy(out);
      }
    }
    if (snap) this.lookTarget.copy(target);
    else this.lookTarget.lerp(target, 1 - Math.exp(-dt * 2.5));
  }

  get airborne() {
    return this.phase !== 'grounded';
  }

  snapshot(): MissionSnapshot {
    const uNow = ((this.u % 1) + 1) % 1;
    const done = this.status === 'completed' && this.loops > 0 && !this.params.repeat;
    // heading: 0° toward nose (+X), 90° toward right wing (+Z)
    const heading = ((Math.atan2(this.tangent.z, this.tangent.x) * 180) / Math.PI + 360) % 360;
    const d = this.lookTarget.clone().sub(this.position);
    const worldYaw = Math.atan2(-d.z, d.x);
    let pan = ((this.yaw - worldYaw) * 180) / Math.PI;
    while (pan > 180) pan -= 360;
    while (pan < -180) pan += 360;
    const tilt = (Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI;
    return {
      status: this.status,
      phase: this.phase,
      progress: done ? 1 : this.phase === 'landing' && this.loops > 0 && !this.params.repeat ? 1 : uNow,
      loops: this.loops,
      elapsed: this.elapsed,
      battery: this.battery,
      altitude: this.position.y,
      velocity: this.velocity,
      heading,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      section: this.phase === 'grounded' && this.status === 'ready' ? 'Pre-flight (start point)' : sectionAt(uNow),
      sectionsVisited: [...this.visited],
      distance: this.distance,
      gimbalPan: pan,
      gimbalTilt: tilt,
      pathLength: this.pathLength,
      minClearance: this.minClearance,
      completionReason: this.completionReason,
      pathVersion: this.pathVersion,
    };
  }
}
