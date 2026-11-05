/**
 * 3D inspection scene (React Three Fiber).
 * - Stationary aircraft (GLB if exported, else procedural)
 * - Drone rig: ONE group moved along the mission path; all parts are children, so they move together
 * - Visible elongated-oval flight path (CatmullRomCurve3) + section waypoints
 * - Drone-mounted gimbal camera rendered as picture-in-picture (or full view)
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { MissionController } from '@/services/simulationService';
import { ProceduralAircraft } from './ProceduralAircraft';
import { ProceduralDrone } from './ProceduralDrone';
import { HangarEnvironment } from './HangarEnvironment';
import { DefectMarkers, type MarkerDefect } from './DefectMarkers';
import { AircraftModel, GltfDrone, ModelErrorBoundary, useModelAvailable, type ModelSource } from './ModelAssets';
import { MODELS, SECTION_RANGES } from './simulationConfig';

export type ViewMode = 'free' | 'follow' | 'top' | 'side' | 'drone';

const LAYER_PATH = 1;
const LAYER_DRONE = 2;
const DRONE_SCALE = 2.0; // enlarged for visibility (as in the Blender scene)

export interface SceneOptions {
  view: ViewMode;
  showPath: boolean;
  showLabels: boolean;
  showPip: boolean;
  fov: number;
  lowPower?: boolean;
  /** Low / High render quality (reflections, contact shadows, dust). Defaults from lowPower. */
  quality?: 'low' | 'high';
  /** Stored defects of the selected aircraft (shown once their section has been seen by the drone camera). */
  defects?: MarkerDefect[];
  visibleSections?: string[];
}

/** PIP geometry in CSS px — shared with the HTML overlay so they line up exactly. */
export function pipRect(width: number, height: number) {
  const w = Math.round(Math.min(Math.max(width * (width < 640 ? 0.46 : 0.34), Math.min(300, width * 0.6)), 460));
  const h = Math.round((w * 9) / 16);
  return { x: width - w - 12, y: Math.min(width < 640 ? 84 : 56, Math.max(12, height - h - 12)), w, h };
}

// ------------------------------------------------------------------ drone rig
function DroneRig({ mission, droneCam, fov }: { mission: MissionController; droneCam: THREE.PerspectiveCamera; fov: number }) {
  const rig = useRef<THREE.Group>(null);
  const procProps = useRef<THREE.Group[]>([]);
  const procGimbal = useRef<THREE.Group | null>(null);
  const camMount = useRef<THREE.Group>(null);
  const glbProps = useRef<THREE.Object3D[]>([]);
  const glbAvail = useModelAvailable(MODELS.droneUrl);
  const [glbFailed, setGlbFailed] = useState(false);
  const useGlb = glbAvail === 'glb' && !glbFailed;

  useEffect(() => {
    const mount = camMount.current;
    if (!mount) return;
    droneCam.rotation.set(0, Math.PI, 0); // camera looks down -Z; mount's +Z faces the target
    droneCam.position.set(0, 0, 0.06);
    mount.add(droneCam);
    return () => void mount.remove(droneCam);
  }, [droneCam]);

  // drone geometry on its own layer so the drone camera never sees its own airframe
  useEffect(() => {
    const t = setTimeout(() => rig.current?.traverse((o) => {
      if (!(o as THREE.Camera).isCamera) o.layers.set(LAYER_DRONE);
    }), 50);
    return () => clearTimeout(t);
  }, [useGlb]);

  useFrame((_, dt) => {
    mission.update(dt);
    const g = rig.current;
    if (!g) return;
    g.position.copy(mission.position);
    g.position.y += 0.3 * DRONE_SCALE; // skids rest on the ground at altitude 0
    g.rotation.set(mission.bank, mission.yaw, mission.pitch, 'YZX');

    // gimbal + camera mount aim at the closest airframe point
    camMount.current?.lookAt(mission.lookTarget);
    procGimbal.current?.lookAt(mission.lookTarget);

    const spin = mission.airborne ? 42 : 0;
    procProps.current.forEach((p) => p && (p.rotation.y += (p.userData.dir ?? 1) * spin * dt));
    glbProps.current.forEach((p, i) => (p.rotation.y += (i % 2 ? -1 : 1) * spin * dt));

    if (droneCam.fov !== fov) {
      droneCam.fov = fov;
      droneCam.updateProjectionMatrix();
    }
  });

  const procedural = <ProceduralDrone props={procProps} gimbal={procGimbal} />;
  return (
    <group ref={rig} name="drone-rig">
      <group scale={DRONE_SCALE}>
        {useGlb ? (
          <ModelErrorBoundary fallback={procedural} onError={() => setGlbFailed(true)}>
            <GltfDrone onProps={(p) => (glbProps.current = p)} />
          </ModelErrorBoundary>
        ) : (
          procedural
        )}
        <group ref={camMount} position={[0.26, -0.15, 0]} />
      </group>
      {/* downward position marker light */}
      <pointLight position={[0, -0.4, 0]} intensity={0.6} distance={4} color="#9fc0d6" />
    </group>
  );
}

// ------------------------------------------------------------------ labels (canvas sprites: depth-aware, no DOM)
function makeLabel(text: string, bg: string, fg: string) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d')!;
  const font = '700 44px Lato, system-ui, sans-serif';
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 40;
  c.width = w;
  c.height = 72;
  g.font = font;
  g.fillStyle = bg;
  g.beginPath();
  g.roundRect(0, 0, w, 72, 12);
  g.fill();
  g.fillStyle = fg;
  g.textBaseline = 'middle';
  g.fillText(text, 20, 38);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: w / 72 };
}

function Label({ text, position, bg = 'rgba(0,19,30,0.82)', fg = '#fcf4db', height = 1.5 }: { text: string; position: [number, number, number]; bg?: string; fg?: string; height?: number }) {
  const { tex, aspect } = useMemo(() => makeLabel(text, bg, fg), [text, bg, fg]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <sprite position={position} scale={[height * aspect, height, 1]} ref={(o) => o?.layers.set(LAYER_PATH)} renderOrder={10}>
      <spriteMaterial map={tex} transparent depthWrite={false} />
    </sprite>
  );
}

// ------------------------------------------------------------------ path
function FlightPath({ mission, visible, labels }: { mission: MissionController; visible: boolean; labels: boolean }) {
  const [version, setVersion] = useState(mission.pathVersion);
  useEffect(() => mission.onChange(() => setVersion(mission.pathVersion)), [mission]);
  const data = useMemo(() => {
    const pts = mission.curve.getSpacedPoints(360);
    const ground = pts.map((p) => new THREE.Vector3(p.x, 0.03, p.z));
    const seen = new Set<string>();
    const marks = SECTION_RANGES.filter((r) => (seen.has(r.section) ? false : (seen.add(r.section), true))).map((r) => {
      const p = mission.curve.getPointAt((r.from + r.to) / 2);
      return { section: r.section, pos: [p.x, p.y + 1.4, p.z] as [number, number, number] };
    });
    const start = mission.curve.getPointAt(0);
    return { pts, ground, marks, start };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission, version]);

  const setLayer = (o: THREE.Object3D | null) => o?.layers.set(LAYER_PATH);
  if (!visible) return null;
  return (
    <group>
      <Line ref={setLayer as never} points={data.pts} color="#5c839e" lineWidth={2.2} transparent opacity={0.95} />
      <Line ref={setLayer as never} points={data.ground} color="#5c839e" lineWidth={1} dashed dashSize={0.8} gapSize={0.6} transparent opacity={0.35} />
      <mesh ref={setLayer} rotation={[-Math.PI / 2, 0, 0]} position={[data.start.x, 0.03, data.start.z]}>
        <ringGeometry args={[1.0, 1.25, 40]} />
        <meshBasicMaterial color="#fcf4db" transparent opacity={0.8} />
      </mesh>
      {data.marks.map((m) => (
        <group key={m.section} position={m.pos}>
          <mesh ref={setLayer}>
            <sphereGeometry args={[0.16, 12, 12]} />
            <meshBasicMaterial color="#fcf4db" />
          </mesh>
          {labels && <Label text={m.section} position={[0, 1.1, 0]} />}
        </group>
      ))}
      {labels && <Label text="START / HOME" position={[data.start.x, 2.6, data.start.z]} bg="#c1121f" fg="#ffffff" />}
    </group>
  );
}

// ------------------------------------------------------------------ cameras + rendering
const PRESETS: Record<Exclude<ViewMode, 'follow' | 'drone'>, { pos: [number, number, number]; target: [number, number, number] }> = {
  free: { pos: [30, 15, -36], target: [0, 3, 0] },
  top: { pos: [0, 82, 0.01], target: [0, 0, 0] },
  side: { pos: [2, 8, -42], target: [0, 4, 0] },
};

function CameraDirector({ mission, view, controls }: { mission: MissionController; view: ViewMode; controls: MutableRefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree();
  const anim = useRef<{ t: number; from: THREE.Vector3; to: THREE.Vector3; tf: THREE.Vector3; tt: THREE.Vector3 } | null>(null);

  useEffect(() => {
    camera.layers.enable(LAYER_PATH);
    camera.layers.enable(LAYER_DRONE);
  }, [camera]);

  useEffect(() => {
    if (view === 'follow' || view === 'drone') return;
    const p = PRESETS[view];
    const c = controls.current;
    anim.current = {
      t: 0,
      from: camera.position.clone(),
      to: new THREE.Vector3(...p.pos),
      tf: c ? c.target.clone() : new THREE.Vector3(),
      tt: new THREE.Vector3(...p.target),
    };
  }, [view, camera, controls]);

  const behind = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const c = controls.current;
    if (view === 'follow') {
      // chase cam: behind and above the drone, offset outward from the aircraft
      const t = mission.tangent;
      behind.set(mission.position.x - t.x * 9, mission.position.y + 4.5, mission.position.z - t.z * 9);
      const out = new THREE.Vector3(mission.position.x, 0, mission.position.z).normalize().multiplyScalar(5);
      behind.add(out);
      camera.position.lerp(behind, 1 - Math.exp(-dt * 3));
      if (c) {
        c.target.lerp(mission.position, 1 - Math.exp(-dt * 6));
        c.update();
      } else camera.lookAt(mission.position);
      return;
    }
    const a = anim.current;
    if (a && c) {
      a.t = Math.min(1, a.t + dt / 0.9);
      const e = 1 - Math.pow(1 - a.t, 3);
      camera.position.lerpVectors(a.from, a.to, e);
      c.target.lerpVectors(a.tf, a.tt, e);
      c.update();
      if (a.t >= 1) anim.current = null;
    }
  });
  return null;
}

function Renderer({ droneCam, opts, captureRef }: { droneCam: THREE.PerspectiveCamera; opts: SceneOptions; captureRef?: MutableRefObject<(() => string | null) | null> }) {
  const { gl, scene, camera, size } = useThree();
  useFrame(() => {
    const main = opts.view === 'drone' ? droneCam : camera;
    const second = opts.view === 'drone' ? camera : droneCam;
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    if (main === droneCam) {
      droneCam.aspect = size.width / size.height;
      droneCam.updateProjectionMatrix();
    }
    gl.render(scene, main);
    if (opts.showPip) {
      const r = pipRect(size.width, size.height);
      const glY = size.height - r.y - r.h;
      gl.setScissorTest(true);
      gl.setScissor(r.x, glY, r.w, r.h);
      gl.setViewport(r.x, glY, r.w, r.h);
      if (second === droneCam) {
        droneCam.aspect = r.w / r.h;
        droneCam.updateProjectionMatrix();
      } else {
        (camera as THREE.PerspectiveCamera).aspect = r.w / r.h;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
      gl.render(scene, second);
      gl.setScissorTest(false);
      if (second === camera) {
        (camera as THREE.PerspectiveCamera).aspect = size.width / size.height;
        (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
      }
    }
  }, 1);

  useEffect(() => {
    if (!captureRef) return;
    captureRef.current = () => {
      const src = gl.domElement;
      const dpr = gl.getPixelRatio();
      const full = opts.view === 'drone' || !opts.showPip;
      const r = full ? { x: 0, y: 0, w: size.width, h: size.height } : pipRect(size.width, size.height);
      const out = document.createElement('canvas');
      out.width = Math.round(r.w * dpr);
      out.height = Math.round(r.h * dpr);
      const g = out.getContext('2d');
      if (!g) return null;
      g.drawImage(src, r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr, 0, 0, out.width, out.height);
      return out.toDataURL('image/jpeg', 0.86);
    };
    return () => {
      captureRef.current = null;
    };
  }, [gl, size, opts.view, opts.showPip, captureRef]);
  return null;
}

// ------------------------------------------------------------------ public component
export function SimulationScene({ mission, opts, captureRef, onAircraftSource }: {
  mission: MissionController;
  opts: SceneOptions;
  captureRef?: MutableRefObject<(() => string | null) | null>;
  onAircraftSource?: (s: ModelSource) => void;
}) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  const droneCam = useMemo(() => {
    const c = new THREE.PerspectiveCamera(opts.fov, 16 / 9, 0.3, 300);
    c.layers.set(0); // sees scene only — not the path overlay nor the drone itself
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Canvas
      shadows
      dpr={opts.lowPower || opts.quality === 'low' ? [1, 1.25] : [1, 1.5]}
      gl={{ preserveDrawingBuffer: true, antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 42, position: PRESETS.free.pos, near: 0.1, far: 500 }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
      }}
    >
      <color attach="background" args={['#1d252a']} />
      {/* light hangar haze */}
      <fog attach="fog" args={['#6f7b82', 55, 230]} />
      <HangarEnvironment lowPower={opts.lowPower} quality={opts.quality} hideRoof={opts.view === 'top'} />
      {opts.defects && opts.defects.length > 0 && <DefectMarkers defects={opts.defects} visibleSections={opts.visibleSections ?? []} />}
      <AircraftModel procedural={<ProceduralAircraft />} onSource={onAircraftSource} />
      <DroneRig mission={mission} droneCam={droneCam} fov={opts.fov} />
      <FlightPath mission={mission} visible={opts.showPath} labels={opts.showLabels && opts.view !== 'drone'} />
      <OrbitControls
        ref={controls as never}
        makeDefault
        enabled={opts.view !== 'follow' && opts.view !== 'drone'}
        target={PRESETS.free.target}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={6}
        maxDistance={140}
        enableDamping
      />
      <CameraDirector mission={mission} view={opts.view} controls={controls} />
      <Renderer droneCam={droneCam} opts={opts} captureRef={captureRef} />
    </Canvas>
  );
}
