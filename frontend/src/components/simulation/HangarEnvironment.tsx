/**
 * Procedural aircraft MRO hangar (no external assets).
 *
 * World frame: +X = aircraft nose, +Z = starboard. Hangar shell: x ∈ [-62, 62], z ∈ [-46, 46].
 * The aircraft is parked nose-in; the big sliding doors are behind the tail (x = -62), partly open to the apron.
 *
 * Quality:
 *   low  — standard floor, no reflections / contact shadows / dust, 1k shadow map
 *   high — MeshReflectorMaterial epoxy floor, contact shadows, dust motes, 2k shadow map
 * Repeated props (lights, trusses, cones, chocks, carts, ribs) are instanced to keep draw calls low.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { ContactShadows, MeshReflectorMaterial, Sparkles } from '@react-three/drei';

const HX = 62; // half length (x)
const HZ = 46; // half width (z)
const EAVE = 22;
const RIDGE = 30;

// ------------------------------------------------------------------ canvas textures
function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** Polished grey epoxy with subtle slab joints and tyre marks. */
function epoxyTexture() {
  return canvasTex(1024, 1024, (g) => {
    g.fillStyle = '#7d8a90';
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 5000; i++) {
      const v = 110 + Math.random() * 40;
      g.fillStyle = `rgba(${v},${v + 8},${v + 12},${Math.random() * 0.08})`;
      g.fillRect(Math.random() * 1024, Math.random() * 1024, 2 + Math.random() * 6, 2 + Math.random() * 6);
    }
    g.strokeStyle = 'rgba(40,50,56,.35)';
    g.lineWidth = 2;
    for (let i = 0; i <= 1024; i += 256) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
      g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
    }
    g.strokeStyle = 'rgba(30,30,30,.06)';
    g.lineWidth = 18;
    for (let k = 0; k < 4; k++) {
      g.beginPath(); g.moveTo(0, 200 + k * 180); g.bezierCurveTo(300, 260 + k * 170, 700, 120 + k * 200, 1024, 230 + k * 160); g.stroke();
    }
  }, [6, 5]);
}

/** Vertical corrugated cladding (light/dark stripes give the ribbed look under raking light). */
function corrugatedTexture(base: string) {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 16) {
      const grd = g.createLinearGradient(x, 0, x + 16, 0);
      grd.addColorStop(0, 'rgba(255,255,255,.10)');
      grd.addColorStop(0.5, 'rgba(0,0,0,.18)');
      grd.addColorStop(1, 'rgba(255,255,255,.10)');
      g.fillStyle = grd;
      g.fillRect(x, 0, 16, 256);
    }
    g.fillStyle = 'rgba(0,0,0,.25)';
    g.fillRect(0, 0, 256, 3);
  }, [24, 4]);
}

function hazardTexture() {
  return canvasTex(256, 32, (g) => {
    g.fillStyle = '#f2c230';
    g.fillRect(0, 0, 256, 32);
    g.fillStyle = '#16181a';
    for (let x = -32; x < 288; x += 32) {
      g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.closePath(); g.fill();
    }
  }, [40, 1]);
}

function signTexture(text: string, bg: string, fg: string, sub?: string) {
  return canvasTex(512, 192, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 192);
    g.strokeStyle = fg;
    g.lineWidth = 10;
    g.strokeRect(10, 10, 492, 172);
    g.fillStyle = fg;
    g.font = 'bold 76px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, sub ? 82 : 98);
    if (sub) {
      g.font = 'bold 30px Arial, sans-serif';
      g.fillText(sub, 256, 146);
    }
  });
}

function floorTextTexture(text: string) {
  return canvasTex(512, 256, (g) => {
    g.clearRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(242,194,48,.92)';
    g.font = 'bold 170px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 130);
  });
}

function skyTexture() {
  return canvasTex(16, 256, (g) => {
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#5b8fc0');
    grd.addColorStop(0.65, '#bcd6ea');
    grd.addColorStop(1, '#e9eef0');
    g.fillStyle = grd;
    g.fillRect(0, 0, 16, 256);
  });
}

function glowTexture() {
  return canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,250,235,1)');
    grd.addColorStop(0.25, 'rgba(255,240,210,.45)');
    grd.addColorStop(1, 'rgba(255,240,210,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 128);
  });
}

// ------------------------------------------------------------------ instancing helper
type Xf = { p: [number, number, number]; r?: [number, number, number]; s?: [number, number, number] };
function Instances({ geometry, material, items, castShadow, receiveShadow }: {
  geometry: THREE.BufferGeometry; material: THREE.Material; items: Xf[]; castShadow?: boolean; receiveShadow?: boolean;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const o = new THREE.Object3D();
    items.forEach((it, i) => {
      o.position.set(...it.p);
      o.rotation.set(...(it.r ?? [0, 0, 0]));
      o.scale.set(...(it.s ?? [1, 1, 1]));
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [items]);
  return <instancedMesh ref={ref} args={[geometry, material, items.length]} castShadow={castShadow} receiveShadow={receiveShadow} frustumCulled={false} />;
}

// ------------------------------------------------------------------ props
function Scaffold({ position, rotation = 0, h = 4.2, w = 4, d = 2.2 }: { position: [number, number, number]; rotation?: number; h?: number; w?: number; d?: number }) {
  const steel = '#c9a227';
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {[[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, h / 2, z]} castShadow>
          <boxGeometry args={[0.12, h, 0.12]} />
          <meshStandardMaterial color={steel} metalness={0.5} roughness={0.45} />
        </mesh>
      ))}
      <mesh position={[0, h, 0]} castShadow receiveShadow>
        <boxGeometry args={[w + 0.3, 0.14, d + 0.3]} />
        <meshStandardMaterial color="#5f6b70" metalness={0.6} roughness={0.5} />
      </mesh>
      {/* guard rails */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, h + 1.05, (s * d) / 2]}>
          <boxGeometry args={[w, 0.07, 0.07]} />
          <meshStandardMaterial color={steel} />
        </mesh>
      ))}
      {/* diagonal braces */}
      {[-1, 1].map((s) => (
        <mesh key={`b${s}`} position={[0, h / 2, (s * d) / 2]} rotation={[0, 0, Math.atan2(h, w)]}>
          <boxGeometry args={[Math.hypot(w, h), 0.06, 0.06]} />
          <meshStandardMaterial color={steel} />
        </mesh>
      ))}
      {/* stairs */}
      <mesh position={[w / 2 + 0.9, h / 2, 0]} rotation={[0, 0, -Math.atan2(h, 2)]} castShadow>
        <boxGeometry args={[Math.hypot(2, h), 0.1, 0.9]} />
        <meshStandardMaterial color="#5f6b70" />
      </mesh>
      {/* wheels */}
      {[[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]].map(([x, z]) => (
        <mesh key={`w${x}${z}`} position={[x, 0.15, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.15, 0.15, 0.1, 12]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
    </group>
  );
}

function GroundPowerUnit({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 0.85, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.6, 1.3, 1.4]} />
        <meshStandardMaterial color="#e3b31c" metalness={0.3} roughness={0.55} />
      </mesh>
      <mesh position={[0.2, 1.62, 0]} castShadow>
        <boxGeometry args={[1.8, 0.25, 1.2]} />
        <meshStandardMaterial color="#c79b15" />
      </mesh>
      <mesh position={[-1.25, 1.0, 0]}>
        <boxGeometry args={[0.05, 0.5, 0.8]} />
        <meshStandardMaterial color="#202426" />
      </mesh>
      {[[-0.9, -0.7], [0.9, -0.7], [-0.9, 0.7], [0.9, 0.7]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.22, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.22, 0.22, 0.16, 14]} />
          <meshStandardMaterial color="#111" />
        </mesh>
      ))}
      {/* power cable to the aircraft */}
      <mesh position={[3.4, 0.05, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.05, 0.05, 6, 6]} />
        <meshStandardMaterial color="#111" />
      </mesh>
    </group>
  );
}

function FireStation({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 2.6, 0]}>
        <boxGeometry args={[1.0, 1.0, 0.05]} />
        <meshStandardMaterial color="#c8102e" />
      </mesh>
      {[-0.22, 0.22].map((x) => (
        <mesh key={x} position={[x, 0.55, 0.25]} castShadow>
          <cylinderGeometry args={[0.15, 0.15, 0.9, 14]} />
          <meshStandardMaterial color="#c8102e" metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Sign({ position, rotation = 0, tex, w = 4, h = 1.5 }: { position: [number, number, number]; rotation?: number; tex: THREE.Texture; w?: number; h?: number }) {
  return (
    <mesh position={position} rotation={[0, rotation, 0]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={tex} toneMapped={false} />
    </mesh>
  );
}

// ------------------------------------------------------------------ main
export function HangarEnvironment({ lowPower, hideRoof, quality }: { lowPower?: boolean; hideRoof?: boolean; quality?: 'low' | 'high' }) {
  const high = (quality ?? (lowPower ? 'low' : 'high')) === 'high';
  const T = useMemo(
    () => ({
      floor: epoxyTexture(),
      wall: corrugatedTexture('#5d6970'),
      wallSide: corrugatedTexture('#4f5b62'),
      hazard: hazardTexture(),
      sky: skyTexture(),
      glow: glowTexture(),
      fod: signTexture('FOD CHECK', '#f2c230', '#16181a', 'FOREIGN OBJECT DEBRIS - KEEP AREA CLEAN'),
      smoke: signTexture('NO SMOKING', '#ffffff', '#c8102e', 'NO NAKED FLAMES'),
      bay: signTexture('BAY 2', '#0c3b5c', '#ffffff', 'NARROW-BODY MRO'),
      ppe: signTexture('PPE REQUIRED', '#1f7a3a', '#ffffff', 'HI-VIS · EAR · EYE'),
      floorBay: floorTextTexture('BAY 2'),
    }),
    [],
  );
  const mats = useMemo(
    () => ({
      steel: new THREE.MeshStandardMaterial({ color: '#3c4a54', metalness: 0.7, roughness: 0.45 }),
      truss: new THREE.MeshStandardMaterial({ color: '#6b7880', metalness: 0.65, roughness: 0.5 }),
      lamp: new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff4dc', emissiveIntensity: 3.2, toneMapped: false }),
      lampHousing: new THREE.MeshStandardMaterial({ color: '#2b3236', metalness: 0.6, roughness: 0.4 }),
      cone: new THREE.MeshStandardMaterial({ color: '#ff6a13', roughness: 0.6 }),
      chock: new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.7 }),
      cart: new THREE.MeshStandardMaterial({ color: '#b3161d', metalness: 0.4, roughness: 0.5 }),
      reel: new THREE.MeshStandardMaterial({ color: '#2f6fa8', metalness: 0.3, roughness: 0.6 }),
      glow: new THREE.MeshBasicMaterial({ map: T.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, opacity: 0.85 }),
    }),
    [T.glow],
  );
  const geos = useMemo(
    () => ({
      box: new THREE.BoxGeometry(1, 1, 1),
      lamp: new THREE.CylinderGeometry(0.75, 0.9, 0.18, 20),
      housing: new THREE.CylinderGeometry(0.95, 0.75, 0.6, 20),
      cone: new THREE.ConeGeometry(0.25, 0.7, 16),
      glow: new THREE.PlaneGeometry(1, 1),
      reel: new THREE.CylinderGeometry(0.55, 0.55, 0.5, 20),
    }),
    [],
  );

  // roof trusses every 8 m along x: rafters + bottom chord + verticals
  const trusses = useMemo(() => {
    const items: Xf[] = [];
    const slope = Math.atan2(RIDGE - EAVE, HZ);
    const rafterLen = Math.hypot(HZ, RIDGE - EAVE);
    for (let x = -HX + 4; x <= HX - 4; x += 8) {
      for (const s of [-1, 1]) items.push({ p: [x, (EAVE + RIDGE) / 2, (s * HZ) / 2], r: [s * slope, 0, 0], s: [0.35, 0.7, rafterLen] });
      items.push({ p: [x, EAVE, 0], s: [0.3, 0.4, HZ * 2] });
      for (let z = -HZ + 6; z <= HZ - 6; z += 6) {
        const top = EAVE + (RIDGE - EAVE) * (1 - Math.abs(z) / HZ);
        items.push({ p: [x, (EAVE + top) / 2, z], s: [0.18, top - EAVE, 0.18] });
      }
      for (const s of [-1, 1]) items.push({ p: [x, EAVE / 2, s * (HZ - 0.4)], s: [0.8, EAVE, 0.8] }); // columns
    }
    // purlins along x
    for (let z = -HZ + 3; z <= HZ - 3; z += 9) {
      const top = EAVE + (RIDGE - EAVE) * (1 - Math.abs(z) / HZ);
      items.push({ p: [0, top + 0.25, z], s: [HX * 2, 0.25, 0.25] });
    }
    return items;
  }, []);

  // high-bay lights: 3 rows across, every 12 m
  const lamps = useMemo(() => {
    const items: Xf[] = [];
    for (let x = -HX + 10; x <= HX - 8; x += 12) for (const z of [-24, 0, 24]) items.push({ p: [x, EAVE - 2.2, z] });
    return items;
  }, []);
  const glows = useMemo(() => lamps.map((l) => ({ p: [l.p[0], l.p[1] - 0.3, l.p[2]] as [number, number, number], r: [-Math.PI / 2, 0, 0] as [number, number, number], s: [5, 5, 1] as [number, number, number] })), [lamps]);

  const cones = useMemo<Xf[]>(() => [
    { p: [24, 0.35, -18] }, { p: [24, 0.35, 18] }, { p: [-22, 0.35, -20] }, { p: [-22, 0.35, 20] }, { p: [6, 0.35, -9] }, { p: [6, 0.35, 9] },
    { p: [-28, 0.35, -4] }, { p: [-28, 0.35, 4] }, { p: [30, 0.35, 0] },
  ], []);
  // chocks at nose gear (x 15.3) and main gear (x -3.1, z ±2.75)
  const chocks = useMemo<Xf[]>(() => {
    const at: [number, number][] = [[15.3, 0], [-3.1, -2.75], [-3.1, 2.75]];
    return at.flatMap(([x, z]) => [-0.75, 0.75].map((dx) => ({ p: [x + dx, 0.15, z] as [number, number, number], s: [0.35, 0.3, 0.9] as [number, number, number] })));
  }, []);
  const carts = useMemo<Xf[]>(() => [
    { p: [10, 0.6, -14], s: [1.4, 1.2, 0.7] }, { p: [-6, 0.6, 14], s: [1.4, 1.2, 0.7] }, { p: [44, 0.6, -38], s: [1.4, 1.2, 0.7] }, { p: [44, 0.6, -35.5], s: [1.4, 1.2, 0.7] },
  ], []);
  const reels = useMemo<Xf[]>(() => [{ p: [40, 0.55, 38], r: [Math.PI / 2, 0, 0] }, { p: [-40, 0.55, -40], r: [Math.PI / 2, 0, 0] }, { p: [12, 0.55, 16], r: [Math.PI / 2, 0, 0] }], []);

  const doorOpen = 20; // metres of opening in the middle of the door wall

  return (
    <group>
      {/* ---------------- lighting */}
      <hemisphereLight args={['#e8eef2', '#4a5257', 0.95]} />
      <ambientLight intensity={0.3} />
      <directionalLight
        ref={(l: THREE.DirectionalLight | null) => l?.shadow.camera.layers.enableAll()}
        position={[10, 40, 14]}
        intensity={1.9}
        color="#fff6e8"
        castShadow
        shadow-mapSize={high ? [2048, 2048] : [1024, 1024]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
        shadow-radius={high ? 6 : 2}
      />
      {/* daylight spilling in through the open doors */}
      <directionalLight position={[-90, 14, 0]} intensity={0.9} color="#cfe3f5" />
      {high && <pointLight position={[0, 12, 0]} intensity={180} distance={60} decay={2} color="#fff1d6" />}

      {/* ---------------- floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[HX * 2, HZ * 2]} />
        {high ? (
          <MeshReflectorMaterial
            map={T.floor}
            resolution={512}
            blur={[400, 120]}
            mixBlur={1}
            mixStrength={1.6}
            mixContrast={1}
            mirror={0.35}
            roughness={0.55}
            metalness={0.15}
            depthScale={0.6}
            minDepthThreshold={0.4}
            maxDepthThreshold={1.2}
            color="#a9b4b9"
          />
        ) : (
          <meshStandardMaterial map={T.floor} roughness={0.5} metalness={0.1} color="#a9b4b9" />
        )}
      </mesh>
      {/* apron outside the doors */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-HX - 60, -0.02, 0]}>
        <planeGeometry args={[120, 240]} />
        <meshStandardMaterial color="#5a6064" roughness={0.95} />
      </mesh>

      {/* ---------------- floor markings */}
      {/* hazard border of the inspection stand */}
      {[-1, 1].map((s) => (
        <mesh key={`hz${s}`} rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.012, s * 25]}>
          <planeGeometry args={[60, 0.45]} />
          <meshBasicMaterial map={T.hazard} toneMapped={false} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`hx${s}`} rotation={[-Math.PI / 2, 0, Math.PI / 2]} position={[2 + s * 30, 0.012, 0]}>
          <planeGeometry args={[50, 0.45]} />
          <meshBasicMaterial map={T.hazard} toneMapped={false} />
        </mesh>
      ))}
      {/* yellow lead-in centreline + stop bar + main-gear guides */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-20, 0.013, 0]}>
        <planeGeometry args={[84, 0.25]} />
        <meshBasicMaterial color="#f2c230" toneMapped={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[16.6, 0.014, 0]}>
        <planeGeometry args={[0.4, 4]} />
        <meshBasicMaterial color="#f2c230" toneMapped={false} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`mg${s}`} rotation={[-Math.PI / 2, 0, 0]} position={[-3.1, 0.014, s * 2.75]}>
          <planeGeometry args={[6, 0.18]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.7} />
        </mesh>
      ))}
      {/* walkway lines along the walls */}
      {[-1, 1].map((s) => (
        <mesh key={`wk${s}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, s * 40]}>
          <planeGeometry args={[HX * 2 - 6, 0.2]} />
          <meshBasicMaterial color="#2a8c4a" />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, -Math.PI / 2]} position={[26, 0.015, 0]}>
        <planeGeometry args={[8, 4]} />
        <meshBasicMaterial map={T.floorBay} transparent toneMapped={false} depthWrite={false} />
      </mesh>

      {/* ---------------- shell: back wall (nose side), side walls, door wall (tail side) */}
      <mesh position={[HX, EAVE / 2, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[HZ * 2, EAVE]} />
        <meshStandardMaterial map={T.wall} metalness={0.35} roughness={0.6} side={THREE.FrontSide} />
      </mesh>
      {/* gable end above back wall */}
      <mesh position={[HX - 0.05, EAVE, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <shapeGeometry args={[new THREE.Shape([new THREE.Vector2(-HZ, 0), new THREE.Vector2(HZ, 0), new THREE.Vector2(0, RIDGE - EAVE)])]} />
        <meshStandardMaterial color="#4f5b62" metalness={0.3} roughness={0.7} side={THREE.FrontSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`sw${s}`} position={[0, EAVE / 2, s * HZ]} rotation={[0, s > 0 ? Math.PI : 0, 0]} receiveShadow>
          <planeGeometry args={[HX * 2, EAVE]} />
          <meshStandardMaterial map={T.wallSide} metalness={0.35} roughness={0.6} side={THREE.FrontSide} />
        </mesh>
      ))}
      {/* sliding door leaves (partly open in the middle) */}
      {[-1, 1].map((s) => (
        <group key={`dr${s}`}>
          <mesh position={[-HX, EAVE / 2, s * (doorOpen / 2 + (HZ - doorOpen / 2) / 2)]} rotation={[0, Math.PI / 2, 0]} castShadow>
            <boxGeometry args={[HZ - doorOpen / 2, EAVE, 0.4]} />
            <meshStandardMaterial map={T.wall} color="#c9d1d6" metalness={0.35} roughness={0.55} />
          </mesh>
          {/* door track */}
          <mesh position={[-HX, EAVE + 0.4, s * HZ * 0.5]}>
            <boxGeometry args={[0.6, 0.6, HZ]} />
            <primitive object={mats.steel} attach="material" />
          </mesh>
        </group>
      ))}
      <mesh position={[-HX, EAVE + (RIDGE - EAVE) / 2 + 0.6, 0]} rotation={[0, Math.PI / 2, 0]}>
        <shapeGeometry args={[new THREE.Shape([new THREE.Vector2(-HZ, 0), new THREE.Vector2(HZ, 0), new THREE.Vector2(0, RIDGE - EAVE)])]} />
        <meshStandardMaterial color="#4f5b62" side={THREE.FrontSide} />
      </mesh>
      {/* sky seen through the opening */}
      <mesh position={[-HX - 110, 30, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[320, 90]} />
        <meshBasicMaterial map={T.sky} toneMapped={false} fog={false} />
      </mesh>

      {/* ---------------- roof (gabled) + trusses */}
      {!hideRoof && (
        <>
          {[-1, 1].map((s) => (
            <mesh key={`rf${s}`} position={[0, (EAVE + RIDGE) / 2 + 0.6, (s * HZ) / 2]} rotation={[Math.PI / 2 + s * Math.atan2(RIDGE - EAVE, HZ), 0, 0]}>
              <planeGeometry args={[HX * 2, Math.hypot(HZ, RIDGE - EAVE)]} />
              <meshStandardMaterial color="#39434a" roughness={0.9} side={THREE.FrontSide} />
            </mesh>
          ))}
          <Instances geometry={geos.box} material={mats.truss} items={trusses} />
          <Instances geometry={geos.housing} material={mats.lampHousing} items={lamps.map((l) => ({ p: [l.p[0], l.p[1] + 0.35, l.p[2]] as [number, number, number] }))} />
          <Instances geometry={geos.lamp} material={mats.lamp} items={lamps} />
          <Instances geometry={geos.glow} material={mats.glow} items={glows} />
        </>
      )}

      {/* ---------------- props */}
      <Scaffold position={[0.5, 0, -10.5]} rotation={0} h={2.4} w={4.5} d={2} />
      <Scaffold position={[0.5, 0, 10.5]} rotation={Math.PI} h={2.4} w={4.5} d={2} />
      <Scaffold position={[13, 0, -4.4]} rotation={0} h={3.2} w={3} d={1.6} />
      <Scaffold position={[-17.5, 0, 4.5]} rotation={Math.PI} h={7} w={3.2} d={2} />
      <GroundPowerUnit position={[19, 0, 7]} rotation={0.4} />
      <Instances geometry={geos.cone} material={mats.cone} items={cones} castShadow />
      <Instances geometry={geos.box} material={mats.chock} items={chocks} castShadow />
      <Instances geometry={geos.box} material={mats.cart} items={carts} castShadow />
      <Instances geometry={geos.reel} material={mats.reel} items={reels} castShadow />
      {/* workbench + tool wall along the back */}
      <mesh position={[HX - 1.2, 0.5, -30]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 1, 10]} />
        <meshStandardMaterial color="#5a4a3a" roughness={0.8} />
      </mesh>
      <mesh position={[HX - 0.2, 2.6, -30]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[10, 2.4]} />
        <meshStandardMaterial color="#3b4c58" roughness={0.6} />
      </mesh>
      <FireStation position={[HX - 0.3, 0, 12]} rotation={-Math.PI / 2} />
      <FireStation position={[20, 0, -HZ + 0.3]} />
      <FireStation position={[-30, 0, HZ - 0.3]} rotation={Math.PI} />
      <Sign tex={T.fod} position={[HX - 0.15, 7, 0]} rotation={-Math.PI / 2} w={9} h={3.4} />
      <Sign tex={T.bay} position={[HX - 0.15, 12.5, 0]} rotation={-Math.PI / 2} w={12} h={4.5} />
      <Sign tex={T.smoke} position={[0, 6, -HZ + 0.15]} w={6} h={2.25} />
      <Sign tex={T.ppe} position={[-24, 6, -HZ + 0.15]} w={6} h={2.25} />
      <Sign tex={T.smoke} position={[10, 6, HZ - 0.15]} rotation={Math.PI} w={6} h={2.25} />

      {/* ---------------- contact shadows + dust (high quality) */}
      {high && <ContactShadows position={[0, 0.02, 0]} scale={70} far={8} blur={2.2} opacity={0.55} resolution={512} frames={1} />}
      {high && <Sparkles count={160} scale={[90, 18, 70]} position={[0, 10, 0]} size={2.2} speed={0.15} opacity={0.35} color="#fff6e0" />}
    </group>
  );
}
