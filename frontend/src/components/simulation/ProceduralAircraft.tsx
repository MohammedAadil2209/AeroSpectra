/**
 * Procedural narrow-body twinjet (temporary stand-in until aircraft.glb is exported from Blender).
 * Frame: nose +X, up +Y, right wing +Z. Length ≈ 39.7 m, span ≈ 31 m. Stationary.
 */
import { useMemo } from 'react';
import * as THREE from 'three';

const PAINT = new THREE.MeshStandardMaterial({ color: '#e8ecef', metalness: 0.35, roughness: 0.38 });
const PAINT_GREY = new THREE.MeshStandardMaterial({ color: '#b9c2c9', metalness: 0.5, roughness: 0.4 });
const NAVY = new THREE.MeshStandardMaterial({ color: '#092635', metalness: 0.3, roughness: 0.45 });
const CRIMSON = new THREE.MeshStandardMaterial({ color: '#7d0a0a', metalness: 0.25, roughness: 0.45 });
const GLASS = new THREE.MeshStandardMaterial({ color: '#0b1a26', metalness: 0.9, roughness: 0.12 });
const DARK = new THREE.MeshStandardMaterial({ color: '#1b232a', metalness: 0.6, roughness: 0.5 });
const RUBBER = new THREE.MeshStandardMaterial({ color: '#111417', roughness: 0.9 });
const STEEL = new THREE.MeshStandardMaterial({ color: '#8d969d', metalness: 0.85, roughness: 0.3 });

const FY = 3.9; // fuselage centre height
const FR = 2.0; // fuselage radius

function fuselageGeometry() {
  // radius profile along length (x from tail to nose); lathe around Y then rotate so axis = X
  const prof: [number, number][] = [
    [-19.9, 0.12], [-19.4, 0.45], [-18, 0.95], [-16, 1.45], [-13.5, 1.85], [-11, FR],
    [12, FR], [14.5, 1.93], [16.3, 1.72], [17.8, 1.38], [18.9, 0.95], [19.6, 0.45], [19.85, 0.0],
  ];
  const pts = prof.map(([x, r]) => new THREE.Vector2(r, x));
  const g = new THREE.LatheGeometry(pts, 48);
  g.rotateZ(-Math.PI / 2); // Y axis -> X axis
  return g;
}

/** Flat lifting surface from a 2D planform (x, span) extruded downward in Y. */
function planform(points: [number, number][], thickness: number) {
  const shape = new THREE.Shape(points.map(([x, s]) => new THREE.Vector2(x, s)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.06, bevelSegments: 2 });
  g.rotateX(Math.PI / 2); // shape-y -> world z ; extrusion -> world -y
  g.translate(0, thickness / 2, 0);
  return g;
}

function finGeometry() {
  const shape = new THREE.Shape([
    new THREE.Vector2(-13.8, 0), new THREE.Vector2(-17.6, 6.4), new THREE.Vector2(-19.2, 6.4), new THREE.Vector2(-19.7, 0),
  ]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 });
  g.translate(0, 0, -0.16);
  return g;
}

function Engine({ side }: { side: 1 | -1 }) {
  return (
    <group position={[-0.4, 1.45, 6 * side]}>
      {/* nacelle */}
      <mesh castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.92, 0.75, 4.0, 40, 1, true]} />
        <primitive object={PAINT} attach="material" />
      </mesh>
      <mesh castShadow position={[2.0, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.9, 0.09, 12, 40]} />
        <primitive object={PAINT_GREY} attach="material" />
      </mesh>
      {/* intake + fan face */}
      <mesh position={[1.9, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <circleGeometry args={[0.86, 40]} />
        <primitive object={DARK} attach="material" />
      </mesh>
      <mesh position={[1.92, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <coneGeometry args={[0.26, 0.4, 24]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
      {/* exhaust */}
      <mesh castShadow position={[-2.3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.55, 0.45, 0.8, 32]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
      {/* pylon */}
      <mesh castShadow position={[-0.6, 0.9, 0]}>
        <boxGeometry args={[3.2, 0.9, 0.28]} />
        <primitive object={PAINT_GREY} attach="material" />
      </mesh>
      {/* livery band */}
      <mesh position={[0.6, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.935, 0.92, 0.35, 40, 1, true]} />
        <primitive object={CRIMSON} attach="material" />
      </mesh>
    </group>
  );
}

function Gear({ x, z, nose }: { x: number; z: number; nose?: boolean }) {
  const top = FY - FR * 0.85;
  const wheelR = nose ? 0.4 : 0.56;
  const strut = top - wheelR;
  return (
    <group position={[x, 0, z]}>
      <mesh castShadow position={[0, wheelR + strut / 2, 0]}>
        <cylinderGeometry args={[0.1, 0.12, strut, 12]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
      {(nose ? [-0.22, 0.22] : [-0.34, 0.34]).map((dz) => (
        <mesh key={dz} castShadow position={[0, wheelR, dz]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[wheelR, wheelR, nose ? 0.24 : 0.36, 24]} />
          <primitive object={RUBBER} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

export function ProceduralAircraft() {
  const geo = useMemo(() => {
    const leftWing = planform([[1.6, -2.0], [-7.6, -15.6], [-9.6, -15.6], [-5.6, -2.0]], 0.36);
    const rightWing = planform([[1.6, 2.0], [-7.6, 15.6], [-9.6, 15.6], [-5.6, 2.0]], 0.36);
    const lStab = planform([[-15.6, -1.0], [-18.5, -6.6], [-19.6, -6.6], [-19.6, -1.0]], 0.22);
    const rStab = planform([[-15.6, 1.0], [-18.5, 6.6], [-19.6, 6.6], [-19.6, 1.0]], 0.22);
    return { fuselage: fuselageGeometry(), leftWing, rightWing, lStab, rStab, fin: finGeometry() };
  }, []);

  const windows = useMemo(() => {
    const m = new THREE.Matrix4();
    const list: THREE.Matrix4[] = [];
    for (const side of [-1, 1]) for (let x = 13.5; x > -11.5; x -= 0.75) {
      if (Math.abs(x - 6.2) < 0.5 || Math.abs(x + 3) < 0.4) continue; // door/overwing gaps
      list.push(m.clone().makeTranslation(x, FY + 0.45, side * (FR - 0.005)));
    }
    return list;
  }, []);

  return (
    <group name="aircraft">
      <mesh geometry={geo.fuselage} castShadow receiveShadow position={[0, FY, 0]}>
        <primitive object={PAINT} attach="material" />
      </mesh>
      {/* belly + cheatline livery */}
      <mesh position={[-0.5, FY, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[FR + 0.012, FR + 0.012, 23, 48, 1, true, Math.PI * 1.14, Math.PI * 0.72]} />
        <primitive object={NAVY} attach="material" />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.5, FY - 0.15, s * (FR + 0.016)]}>
          <boxGeometry args={[25, 0.16, 0.01]} />
          <primitive object={CRIMSON} attach="material" />
        </mesh>
      ))}
      {/* cockpit glazing */}
      <mesh position={[17.25, FY + 0.6, 0]} rotation={[0, 0, -0.55]}>
        <cylinderGeometry args={[1.42, 1.62, 0.85, 40, 1, true, -Math.PI * 0.32 + Math.PI / 2, Math.PI * 0.64]} />
        <primitive object={GLASS} attach="material" />
      </mesh>
      {/* cabin windows */}
      {windows.map((mat, i) => (
        <mesh key={i} matrix={mat} matrixAutoUpdate={false}>
          <boxGeometry args={[0.24, 0.34, 0.04]} />
          <primitive object={GLASS} attach="material" />
        </mesh>
      ))}
      {/* doors */}
      {[-1, 1].map((s) => (
        <mesh key={`d${s}`} position={[14.6, FY + 0.05, s * (FR - 0.01)]}>
          <boxGeometry args={[0.9, 1.9, 0.03]} />
          <meshStandardMaterial color="#cfd5da" metalness={0.3} roughness={0.5} />
        </mesh>
      ))}

      {/* wings (low-wing, 5° dihedral) */}
      <group position={[0, FY - 1.15, 0]}>
        <mesh geometry={geo.leftWing} castShadow receiveShadow rotation={[0.085, 0, 0]}>
          <primitive object={PAINT_GREY} attach="material" />
        </mesh>
        <mesh geometry={geo.rightWing} castShadow receiveShadow rotation={[-0.085, 0, 0]}>
          <primitive object={PAINT_GREY} attach="material" />
        </mesh>
        {/* winglets */}
        {[-1, 1].map((s) => (
          <mesh key={s} castShadow position={[-9.0, 1.95, s * 15.55]} rotation={[s * 0.15, 0, 0.35]}>
            <boxGeometry args={[1.5, 1.6, 0.12]} />
            <primitive object={CRIMSON} attach="material" />
          </mesh>
        ))}
      </group>
      {/* wing-body fairing */}
      <mesh castShadow position={[-2, FY - 1.35, 0]} scale={[1, 0.45, 1]}>
        <sphereGeometry args={[2.1, 24, 16, 0, Math.PI * 2, 0, Math.PI]} />
        <primitive object={PAINT_GREY} attach="material" />
      </mesh>

      <Engine side={-1} />
      <Engine side={1} />

      {/* tail */}
      <mesh geometry={geo.fin} castShadow position={[0, FY + 1.25, 0]}>
        <primitive object={NAVY} attach="material" />
      </mesh>
      <mesh position={[-17.9, FY + 4.4, 0]} rotation={[0, 0, -0.95]}>
        <boxGeometry args={[3.6, 0.5, 0.36]} />
        <primitive object={CRIMSON} attach="material" />
      </mesh>
      <group position={[0, FY + 0.7, 0]}>
        <mesh geometry={geo.lStab} castShadow>
          <primitive object={PAINT_GREY} attach="material" />
        </mesh>
        <mesh geometry={geo.rStab} castShadow>
          <primitive object={PAINT_GREY} attach="material" />
        </mesh>
      </group>

      {/* landing gear */}
      <Gear x={15.2} z={0} nose />
      <Gear x={-3.4} z={-3.1} />
      <Gear x={-3.4} z={3.1} />
    </group>
  );
}
