/**
 * Overview defect map scene: a large aircraft whose parts are hover zones. Hovering (or selecting) a part
 * lights it up and reveals that part's recorded damage as marks on the skin.
 * Zone geometry follows ProceduralAircraft (nose +X, up +Y, starboard +Z); with a GLB model the zones are approximate.
 */
import { useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { AircraftModel } from '@/components/simulation/ModelAssets';
import { ProceduralAircraft } from '@/components/simulation/ProceduralAircraft';
import type { Detection } from '@/types';
import { placeDetection } from './defectPlacement';
import { DEFECT_MAP_COLOR } from './defectMapColors';

const FY = 3.9;
const LIFT = -3.4; // aircraft group offset in the scene
const TARGET = new THREE.Vector3(0, 2.2, 0); // orbit centre ≈ middle of the airframe

/** Airframe extremities (scene coordinates) that must always stay in frame. */
const EXTREMES: THREE.Vector3[] = ([
  [19.9, 3.9, 0], [-19.9, 4, 0], [-19.3, 11.7, 0], [-17.6, 11.7, 0], [0, 5.95, 0], [0, 1.9, 0],
  [-9.8, 4.2, 15.9], [-9.8, 4.2, -15.9], [-9.1, 5.6, 15.6], [-9.1, 5.6, -15.6], [-7.6, 4.0, 15.9], [-7.6, 4.0, -15.9],
  [-19.6, 4.7, 6.8], [-19.6, 4.7, -6.8], [15.2, 0, 0], [-3.4, 0, 3.4], [-3.4, 0, -3.4], [1.8, 0.5, 6], [1.8, 0.5, -6],
] as [number, number, number][]).map(([x, y, z]) => new THREE.Vector3(x, y + LIFT, z));

/**
 * Keeps the whole aircraft in view: every frame, projects the airframe extremities and eases the camera
 * distance so the widest one sits at `margin` of the viewport (works while orbiting and on resize).
 */
function AutoFit({ margin = 0.9 }: { margin?: number }) {
  const { camera } = useThree();
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const off = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    const tanV = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const tanH = tanV * cam.aspect;
    let m = 0;
    for (const p of EXTREMES) {
      tmp.copy(p).applyMatrix4(cam.matrixWorldInverse);
      const z = -tmp.z;
      if (z > 0.1) m = Math.max(m, Math.abs(tmp.x) / (z * tanH), Math.abs(tmp.y) / (z * tanV));
    }
    if (!m) return;
    off.copy(cam.position).sub(TARGET);
    const d = off.length();
    const want = THREE.MathUtils.clamp(d * (m / margin), 20, 200);
    off.setLength(d + (want - d) * Math.min(1, dt * 6));
    cam.position.copy(TARGET).add(off);
  });
  return null;
}
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const MARK_SIZE = { high: 0.62, medium: 0.48, low: 0.38 } as const;

function planform(points: [number, number][], thickness: number) {
  const shape = new THREE.Shape(points.map(([x, s]) => new THREE.Vector2(x, s)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  g.rotateX(Math.PI / 2);
  g.translate(0, thickness / 2, 0);
  return g;
}

interface Zone { section: string; geometry: THREE.BufferGeometry; position?: [number, number, number]; rotation?: [number, number, number] }

/** Slightly oversized shells around each airframe part: they catch the pointer and render the highlight. */
function useZones(): Zone[] {
  return useMemo(() => {
    const axisX = (g: THREE.BufferGeometry) => g.rotateZ(-Math.PI / 2); // cylinder +Y -> +X
    const fin = new THREE.ExtrudeGeometry(
      new THREE.Shape([new THREE.Vector2(-13.6, 0), new THREE.Vector2(-17.5, 6.6), new THREE.Vector2(-19.35, 6.6), new THREE.Vector2(-19.9, 0)]),
      { depth: 0.7, bevelEnabled: false },
    ).translate(0, 0, -0.35);
    return [
      { section: 'Nose & Cockpit', geometry: axisX(new THREE.CylinderGeometry(0.55, 2.12, 7.6, 40)), position: [16.15, FY, 0] },
      { section: 'Fuselage', geometry: axisX(new THREE.CylinderGeometry(2.12, 2.12, 23, 40)), position: [0.85, FY, 0] },
      { section: 'Tail', geometry: axisX(new THREE.CylinderGeometry(2.12, 0.5, 8.4, 40)), position: [-15.2, FY, 0] },
      { section: 'Tail', geometry: fin, position: [0, FY + 1.2, 0] },
      { section: 'Left Wing', geometry: planform([[1.9, -2.0], [-7.4, -15.9], [-9.9, -15.9], [-5.9, -2.0]], 0.8), position: [0, FY - 1.15, 0], rotation: [0.085, 0, 0] },
      { section: 'Right Wing', geometry: planform([[1.9, 2.0], [-7.4, 15.9], [-9.9, 15.9], [-5.9, 2.0]], 0.8), position: [0, FY - 1.15, 0], rotation: [-0.085, 0, 0] },
      { section: 'Left Engine', geometry: axisX(new THREE.CylinderGeometry(1.08, 1.08, 4.6, 32)), position: [-0.4, 1.45, -6] },
      { section: 'Right Engine', geometry: axisX(new THREE.CylinderGeometry(1.08, 1.08, 4.6, 32)), position: [-0.4, 1.45, 6] },
      { section: 'Stabilizers', geometry: planform([[-15.4, -1.0], [-18.4, -6.8], [-19.8, -6.8], [-19.8, -1.0]], 0.5), position: [0, FY + 0.7, 0] },
      { section: 'Stabilizers', geometry: planform([[-15.4, 1.0], [-18.4, 6.8], [-19.8, 6.8], [-19.8, 1.0]], 0.5), position: [0, FY + 0.7, 0] },
    ];
  }, []);
}

function ZoneMesh({ zone, active, preview, onHover, onSelect }: {
  zone: Zone; active: boolean; preview: boolean;
  onHover: (s: string | null) => void; onSelect: (s: string) => void;
}) {
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame(({ clock }, dt) => {
    const m = mat.current;
    if (!m) return;
    const target = active ? 0.2 + Math.sin(clock.elapsedTime * 3) * 0.05 : preview ? 0.12 : 0;
    m.opacity += (target - m.opacity) * Math.min(1, dt * 10);
  });
  return (
    <mesh
      geometry={zone.geometry}
      position={zone.position}
      rotation={zone.rotation}
      renderOrder={2}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; onHover(zone.section); }}
      onPointerOut={() => { document.body.style.cursor = ''; onHover(null); }}
      onClick={(e) => { e.stopPropagation(); onSelect(zone.section); }}
    >
      <meshBasicMaterial ref={mat} color="#4fb0ff" transparent opacity={0} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
    </mesh>
  );
}

/** A damage mark sitting on the skin: coloured core, soft halo, and a pulse ring while pending review. */
function DamageMark({ d, focused }: { d: Detection; focused: boolean }) {
  const ring = useRef<THREE.Mesh>(null);
  const group = useRef<THREE.Group>(null);
  const { position, quat } = useMemo(() => {
    const { position, normal } = placeDetection(d);
    return { position: position.clone().addScaledVector(normal, 0.06), quat: new THREE.Quaternion().setFromUnitVectors(Z_AXIS, normal) };
  }, [d]);
  const color = DEFECT_MAP_COLOR[d.category];
  const r = MARK_SIZE[d.priority] ?? 0.45;
  const phase = useMemo(() => (d.id.charCodeAt(d.id.length - 1) % 10) / 10, [d.id]);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (g) {
      const s = g.scale.x + ((focused ? 1.7 : 1) - g.scale.x) * Math.min(1, dt * 10);
      g.scale.setScalar(Math.max(0.01, s));
    }
    const m = ring.current;
    if (m) {
      const t = d.review_status === 'pending' ? (clock.elapsedTime * 0.8 + phase) % 1 : 0.3;
      m.scale.setScalar(1 + t * 1.6);
      (m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - t);
    }
  });
  const noHit = () => null;
  return (
    <group position={position} quaternion={quat}>
      <group ref={group} scale={0.01}>
        <mesh raycast={noHit} renderOrder={4}>
          <circleGeometry args={[r * 1.9, 32]} />
          <meshBasicMaterial color={color} transparent opacity={0.22} depthWrite={false} />
        </mesh>
        <mesh raycast={noHit} renderOrder={5}>
          <circleGeometry args={[r, 32]} />
          <meshBasicMaterial color={color} depthWrite={false} transparent opacity={0.95} />
        </mesh>
        <mesh ref={ring} raycast={noHit} renderOrder={5}>
          <ringGeometry args={[r * 1.05, r * 1.25, 40]} />
          <meshBasicMaterial color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </group>
  );
}

function GroundRings() {
  return (
    <group position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      {[17, 23, 29].map((r, i) => (
        <mesh key={r} raycast={() => null}>
          <ringGeometry args={[r, r + 0.06, 128]} />
          <meshBasicMaterial color="#9fc0d6" transparent opacity={0.13 - i * 0.03} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

export default function AircraftHero3D({ detections, active, preview, focusedId, onHover, onSelect, onClear }: {
  detections: Detection[];
  /** part currently shown (hovered or selected) */
  active: string | null;
  /** part hovered in the side list (soft highlight) */
  preview: string | null;
  focusedId: string | null;
  onHover: (section: string | null) => void;
  onSelect: (section: string) => void;
  onClear: () => void;
}) {
  const zones = useZones();
  const visible = useMemo(() => (active ? detections.filter((d) => d.section === active) : []), [detections, active]);
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ position: [31, 23, 36], fov: 31, near: 0.5, far: 400 }} gl={{ antialias: true, alpha: true }} onPointerMissed={onClear}>
      <ambientLight intensity={0.4} />
      <hemisphereLight args={['#dfefff', '#092635', 0.9]} />
      <directionalLight position={[22, 32, 18]} intensity={2.3} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <directionalLight position={[-24, 12, -20]} intensity={0.7} color="#9fc0d6" />
      <AutoFit margin={0.9} />
      <group position={[0, LIFT, 0]}>
        <AircraftModel procedural={<ProceduralAircraft />} />
        {zones.map((z, i) => (
          <ZoneMesh key={i} zone={z} active={active === z.section} preview={preview === z.section && active !== z.section} onHover={onHover} onSelect={onSelect} />
        ))}
        {visible.map((d) => <DamageMark key={d.id} d={d} focused={focusedId === d.id} />)}
        <GroundRings />
        <ContactShadows position={[0, 0.01, 0]} scale={80} blur={2.6} opacity={0.6} far={12} color="#000" />
      </group>
      <OrbitControls target={TARGET} autoRotate={!active} autoRotateSpeed={0.35} enableZoom={false} enablePan={false} enableDamping minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.15} />
    </Canvas>
  );
}
