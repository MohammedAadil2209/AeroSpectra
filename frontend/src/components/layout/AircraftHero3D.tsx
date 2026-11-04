/** Overview hero 3D scene: the inspected aircraft with each recorded finding pinned to its airframe section. */
import { useMemo, useRef } from 'react';
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber';
import { ContactShadows, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { AircraftModel } from '@/components/simulation/ModelAssets';
import { ProceduralAircraft } from '@/components/simulation/ProceduralAircraft';
import { CATEGORY_COLOR } from '@/utils/labels';
import type { Detection } from '@/types';
import { placeDetection } from './defectPlacement';

const UP = new THREE.Vector3(0, 1, 0);
const PRIORITY_SIZE = { high: 0.42, medium: 0.32, low: 0.25 } as const;

function DefectMarker({ d, active, dimmed, onHover, onSelect }: {
  d: Detection;
  active: boolean;
  dimmed: boolean;
  onHover: (d: Detection | null) => void;
  onSelect: (d: Detection) => void;
}) {
  const ring = useRef<THREE.Mesh>(null);
  const { position, quat } = useMemo(() => {
    const { position, normal } = placeDetection(d);
    return { position, quat: new THREE.Quaternion().setFromUnitVectors(UP, normal) };
  }, [d]);
  const color = CATEGORY_COLOR[d.category];
  const r = PRIORITY_SIZE[d.priority] ?? 0.3;
  const pulse = d.review_status === 'pending';
  const phase = useMemo(() => (d.id.charCodeAt(d.id.length - 1) % 10) / 10, [d.id]);

  useFrame(({ clock }) => {
    const m = ring.current;
    if (!m) return;
    const t = pulse ? (clock.elapsedTime * 0.7 + phase) % 1 : 0.35;
    m.scale.setScalar(1 + t * 2.2);
    (m.material as THREE.MeshBasicMaterial).opacity = (dimmed ? 0.15 : 0.8) * (1 - t);
  });

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    onHover(d);
  };
  const out = () => {
    document.body.style.cursor = '';
    onHover(null);
  };

  return (
    <group position={position} quaternion={quat}>
      {/* stem lifts the pin slightly off the skin so it reads against the paint */}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.5, 6]} />
        <meshBasicMaterial color={color} transparent opacity={dimmed ? 0.25 : 0.9} />
      </mesh>
      <mesh
        position={[0, 0.55, 0]}
        scale={active ? 1.6 : 1}
        onPointerOver={over}
        onPointerOut={out}
        onClick={(e) => { e.stopPropagation(); onSelect(d); }}
      >
        <sphereGeometry args={[r, 20, 14]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={active ? 1.6 : 0.7} transparent opacity={dimmed ? 0.3 : 1} />
      </mesh>
      <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[r * 0.9, r * 1.2, 32]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

export default function AircraftHero3D({ detections, hoveredId, onHover, onSelect }: {
  detections: Detection[];
  hoveredId: string | null;
  onHover: (d: Detection | null) => void;
  onSelect: (d: Detection) => void;
}) {
  return (
    <Canvas shadows dpr={[1, 1.75]} camera={{ position: [30, 20, 32], fov: 36, near: 0.5, far: 400 }} gl={{ antialias: true, alpha: true }} onPointerMissed={() => onHover(null)}>
      <ambientLight intensity={0.35} />
      <directionalLight position={[20, 30, 15]} intensity={2.2} castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-30} shadow-camera-right={30} shadow-camera-top={30} shadow-camera-bottom={-30} />
      <directionalLight position={[-25, 10, -20]} intensity={0.6} color="#8fbcd8" />
      <hemisphereLight args={['#dfefff', '#011d2d', 0.9]} />
      <group position={[0, -4, 0]}>
        <AircraftModel procedural={<ProceduralAircraft />} />
        {detections.map((d) => (
          <DefectMarker key={d.id} d={d} active={hoveredId === d.id} dimmed={!!hoveredId && hoveredId !== d.id} onHover={onHover} onSelect={onSelect} />
        ))}
        <ContactShadows position={[0, 0.01, 0]} scale={70} blur={2.4} opacity={0.55} far={12} color="#000" />
      </group>
      <OrbitControls autoRotate={!hoveredId} autoRotateSpeed={0.5} enableZoom={false} enablePan={false} minPolarAngle={Math.PI / 6} maxPolarAngle={Math.PI / 2.1} target={[0, 0, 0]} />
    </Canvas>
  );
}
