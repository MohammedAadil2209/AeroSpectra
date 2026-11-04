/** Inspection hangar: floor, stand markings, structure and lighting. */
import { useMemo } from 'react';
import * as THREE from 'three';

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#26323b';
  g.fillRect(0, 0, 1024, 1024);
  // concrete mottling
  for (let i = 0; i < 9000; i++) {
    const v = 30 + Math.random() * 22;
    g.fillStyle = `rgba(${v + 8},${v + 16},${v + 22},${Math.random() * 0.18})`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // slab joints
  g.strokeStyle = 'rgba(10,16,20,.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 1024; i += 128) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 1024); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(1024, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function HangarEnvironment({ lowPower, hideRoof }: { lowPower?: boolean; hideRoof?: boolean }) {
  const tex = useMemo(floorTexture, []);
  return (
    <group>
      <hemisphereLight args={['#bcd3e6', '#1a2229', 0.75]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        ref={(l: THREE.DirectionalLight | null) => l?.shadow.camera.layers.enableAll()}
        position={[22, 38, 16]}
        intensity={2.3}
        castShadow
        shadow-mapSize={lowPower ? [1024, 1024] : [2048, 2048]}
        shadow-camera-left={-36}
        shadow-camera-right={36}
        shadow-camera-top={36}
        shadow-camera-bottom={-36}
        shadow-camera-near={1}
        shadow-camera-far={110}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[-25, 18, -20]} intensity={0.55} color="#9fc3dd" />

      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[220, 220]} />
        <meshStandardMaterial map={tex} roughness={0.92} metalness={0.05} />
      </mesh>

      {/* stand markings: centreline + inspection zone (cream) and safety boundary (crimson) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[62, 0.22]} />
        <meshBasicMaterial color="#fdf0d5" transparent opacity={0.55} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, s * 26]}>
          <planeGeometry args={[66, 0.18]} />
          <meshBasicMaterial color="#c1121f" transparent opacity={0.7} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={`x${s}`} rotation={[-Math.PI / 2, 0, 0]} position={[s * 33, 0.012, 0]}>
          <planeGeometry args={[0.18, 52]} />
          <meshBasicMaterial color="#c1121f" transparent opacity={0.7} />
        </mesh>
      ))}

      {/* hangar structure: back wall, columns, roof trusses with light panels */}
      <mesh position={[0, 14, -48]} receiveShadow>
        <boxGeometry args={[140, 28, 0.6]} />
        <meshStandardMaterial color="#13212b" roughness={0.9} />
      </mesh>
      {[-60, -36, -12, 12, 36, 60].map((x) => (
        <group key={x}>
          <mesh position={[x, 14, -47]} castShadow>
            <boxGeometry args={[1.2, 28, 1.2]} />
            <meshStandardMaterial color="#2a3a46" metalness={0.6} roughness={0.5} />
          </mesh>
          <mesh position={[x, 27.5, -8]} visible={!hideRoof}>
            <boxGeometry args={[0.8, 0.9, 80]} />
            <meshStandardMaterial color="#2a3a46" metalness={0.6} roughness={0.5} />
          </mesh>
          {!lowPower && !hideRoof && [-30, -10, 10].map((z) => (
            <mesh key={z} position={[x + 12, 26.9, z]} rotation={[Math.PI / 2, 0, 0]}>
              <planeGeometry args={[6, 1.2]} />
              <meshBasicMaterial color="#eaf3fb" side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      ))}
      {/* side wall (left, far) */}
      <mesh position={[-70, 14, -8]} rotation={[0, Math.PI / 2, 0]}>
        <boxGeometry args={[80, 28, 0.6]} />
        <meshStandardMaterial color="#101d26" roughness={0.9} />
      </mesh>
      {/* ground equipment for scale: maintenance stand */}
      <group position={[24, 0, -18]}>
        <mesh castShadow position={[0, 1.4, 0]}>
          <boxGeometry args={[3, 0.15, 1.6]} />
          <meshStandardMaterial color="#669bbc" metalness={0.4} roughness={0.5} />
        </mesh>
        {[[-1.4, -0.7], [1.4, -0.7], [-1.4, 0.7], [1.4, 0.7]].map(([x, z]) => (
          <mesh key={`${x}${z}`} castShadow position={[x, 0.7, z]}>
            <boxGeometry args={[0.1, 1.4, 0.1]} />
            <meshStandardMaterial color="#2a3a46" />
          </mesh>
        ))}
      </group>
    </group>
  );
}
