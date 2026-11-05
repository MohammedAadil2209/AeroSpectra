/**
 * Procedural narrow-body twinjet (A320-class proportions), used until aircraft.glb is exported from Blender.
 * Frame: nose +X, up +Y, starboard (right wing) +Z. Length ≈ 39.8 m, span ≈ 32 m. Stationary.
 *
 * Every part is derived from ONE fuselage shape function (`body(x)`: radius + centre-line offset), so wings,
 * tail surfaces, gear and pylons are embedded in the surfaces they attach to — no floating parts.
 * Lifting surfaces are lofted NACA-style airfoils (taper, sweep, dihedral, blended winglets).
 * Keep extents in sync with AIRCRAFT / PLANFORM_POINTS in simulationConfig.ts (path clearance uses them).
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

// ------------------------------------------------------------------ materials
const DS = THREE.DoubleSide; // lofted/lathed open surfaces: three.js flips normals for back faces
const PAINT = new THREE.MeshStandardMaterial({ color: '#f1f3f5', metalness: 0.25, roughness: 0.32, side: DS });
const WING = new THREE.MeshStandardMaterial({ color: '#c9d0d6', metalness: 0.45, roughness: 0.38, side: DS });
const NAVY = new THREE.MeshStandardMaterial({ color: '#0b2c42', metalness: 0.3, roughness: 0.4, side: DS });
const CRIMSON = new THREE.MeshStandardMaterial({ color: '#8e0e14', metalness: 0.25, roughness: 0.4, side: DS });
const GLASS = new THREE.MeshStandardMaterial({ color: '#0a141c', metalness: 0.95, roughness: 0.08, side: DS });
const FRAME = new THREE.MeshStandardMaterial({ color: '#1a2228', metalness: 0.5, roughness: 0.5, side: DS });
const DOOR = new THREE.MeshStandardMaterial({ color: '#dfe3e7', metalness: 0.25, roughness: 0.4, side: DS });
const DARK = new THREE.MeshStandardMaterial({ color: '#151b20', metalness: 0.6, roughness: 0.5, side: DS });
const FAN = new THREE.MeshStandardMaterial({ color: '#3a434a', metalness: 0.9, roughness: 0.25, side: DS });
const RUBBER = new THREE.MeshStandardMaterial({ color: '#121417', roughness: 0.92 });
const STEEL = new THREE.MeshStandardMaterial({ color: '#9aa3aa', metalness: 0.9, roughness: 0.25, side: DS });
const HOT = new THREE.MeshStandardMaterial({ color: '#6e6a66', metalness: 0.85, roughness: 0.35, side: DS });
const RED_LIGHT = new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false });
const GREEN_LIGHT = new THREE.MeshBasicMaterial({ color: '#22ff66', toneMapped: false });
const WHITE_LIGHT = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

const FY = 3.9; // fuselage centre height at the constant section
const FR = 2.0; // fuselage radius (constant section)

// ------------------------------------------------------------------ fuselage shape
/** [x, radius, centre-line offset dy] samples, nose → tail. Upswept tail cone, slight nose droop. */
const BODY_SAMPLES: [number, number, number][] = [
  [19.85, 0.02, -0.32], [19.7, 0.42, -0.3], [19.3, 0.78, -0.26], [18.6, 1.12, -0.2], [17.6, 1.45, -0.13],
  [16.4, 1.72, -0.07], [15.0, 1.9, -0.02], [13.5, 1.98, 0], [12, FR, 0], [-10, FR, 0], [-11.5, 1.97, 0.03],
  [-13, 1.86, 0.1], [-14.5, 1.66, 0.22], [-16, 1.4, 0.38], [-17.3, 1.12, 0.55], [-18.5, 0.82, 0.72],
  [-19.4, 0.52, 0.86], [-19.85, 0.3, 0.94], [-19.95, 0.18, 0.96],
];

/** Dense lookup of the fuselage cross-section. */
const BODY_TABLE = (() => {
  const curve = new THREE.CatmullRomCurve3(BODY_SAMPLES.map(([x, r, dy]) => new THREE.Vector3(x, r, dy)), false, 'centripetal');
  return curve.getPoints(600).sort((a, b) => a.x - b.x);
})();

/** Fuselage radius + absolute centre height at station x. */
export function body(x: number): { r: number; cy: number } {
  const t = BODY_TABLE;
  if (x <= t[0].x) return { r: t[0].y, cy: FY + t[0].z };
  if (x >= t[t.length - 1].x) return { r: t[t.length - 1].y, cy: FY + t[t.length - 1].z };
  let lo = 0;
  let hi = t.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (t[m].x <= x) lo = m;
    else hi = m;
  }
  const a = t[lo];
  const b = t[hi];
  const f = (x - a.x) / (b.x - a.x || 1);
  return { r: a.y + (b.y - a.y) * f, cy: FY + a.z + (b.z - a.z) * f };
}

/** Point on the fuselage skin. phi: 0 = top, +90° = starboard (+Z), 180° = belly. */
function skin(x: number, phi: number, off = 0): THREE.Vector3 {
  const { r, cy } = body(x);
  return new THREE.Vector3(x, cy + (r + off) * Math.cos(phi), (r + off) * Math.sin(phi));
}

function fuselageGeometry(): THREE.BufferGeometry {
  const NX = 140;
  const NP = 64;
  const x0 = BODY_SAMPLES[BODY_SAMPLES.length - 1][0];
  const x1 = BODY_SAMPLES[0][0];
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= NX; i++) {
    // denser rings near nose and tail
    const u = i / NX;
    const s = 0.5 - 0.5 * Math.cos(Math.PI * u);
    const x = x0 + (x1 - x0) * (0.35 * u + 0.65 * s);
    for (let j = 0; j <= NP; j++) {
      const p = skin(x, (j / NP) * Math.PI * 2);
      pos.push(p.x, p.y, p.z);
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NP; j++) {
      const a = i * (NP + 1) + j;
      const b = a + NP + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Conformal patch on the fuselage skin (livery, doors, windshield), slightly offset outward. */
function skinPatch(xa: number, xb: number, pa: number, pb: number, off: number, nx = 48, np = 16, top?: (x: number) => number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const x = xa + ((xb - xa) * i) / nx;
    const pbx = top ? top(x) : pb;
    for (let j = 0; j <= np; j++) {
      const phi = pa + ((pbx - pa) * j) / np;
      const p = skin(x, phi, off);
      pos.push(p.x, p.y, p.z);
      uv.push(i / nx, j / np);
    }
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < np; j++) {
      const a = i * (np + 1) + j;
      const b = a + np + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Skin band whose phi range varies along x (used for the swept windshield). */
function skinBand(xa: number, xb: number, fa: (x: number) => number, fb: (x: number) => number, off: number, nx = 24, np = 10): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= nx; i++) {
    const x = xa + ((xb - xa) * i) / nx;
    const a = fa(x);
    const b = fb(x);
    for (let j = 0; j <= np; j++) {
      const q = skin(x, a + ((b - a) * j) / np, off);
      pos.push(q.x, q.y, q.z);
    }
  }
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < np; j++) {
      const a = i * (np + 1) + j;
      const b = a + np + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ lofted lifting surfaces
interface Station {
  le: THREE.Vector3; // leading-edge point
  c: number; // chord (along -X)
  t: number; // thickness / chord
  n: THREE.Vector3; // thickness direction (unit)
  camber?: number;
}
const D2R = Math.PI / 180;

function loft(stations: Station[], N = 26, capStart = true, capEnd = true): THREE.BufferGeometry {
  // cosine-spaced chordwise samples; closed loop upper TE→LE→lower TE
  const us: number[] = [];
  for (let i = 0; i <= N; i++) us.push(0.5 - 0.5 * Math.cos((Math.PI * i) / N));
  const yt = (u: number, t: number) => 5 * t * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
  const ring = (s: Station) => {
    const pts: THREE.Vector3[] = [];
    const cam = s.camber ?? 0;
    const add = (u: number, sign: number) => {
      const yc = cam * 4 * u * (1 - u);
      pts.push(s.le.clone().add(new THREE.Vector3(-u * s.c, 0, 0)).addScaledVector(s.n, (yc + sign * yt(u, s.t)) * s.c));
    };
    for (let i = N; i >= 0; i--) add(us[i], 1);
    for (let i = 1; i <= N; i++) add(us[i], -1);
    return pts;
  };
  const rings = stations.map(ring);
  const M = rings[0].length;
  const pos: number[] = [];
  const idx: number[] = [];
  rings.forEach((r) => r.forEach((p) => pos.push(p.x, p.y, p.z)));
  for (let k = 0; k < rings.length - 1; k++)
    for (let j = 0; j < M - 1; j++) {
      const a = k * M + j;
      const b = a + M;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const cap = (k: number) => {
    const c = rings[k].reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / M);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z);
    for (let j = 0; j < M - 1; j++) idx.push(ci, k * M + j, k * M + j + 1);
  };
  if (capStart) cap(0);
  if (capEnd) cap(rings.length - 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// wing planform (matches PLANFORM_POINTS): root LE (1.6, z 2.0) chord 7.2; tip LE (-7.6, z 15.6) chord 2.0
const WING_ROOT_Y = FY - 1.2; // low wing
const DIHEDRAL = 4.5 * D2R;
const wingLE = (z: number) => 1.6 + (-7.6 - 1.6) * ((Math.abs(z) - 2) / 13.6);
const wingChord = (z: number) => 7.2 + (2.0 - 7.2) * ((Math.abs(z) - 2) / 13.6);
/** Wing mid-surface height at span station z. */
export const wingY = (z: number) => WING_ROOT_Y + Math.max(0, Math.abs(z) - 0.8) * Math.tan(DIHEDRAL);
const wingT = (z: number) => 0.15 + (0.105 - 0.15) * Math.max(0, (Math.abs(z) - 2) / 13.6);

function wingStations(side: 1 | -1): Station[] {
  const n = new THREE.Vector3(0, Math.cos(DIHEDRAL), -side * Math.sin(DIHEDRAL));
  const st = (z: number, le = wingLE(z), c = wingChord(z)): Station => ({ le: new THREE.Vector3(le, wingY(z), side * z), c, t: wingT(z), n, camber: 0.02 });
  // inner station is buried in the fuselage / belly fairing
  return [st(0.8, 1.6, 7.2), st(2.0), st(5), st(9), st(13), st(15.6)];
}

function wingletStations(side: 1 | -1): Station[] {
  const ty = wingY(15.6);
  const nUp = new THREE.Vector3(0, Math.cos(DIHEDRAL), -side * Math.sin(DIHEDRAL));
  const nMid = new THREE.Vector3(0, 0.7, side * 0.7).normalize();
  const nOut = new THREE.Vector3(0, -0.12, side * 1).normalize();
  return [
    { le: new THREE.Vector3(-7.6, ty, side * 15.6), c: 2.0, t: 0.105, n: nUp },
    { le: new THREE.Vector3(-8.15, ty + 0.3, side * 15.9), c: 1.65, t: 0.1, n: nMid },
    { le: new THREE.Vector3(-8.75, ty + 0.85, side * 16.02), c: 1.25, t: 0.09, n: nOut },
    { le: new THREE.Vector3(-9.65, ty + 2.1, side * 16.12), c: 0.62, t: 0.08, n: nOut },
  ];
}

// vertical fin: root embedded in the tail cone, tip at y 11.6 (AIRCRAFT.verticalStabTopY)
const FIN_ROOT = { le: -13.3, c: 6.2, y: FY + 1.3 };
const FIN_TIP = { le: -17.55, c: 2.15, y: 11.6 };
function finStation(f: number): Station {
  return {
    le: new THREE.Vector3(FIN_ROOT.le + (FIN_TIP.le - FIN_ROOT.le) * f, FIN_ROOT.y + (FIN_TIP.y - FIN_ROOT.y) * f, 0),
    c: FIN_ROOT.c + (FIN_TIP.c - FIN_ROOT.c) * f,
    t: 0.11,
    n: new THREE.Vector3(0, 0, 1),
  };
}

// horizontal stabiliser: root buried in the tail cone (z 0.35), tip (-18.5, z 6.6) chord 1.1
const STAB_Y = FY + 0.62;
const STAB_DIH = 6 * D2R;
function stabStations(side: 1 | -1): Station[] {
  const n = new THREE.Vector3(0, Math.cos(STAB_DIH), -side * Math.sin(STAB_DIH));
  const st = (z: number, le: number, c: number): Station => ({ le: new THREE.Vector3(le, STAB_Y + Math.max(0, z - 0.35) * Math.tan(STAB_DIH), side * z), c, t: 0.1, n });
  return [st(0.35, -15.3, 4.3), st(1.0, -15.65, 3.95), st(6.6, -18.5, 1.1)];
}

// ------------------------------------------------------------------ engine (CFM56/LEAP-class)
const ENG = { x: -0.4, y: 1.45, z: 6 }; // nacelle centre (matches AIRFRAME_SKELETON)

function lathe(profile: [number, number][], seg = 48) {
  // profile: [axialX, radius]; lathe around Y, then map Y → +X
  const g = new THREE.LatheGeometry(profile.map(([x, r]) => new THREE.Vector2(Math.max(0.001, r), x)), seg);
  g.rotateZ(-Math.PI / 2);
  return g;
}

function Engine({ side }: { side: 1 | -1 }) {
  const geo = useMemo(() => {
    // closed nacelle: inner intake → lip → fan cowl → aft fan cowl
    const nacelle = lathe([
      [1.0, 0.8], [1.45, 0.81], [1.66, 0.86], [1.7, 0.9], [1.62, 0.95], [1.3, 0.99], [0.6, 1.0], [-0.3, 0.98], [-1.0, 0.92], [-1.45, 0.84], [-1.5, 0.74],
    ]);
    const bypassLiner = lathe([[-1.5, 0.74], [-1.3, 0.74], [-0.2, 0.78], [1.0, 0.8]], 40);
    const core = lathe([[-1.25, 0.66], [-1.6, 0.64], [-2.15, 0.55], [-2.55, 0.46]]);
    const nozzle = lathe([[-2.55, 0.46], [-2.62, 0.44], [-2.6, 0.38]], 40);
    const plug = lathe([[-2.5, 0.38], [-2.85, 0.3], [-3.15, 0.14], [-3.3, 0.01]], 32);
    const spinner = lathe([[1.05, 0.26], [1.25, 0.2], [1.4, 0.11], [1.48, 0.01]], 32);
    const fanDisc = new THREE.CircleGeometry(0.8, 48).rotateY(Math.PI / 2);
    const blade = new THREE.BoxGeometry(0.035, 0.56, 0.16);
    // pylon side profile (x, y) from nacelle top up into the wing underside, extruded 0.34 in z
    const wy = wingY(ENG.z);
    const top = ENG.y + 0.95;
    const shape = new THREE.Shape([
      new THREE.Vector2(1.15, top - 0.05),
      new THREE.Vector2(-1.4, top - 0.12),
      new THREE.Vector2(-3.5, wy - 0.1),
      new THREE.Vector2(-3.8, wy + 0.12),
      new THREE.Vector2(-1.9, wy + 0.08),
      new THREE.Vector2(-0.4, wy - 0.18),
      new THREE.Vector2(0.6, top + 0.35),
    ]);
    const pylon = new THREE.ExtrudeGeometry(shape, { depth: 0.34, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 });
    pylon.translate(0, 0, -0.17);
    return { nacelle, bypassLiner, core, nozzle, plug, spinner, fanDisc, blade, pylon };
  }, []);
  const blades = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = blades.current;
    if (!m) return;
    const o = new THREE.Object3D();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      o.position.set(1.12, Math.cos(a) * 0.5, Math.sin(a) * 0.5);
      o.rotation.set(a, 0, 0);
      o.rotateY(0.55); // blade twist
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    }
    m.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <group position={[ENG.x, ENG.y, side * ENG.z]}>
        <mesh geometry={geo.nacelle} castShadow receiveShadow material={PAINT} />
        <mesh geometry={geo.bypassLiner} material={DARK} />
        <mesh geometry={geo.core} castShadow material={STEEL} />
        <mesh geometry={geo.nozzle} material={HOT} />
        <mesh geometry={geo.plug} castShadow material={HOT} />
        <mesh geometry={geo.fanDisc} position={[1.08, 0, 0]} material={DARK} />
        <mesh geometry={geo.spinner} material={FAN} />
        <instancedMesh ref={blades} args={[geo.blade, FAN, 24]} />
        {/* livery band on the fan cowl */}
        <mesh rotation={[0, 0, -Math.PI / 2]} position={[0.15, 0, 0]}>
          <cylinderGeometry args={[1.006, 0.998, 0.42, 48, 1, true]} />
          <primitive object={CRIMSON} attach="material" />
        </mesh>
      </group>
      <mesh geometry={geo.pylon} position={[ENG.x, 0, side * ENG.z]} castShadow material={WING} />
    </group>
  );
}

// ------------------------------------------------------------------ landing gear
function Wheel({ position, r, w }: { position: [number, number, number]; r: number; w: number }) {
  return (
    <group position={position}>
      <mesh castShadow rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r, r, w, 28]} />
        <primitive object={RUBBER} attach="material" />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[r * 0.55, r * 0.55, w + 0.02, 20]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
    </group>
  );
}

/** Main gear: strut from the wing-root underside, axle, twin wheels, side brace and gear door. */
function MainGear({ side }: { side: 1 | -1 }) {
  const x = -3.1;
  const z = side * 2.75;
  const r = 0.56;
  const topY = wingY(2.75) - 0.15; // buried in the wing root
  const len = topY - r;
  return (
    <group>
      <mesh castShadow position={[x, r + len / 2, z]}>
        <cylinderGeometry args={[0.13, 0.15, len, 14]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
      {/* oleo chrome section */}
      <mesh position={[x, r + 0.45, z]}>
        <cylinderGeometry args={[0.11, 0.11, 0.6, 14]} />
        <meshStandardMaterial color="#e6ebee" metalness={1} roughness={0.08} />
      </mesh>
      {/* axle */}
      <mesh position={[x, r, z]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.07, 0.07, 0.95, 10]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
      <Wheel position={[x, r, z - 0.38]} r={r} w={0.36} />
      <Wheel position={[x, r, z + 0.38]} r={r} w={0.36} />
      {/* side brace towards the fuselage */}
      <mesh castShadow position={[x, r + len * 0.62, side * 1.95]} rotation={[side * 0.95, 0, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 1.9, 8]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
      {/* gear leg door (outboard) */}
      <mesh castShadow position={[x, r + len * 0.55, z + side * 0.24]}>
        <boxGeometry args={[1.1, len * 0.75, 0.04]} />
        <primitive object={WING} attach="material" />
      </mesh>
    </group>
  );
}

function NoseGear() {
  const x = 15.3;
  const r = 0.4;
  const { r: br, cy } = body(x);
  const topY = cy - br + 0.25; // buried in the nose
  const len = topY - r;
  return (
    <group>
      <mesh castShadow position={[x, r + len / 2, 0]}>
        <cylinderGeometry args={[0.09, 0.11, len, 12]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
      <mesh position={[x, r, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.62, 10]} />
        <primitive object={STEEL} attach="material" />
      </mesh>
      <Wheel position={[x, r, -0.24]} r={r} w={0.22} />
      <Wheel position={[x, r, 0.24]} r={r} w={0.22} />
      {/* taxi light */}
      <mesh position={[x + 0.18, r + len * 0.7, 0]}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <primitive object={WHITE_LIGHT} attach="material" />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------------ livery text decal
function titleTexture(flip: boolean) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 1024, 160);
  if (flip) {
    g.translate(1024, 0);
    g.scale(-1, 1);
  }
  g.fillStyle = '#0b2c42';
  g.font = 'bold 112px Arial, sans-serif';
  g.textBaseline = 'middle';
  g.fillText('AEROSPECTRA', 24, 84);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Swept windshield band (per side): upper edge closes toward the centre at the front, lower edge rises to the nose. */
const WS = { xa: 16.3, xb: 17.82 };
const lerpX = (x: number, a: number, b: number) => a + (b - a) * ((x - WS.xa) / (WS.xb - WS.xa));
const wsTop = (x: number) => lerpX(x, 0.86, 0.09); // phi from the top (rad)
const wsBot = (x: number) => lerpX(x, 1.13, 0.78);
const WS_MULLIONS = [16.72, 17.28]; // pane dividers along x

// ------------------------------------------------------------------ assembly
export function ProceduralAircraft() {
  const geo = useMemo(() => {
    return {
      fuselage: fuselageGeometry(),
      belly: skinPatch(-14.2, 15.8, Math.PI * 0.64, Math.PI * 1.36, 0.008, 120, 24),
      cheatL: skinPatch(-13.5, 15.2, -Math.PI * 0.555, -Math.PI * 0.535, 0.01, 120, 2),
      cheatR: skinPatch(-13.5, 15.2, Math.PI * 0.535, Math.PI * 0.555, 0.01, 120, 2),
      titleL: skinPatch(1.5, 11.5, -Math.PI * 0.36, -Math.PI * 0.27, 0.012, 40, 6),
      // starboard: phi runs downward on this side, so build the patch bottom→top to keep the text upright
      titleR: skinPatch(1.5, 11.5, Math.PI * 0.36, Math.PI * 0.27, 0.012, 40, 6),
      // cockpit windshield: dark frame band, glass band, mullions and centre post (both sides)
      wsFrames: [1, -1].map((sd) => skinBand(WS.xa - 0.06, WS.xb + 0.04, (x) => sd * (wsTop(x) - 0.05), (x) => sd * (wsBot(x) + 0.05), 0.008)),
      wsPanes: [
        ...[1, -1].map((sd) => skinBand(WS.xa, WS.xb, (x) => sd * wsTop(x), (x) => sd * wsBot(x), 0.014)),
        // centre post + mullions (frame colour, drawn on top of the glass)
      ],
      wsPosts: [
        skinBand(17.62, WS.xb + 0.04, () => -0.085, () => 0.085, 0.018, 6, 4), // centre post only where the panes meet
        ...[1, -1].flatMap((sd) => WS_MULLIONS.map((mx) => skinBand(mx - 0.03, mx + 0.03, () => sd * (wsTop(mx) - 0.04), () => sd * (wsBot(mx) + 0.04), 0.018, 2, 8))),
      ],
      doors: [
        // forward + aft passenger doors, overwing exits (both sides)
        ...[-1, 1].flatMap((s) => [
          skinPatch(14.1, 15.0, s > 0 ? Math.PI * 0.34 : -Math.PI * 0.6, s > 0 ? Math.PI * 0.6 : -Math.PI * 0.34, 0.01, 10, 10),
          skinPatch(-11.3, -10.45, s > 0 ? Math.PI * 0.34 : -Math.PI * 0.6, s > 0 ? Math.PI * 0.6 : -Math.PI * 0.34, 0.01, 10, 10),
          skinPatch(-1.6, -1.05, s > 0 ? Math.PI * 0.38 : -Math.PI * 0.53, s > 0 ? Math.PI * 0.53 : -Math.PI * 0.38, 0.01, 6, 6),
          skinPatch(-2.6, -2.05, s > 0 ? Math.PI * 0.38 : -Math.PI * 0.53, s > 0 ? Math.PI * 0.53 : -Math.PI * 0.38, 0.01, 6, 6),
        ]),
      ],
      leftWing: loft(wingStations(-1)),
      rightWing: loft(wingStations(1)),
      leftWinglet: loft(wingletStations(-1), 22, false, true),
      rightWinglet: loft(wingletStations(1), 22, false, true),
      finLower: loft([0, 0.3, 0.6, 0.84].map(finStation), 26, true, false),
      finTip: loft([0.84, 1].map(finStation), 26, false, true),
      lStab: loft(stabStations(-1)),
      rStab: loft(stabStations(1)),
      // dorsal fillet blending fin into the fuselage
      dorsal: loft([
        { le: new THREE.Vector3(-10.6, body(-10.6).cy + body(-10.6).r - 0.25, 0), c: 3.2, t: 0.12, n: new THREE.Vector3(0, 0, 1) },
        { le: new THREE.Vector3(-12.9, FIN_ROOT.y + 0.55, 0), c: 1.6, t: 0.1, n: new THREE.Vector3(0, 0, 1) },
      ], 18),
      titleTexL: titleTexture(true),
      titleTexR: titleTexture(false),
    };
  }, []);

  // cabin windows: rounded, flattened capsules sitting on the skin at phi = ±78°
  const winRef = useRef<THREE.InstancedMesh>(null);
  const winList = useMemo(() => {
    const list: { p: THREE.Vector3; phi: number }[] = [];
    for (const s of [-1, 1]) {
      for (let x = 13.2; x > -10.0; x -= 0.53) {
        if (x < 15.0 && x > 13.95) continue;
        if (x < -0.95 && x > -2.75) continue; // overwing exits
        const phi = s * 78 * D2R;
        list.push({ p: skin(x, phi, -0.005), phi });
      }
    }
    return list;
  }, []);
  const winGeo = useMemo(() => new THREE.CapsuleGeometry(0.11, 0.13, 4, 10), []);
  useLayoutEffect(() => {
    const m = winRef.current;
    if (!m) return;
    const o = new THREE.Object3D();
    winList.forEach(({ p, phi }, i) => {
      o.position.copy(p);
      o.rotation.set(phi + Math.PI / 2, 0, 0); // capsule axis -> skin's vertical tangent; local Z -> surface normal
      o.scale.set(1, 1, 0.18);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [winList]);

  const tipY = wingY(15.6);

  return (
    <group name="aircraft">
      {/* fuselage + livery */}
      <mesh geometry={geo.fuselage} castShadow receiveShadow material={PAINT} />
      <mesh geometry={geo.belly} material={NAVY} />
      <mesh geometry={geo.cheatL} material={CRIMSON} />
      <mesh geometry={geo.cheatR} material={CRIMSON} />
      <mesh geometry={geo.titleL}>
        <meshStandardMaterial map={geo.titleTexL} transparent side={THREE.DoubleSide} depthWrite={false} roughness={0.4} />
      </mesh>
      <mesh geometry={geo.titleR}>
        <meshStandardMaterial map={geo.titleTexR} transparent side={THREE.DoubleSide} depthWrite={false} roughness={0.4} />
      </mesh>
      {/* cockpit windshield */}
      {geo.wsFrames.map((g, i) => <mesh key={`wf${i}`} geometry={g} material={FRAME} />)}
      {geo.wsPanes.map((g, i) => <mesh key={`wp${i}`} geometry={g} material={GLASS} />)}
      {geo.wsPosts.map((g, i) => <mesh key={`wm${i}`} geometry={g} material={FRAME} />)}
      {/* cabin windows */}
      <instancedMesh ref={winRef} args={[winGeo, GLASS, winList.length]} />
      {/* doors & exits */}
      {geo.doors.map((g, i) => <mesh key={i} geometry={g} material={DOOR} />)}
      {/* APU exhaust */}
      <mesh position={[-19.96, body(-19.96).cy, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.14, 0.17, 0.12, 16]} />
        <primitive object={DARK} attach="material" />
      </mesh>

      {/* wing-body belly fairing (covers the wing root) */}
      <mesh castShadow receiveShadow position={[-2.0, FY - 1.32, 0]} scale={[6.3, 0.95, 2.05]}>
        <sphereGeometry args={[1, 40, 20]} />
        <primitive object={WING} attach="material" />
      </mesh>

      {/* wings + blended winglets */}
      <mesh geometry={geo.leftWing} castShadow receiveShadow material={WING} />
      <mesh geometry={geo.rightWing} castShadow receiveShadow material={WING} />
      <mesh geometry={geo.leftWinglet} castShadow material={CRIMSON} />
      <mesh geometry={geo.rightWinglet} castShadow material={CRIMSON} />
      {/* flap-track fairings under each wing */}
      {[-1, 1].flatMap((s) =>
        [4.2, 7.8, 11.2].map((z) => {
          const te = wingLE(z) - wingChord(z);
          return (
            <mesh key={`ft${s}${z}`} castShadow position={[te + 0.55, wingY(z) - 0.22, s * z]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.55]}>
              <coneGeometry args={[0.2, 2.4, 12]} />
              <primitive object={WING} attach="material" />
            </mesh>
          );
        }),
      )}
      {/* navigation lights: red port, green starboard, white tail */}
      <mesh position={[-9.75, tipY + 2.12, -16.12]}><sphereGeometry args={[0.08, 10, 8]} /><primitive object={RED_LIGHT} attach="material" /></mesh>
      <mesh position={[-9.75, tipY + 2.12, 16.12]}><sphereGeometry args={[0.08, 10, 8]} /><primitive object={GREEN_LIGHT} attach="material" /></mesh>
      <mesh position={[-19.98, body(-19.98).cy + 0.2, 0]}><sphereGeometry args={[0.06, 10, 8]} /><primitive object={WHITE_LIGHT} attach="material" /></mesh>

      <Engine side={-1} />
      <Engine side={1} />

      {/* empennage */}
      <mesh geometry={geo.dorsal} castShadow material={NAVY} />
      <mesh geometry={geo.finLower} castShadow receiveShadow material={NAVY} />
      <mesh geometry={geo.finTip} castShadow material={CRIMSON} />
      <mesh geometry={geo.lStab} castShadow receiveShadow material={WING} />
      <mesh geometry={geo.rStab} castShadow receiveShadow material={WING} />

      {/* landing gear */}
      <NoseGear />
      <MainGear side={-1} />
      <MainGear side={1} />
    </group>
  );
}
