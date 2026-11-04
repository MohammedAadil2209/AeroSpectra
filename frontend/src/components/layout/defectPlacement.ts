/**
 * Maps a detection's inspection `section` (+ bbox / id for spread) onto the airframe surface.
 * Frame matches ProceduralAircraft: nose +X, up +Y, starboard (right) +Z, metres.
 * Placement is approximate — detections record a section, not a precise airframe coordinate.
 */
import * as THREE from 'three';
import type { Detection } from '@/types';

const FY = 3.9;
const FR = 2.0;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Deterministic 0..1 values from the detection id (FNV-1a). */
function hash(id: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

// nose radius profile (matches the fuselage lathe)
const NOSE: [number, number][] = [[12, 2.0], [14.5, 1.93], [16.3, 1.72], [17.8, 1.38], [18.9, 0.95]];
function noseRadius(x: number) {
  for (let i = 1; i < NOSE.length; i++) {
    const [x0, r0] = NOSE[i - 1], [x1, r1] = NOSE[i];
    if (x <= x1) return lerp(r0, r1, (x - x0) / (x1 - x0));
  }
  return NOSE[NOSE.length - 1][1];
}

/** Point on a fuselage-like ring; theta 0 = top, ±π/2 = sides. Returns point + outward normal. */
function ring(x: number, r: number, theta: number, cy = FY, cz = 0) {
  const n = new THREE.Vector3(0, Math.cos(theta), Math.sin(theta));
  return { p: new THREE.Vector3(x, cy + r * n.y, cz + r * n.z), n };
}

const WING_M = (side: 1 | -1) => new THREE.Matrix4().makeTranslation(0, FY - 1.15, 0).multiply(new THREE.Matrix4().makeRotationX(side * 0.085));

export interface Placement { position: THREE.Vector3; normal: THREE.Vector3 }

export function placeDetection(d: Detection): Placement {
  const u = Math.min(1, Math.max(0, d.bbox ? d.bbox.x + d.bbox.w / 2 : hash(d.id, 1)));
  const v = Math.min(1, Math.max(0, d.bbox ? d.bbox.y + d.bbox.h / 2 : hash(d.id, 2)));
  const h1 = hash(d.id, 3);
  const side: 1 | -1 = h1 < 0.5 ? -1 : 1;
  const s = d.section.toLowerCase();
  let out: { p: THREE.Vector3; n: THREE.Vector3 };

  if (s.includes('wing')) {
    const wSide: 1 | -1 = s.includes('left') ? -1 : 1;
    const t = 0.08 + u * 0.84; // span fraction
    const z = wSide * lerp(2.3, 15.4, t);
    const xLE = lerp(1.6, -7.6, t), xTE = lerp(-5.6, -9.6, t);
    const x = lerp(xLE, xTE, 0.15 + v * 0.7);
    const m = WING_M(wSide);
    out = { p: new THREE.Vector3(x, 0.2, z).applyMatrix4(m), n: new THREE.Vector3(0, 1, 0).transformDirection(m) };
  } else if (s.includes('engine')) {
    const eSide: 1 | -1 = s.includes('left') ? -1 : 1;
    const x = -0.4 + lerp(-1.6, 1.8, u);
    const theta = eSide * lerp(0.2, 2.2, v); // outboard / upper arc of nacelle
    out = ring(x, 0.95, theta, 1.45, eSide * 6);
  } else if (s.includes('nose') || s.includes('cockpit')) {
    const x = lerp(13, 18.6, u);
    out = ring(x, noseRadius(x) + 0.02, side * lerp(0.1, 1.9, v));
  } else if (s.includes('stabil')) {
    const t = 0.1 + u * 0.8;
    const z = side * lerp(1.2, 6.5, t);
    const x = lerp(lerp(-15.6, -18.5, t), -19.5, 0.15 + v * 0.7);
    out = { p: new THREE.Vector3(x, FY + 0.7 + 0.14, z), n: new THREE.Vector3(0, 1, 0) };
  } else if (s.includes('tail')) {
    if (h1 < 0.65) {
      // vertical fin, either face
      const t = 0.08 + v * 0.85;
      const x = lerp(lerp(-13.8, -17.6, t), lerp(-19.7, -19.2, t), 0.2 + u * 0.6);
      const fSide = hash(d.id, 4) < 0.5 ? -1 : 1;
      out = { p: new THREE.Vector3(x, FY + 1.25 + t * 6.4, fSide * 0.24), n: new THREE.Vector3(0, 0, fSide) };
    } else {
      const x = lerp(-11.5, -17.5, u);
      const r = x > -13.5 ? 1.85 : lerp(1.85, 1.0, (-13.5 - x) / 4);
      out = ring(x, r + 0.02, side * lerp(0.3, 1.9, v));
    }
  } else {
    // Fuselage (and any unknown section)
    const x = lerp(-10.5, 12, u);
    out = ring(x, FR + 0.02, side * lerp(0.15, 2.0, v));
  }
  return { position: out.p, normal: out.n.normalize() };
}
