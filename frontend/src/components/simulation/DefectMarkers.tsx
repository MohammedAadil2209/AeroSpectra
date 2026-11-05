/** Stored defects for the selected aircraft, shown on the 3D airframe once the drone camera has seen that section. */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RiskLevel } from '@/types';
import { RISK_COLOR } from '@/utils/labels';

export interface MarkerDefect { id: string; section: string; risk_level?: RiskLevel }

/** Surface anchor points per section (world frame: +X nose, +Z starboard). */
const ANCHORS: Record<string, [number, number, number][]> = {
  'Nose & Cockpit': [[16.5, 4.6, -1.2], [15, 5.2, 1.0], [17.5, 3.6, 0.9]],
  'Left Wing': [[-4.5, 3.25, -8], [-6.5, 3.35, -11.5], [-3, 3.15, -5.5]],
  'Right Wing': [[-4.5, 3.25, 8], [-6.5, 3.35, 11.5], [-3, 3.15, 5.5]],
  'Wing Root': [[-1, 3.0, -2.8], [-1, 3.0, 2.8]],
  'Left Engine': [[0.5, 2.3, -6], [-1.2, 1.45, -6.9], [1.4, 1.0, -6.5]],
  'Right Engine': [[0.5, 2.3, 6], [-1.2, 1.45, 6.9], [1.4, 1.0, 6.5]],
  Fuselage: [[6, 5.75, 0], [-6, 5.7, 0.6], [2, 4.6, 1.9], [-9, 4.6, -1.8]],
  Tail: [[-17.6, 8.5, 0.25], [-18.2, 10.5, 0.2], [-16.9, 6.6, 0.3]],
  Stabilizers: [[-18.3, 4.8, -4], [-18.3, 4.8, 4], [-17.8, 4.7, -2.5]],
};

const RANK: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export function DefectMarkers({ defects, visibleSections }: { defects: MarkerDefect[]; visibleSections: string[] }) {
  const markers = useMemo(() => {
    const seen = new Set(visibleSections);
    const bySec = new Map<string, MarkerDefect[]>();
    defects.forEach((d) => {
      if (!seen.has(d.section) || !ANCHORS[d.section]) return;
      bySec.set(d.section, [...(bySec.get(d.section) ?? []), d]);
    });
    const out: { key: string; pos: THREE.Vector3; color: string; critical: boolean; size: number }[] = [];
    bySec.forEach((list, sec) => {
      const sorted = [...list].sort((a, b) => RANK[b.risk_level ?? 'low'] - RANK[a.risk_level ?? 'low']).slice(0, 8);
      sorted.forEach((d, i) => {
        const a = ANCHORS[sec][i % ANCHORS[sec].length];
        const k = Math.floor(i / ANCHORS[sec].length);
        const lv = d.risk_level ?? 'low';
        out.push({
          key: d.id,
          pos: new THREE.Vector3(a[0] + k * 0.7, a[1] + k * 0.15, a[2] + (k % 2 ? 0.4 : -0.4) * k),
          color: RISK_COLOR[lv],
          critical: lv === 'critical' || lv === 'high',
          size: 0.28 + RANK[lv] * 0.07,
        });
      });
    });
    return out;
  }, [defects, visibleSections]);

  const rings = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    rings.current?.children.forEach((c, i) => {
      const s = 1 + ((t * 0.9 + i * 0.37) % 1) * 1.8;
      c.scale.setScalar(s);
      ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - (s - 1) / 1.8);
    });
  });

  return (
    <group>
      {markers.map((m) => (
        <mesh key={m.key} position={m.pos}>
          <sphereGeometry args={[m.size, 16, 12]} />
          <meshBasicMaterial color={m.color} toneMapped={false} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      <group ref={rings}>
        {markers.filter((m) => m.critical).map((m) => (
          <mesh key={`r${m.key}`} position={m.pos}>
            <sphereGeometry args={[m.size * 1.15, 16, 12]} />
            <meshBasicMaterial color={m.color} transparent opacity={0.5} depthWrite={false} toneMapped={false} />
          </mesh>
        ))}
      </group>
    </group>
  );
}
