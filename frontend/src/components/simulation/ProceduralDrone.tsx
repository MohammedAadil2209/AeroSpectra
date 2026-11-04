/**
 * Procedural quadcopter (stand-in for drone.glb). Local frame: forward +X, up +Y, right +Z.
 * Scaled ~1.5 m span for visibility in the scene (real inspection drones are smaller).
 * Exposes propeller groups via `propsRef` and the gimbal via `gimbalRef`.
 */
import { forwardRef, type MutableRefObject } from 'react';
import * as THREE from 'three';

const BODY = new THREE.MeshStandardMaterial({ color: '#1d2a33', metalness: 0.4, roughness: 0.45 });
const SHELL = new THREE.MeshStandardMaterial({ color: '#e9edf0', metalness: 0.2, roughness: 0.4 });
const ARM = new THREE.MeshStandardMaterial({ color: '#2b3a45', metalness: 0.5, roughness: 0.4 });
const MOTOR = new THREE.MeshStandardMaterial({ color: '#6c7780', metalness: 0.85, roughness: 0.25 });
const PROP = new THREE.MeshStandardMaterial({ color: '#0e1418', metalness: 0.1, roughness: 0.6, transparent: true, opacity: 0.92 });
const LENS = new THREE.MeshStandardMaterial({ color: '#05080b', metalness: 0.95, roughness: 0.05 });
const LED_RED = new THREE.MeshStandardMaterial({ color: '#c1121f', emissive: '#e5383b', emissiveIntensity: 2 });
const LED_GREEN = new THREE.MeshStandardMaterial({ color: '#2e8b57', emissive: '#4caf7d', emissiveIntensity: 2 });
const ACCENT = new THREE.MeshStandardMaterial({ color: '#669bbc', metalness: 0.3, roughness: 0.4 });

const ARMS: [number, number][] = [
  [0.48, 0.48], // front-right
  [0.48, -0.48], // front-left
  [-0.48, 0.48], // rear-right
  [-0.48, -0.48], // rear-left
];

export interface DroneHandles {
  props: MutableRefObject<THREE.Group[]>;
  gimbal: MutableRefObject<THREE.Group | null>;
}

export const ProceduralDrone = forwardRef<THREE.Group, DroneHandles>(function ProceduralDrone({ props, gimbal }, ref) {
  return (
    <group ref={ref} name="drone">
      {/* central body */}
      <mesh castShadow>
        <boxGeometry args={[0.46, 0.13, 0.3]} />
        <primitive object={BODY} attach="material" />
      </mesh>
      <mesh castShadow position={[0.02, 0.085, 0]} scale={[1, 0.38, 0.72]}>
        <sphereGeometry args={[0.24, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <primitive object={SHELL} attach="material" />
      </mesh>
      <mesh position={[-0.05, 0.075, 0]}>
        <boxGeometry args={[0.2, 0.02, 0.05]} />
        <primitive object={ACCENT} attach="material" />
      </mesh>
      {/* battery */}
      <mesh castShadow position={[-0.08, -0.09, 0]}>
        <boxGeometry args={[0.24, 0.06, 0.16]} />
        <primitive object={ARM} attach="material" />
      </mesh>

      {/* four arms, motors, propellers */}
      {ARMS.map(([x, z], i) => {
        const len = Math.hypot(x, z);
        const ang = Math.atan2(-z, x);
        return (
          <group key={i}>
            <mesh castShadow position={[x / 2, 0.01, z / 2]} rotation={[0, ang, Math.PI / 2]}>
              <cylinderGeometry args={[0.022, 0.026, len, 10]} />
              <primitive object={ARM} attach="material" />
            </mesh>
            <mesh castShadow position={[x, 0.04, z]}>
              <cylinderGeometry args={[0.045, 0.05, 0.075, 16]} />
              <primitive object={MOTOR} attach="material" />
            </mesh>
            <mesh position={[x, -0.03, z]}>
              <sphereGeometry args={[0.018, 8, 8]} />
              <primitive object={x > 0 ? (z > 0 ? LED_GREEN : LED_RED) : MOTOR} attach="material" />
            </mesh>
            <group
              position={[x, 0.085, z]}
              ref={(g) => {
                if (g) props.current[i] = g;
              }}
              userData={{ dir: i === 0 || i === 3 ? 1 : -1 }}
            >
              {[0, Math.PI].map((r) => (
                <mesh key={r} castShadow rotation={[0.12, r, 0]} position={[Math.cos(r) * 0.12, 0, -Math.sin(r) * 0.12]}>
                  <boxGeometry args={[0.24, 0.006, 0.035]} />
                  <primitive object={PROP} attach="material" />
                </mesh>
              ))}
              <mesh>
                <cylinderGeometry args={[0.018, 0.018, 0.03, 10]} />
                <primitive object={MOTOR} attach="material" />
              </mesh>
            </group>
          </group>
        );
      })}

      {/* landing supports */}
      {[-0.12, 0.12].map((z) => (
        <group key={z}>
          <mesh castShadow position={[0.06, -0.15, z]} rotation={[z > 0 ? -0.35 : 0.35, 0, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.2, 8]} />
            <primitive object={ARM} attach="material" />
          </mesh>
          <mesh castShadow position={[-0.12, -0.15, z]} rotation={[z > 0 ? -0.35 : 0.35, 0, 0]}>
            <cylinderGeometry args={[0.012, 0.012, 0.2, 8]} />
            <primitive object={ARM} attach="material" />
          </mesh>
          <mesh castShadow position={[-0.03, -0.24, z * 1.55]} rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.014, 0.014, 0.42, 8]} />
            <primitive object={ARM} attach="material" />
          </mesh>
        </group>
      ))}

      {/* front-mounted 2-axis gimbal + inspection camera (lens faces gimbal +Z for lookAt) */}
      <group position={[0.24, -0.1, 0]}>
        <mesh castShadow>
          <boxGeometry args={[0.04, 0.05, 0.08]} />
          <primitive object={ARM} attach="material" />
        </mesh>
        <group ref={gimbal} position={[0.02, -0.05, 0]}>
          <mesh castShadow>
            <sphereGeometry args={[0.055, 20, 16]} />
            <primitive object={SHELL} attach="material" />
          </mesh>
          <mesh position={[0, 0, 0.05]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.028, 0.032, 0.03, 20]} />
            <primitive object={LENS} attach="material" />
          </mesh>
        </group>
      </group>
    </group>
  );
});
