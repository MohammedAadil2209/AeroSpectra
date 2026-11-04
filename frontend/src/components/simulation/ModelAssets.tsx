/**
 * Optional GLB integration. If /models/aircraft.glb or /models/drone.glb exist (exported from
 * AeroSpectra.blend), they replace the procedural models; otherwise procedural models are used.
 */
import { Component, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { MODELS } from './simulationConfig';

export type ModelSource = 'checking' | 'glb' | 'procedural';

/** HEAD-probe a model URL. Vite's SPA fallback returns text/html for missing files. */
export function useModelAvailable(url: string): ModelSource {
  const [state, setState] = useState<ModelSource>('checking');
  useEffect(() => {
    let alive = true;
    fetch(url, { method: 'HEAD' })
      .then((r) => {
        const ct = r.headers.get('content-type') ?? '';
        alive && setState(r.ok && !ct.includes('text/html') ? 'glb' : 'procedural');
      })
      .catch(() => alive && setState('procedural'));
    return () => {
      alive = false;
    };
  }, [url]);
  return state;
}

class ModelErrorBoundary extends Component<{ fallback: ReactNode; onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function fitObject(obj: THREE.Object3D, targetSize: number, axis: 'length' | 'max', alignX: boolean, flip: boolean) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  if (alignX && size.z > size.x) {
    obj.rotation.y = -Math.PI / 2;
  }
  if (flip) obj.rotation.y += Math.PI;
  obj.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(obj);
  const s2 = b2.getSize(new THREE.Vector3());
  const ref = axis === 'length' ? s2.x : Math.max(s2.x, s2.y, s2.z);
  const k = ref > 0 ? targetSize / ref : 1;
  obj.scale.multiplyScalar(k);
  obj.updateMatrixWorld(true);
  const b3 = new THREE.Box3().setFromObject(obj);
  const c = b3.getCenter(new THREE.Vector3());
  obj.position.x -= c.x;
  obj.position.z -= c.z;
  obj.position.y -= axis === 'length' ? b3.min.y : c.y;
}

function GltfAircraft() {
  const { scene } = useGLTF(MODELS.aircraftUrl);
  const obj = useMemo(() => {
    const o = scene.clone(true);
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
    const wrapper = new THREE.Group();
    wrapper.add(o);
    fitObject(o, MODELS.aircraftTargetLength, 'length', true, MODELS.aircraftFlipNose);
    return wrapper;
  }, [scene]);
  return <primitive object={obj} />;
}

export function AircraftModel({ procedural, onSource }: { procedural: ReactNode; onSource?: (s: ModelSource) => void }) {
  const avail = useModelAvailable(MODELS.aircraftUrl);
  const [failed, setFailed] = useState(false);
  const source: ModelSource = failed ? 'procedural' : avail;
  useEffect(() => onSource?.(source), [source, onSource]);
  if (source !== 'glb') return <>{procedural}</>;
  return (
    <ModelErrorBoundary fallback={procedural} onError={() => setFailed(true)}>
      <Suspense fallback={procedural}>
        <GltfAircraft />
      </Suspense>
    </ModelErrorBoundary>
  );
}

/** Loads drone.glb, fits it, and collects propeller nodes for spinning. */
export function GltfDrone({ onProps }: { onProps: (props: THREE.Object3D[]) => void }) {
  const { scene } = useGLTF(MODELS.droneUrl);
  const obj = useMemo(() => {
    const o = scene.clone(true);
    const props: THREE.Object3D[] = [];
    o.traverse((m) => {
      if ((m as THREE.Mesh).isMesh) m.castShadow = true;
      if (MODELS.propellerNodes.includes(m.name) || MODELS.propellerPatterns.some((p) => p.test(m.name))) props.push(m);
    });
    const wrapper = new THREE.Group();
    wrapper.add(o);
    fitObject(o, MODELS.droneTargetSize, 'max', false, false);
    (wrapper.userData as { props: THREE.Object3D[] }).props = props;
    return wrapper;
  }, [scene]);
  useEffect(() => onProps((obj.userData as { props: THREE.Object3D[] }).props), [obj, onProps]);
  return <primitive object={obj} />;
}

export { ModelErrorBoundary };
