/**
 * Simulation configuration — single place to tune geometry, path and model integration.
 *
 * World frame: +X = aircraft nose (forward), +Y = up, +Z = aircraft RIGHT (starboard).
 * So the LEFT wing is at negative Z. Units are metres.
 */

export const AIRCRAFT = {
  /** Planform extents used to build a clearance-respecting oval path */
  noseX: 19.8,
  tailX: -19.9,
  wingTip: { x: -9.6, z: 15.6 }, // trailing tip corner (worst case for clearance)
  stabTip: { x: -19.2, z: 6.6 },
  fuselageY: 3.9,
  fuselageRadius: 2.0,
  verticalStabTopY: 11.6,
};

/** Line segments approximating the airframe; the gimbal looks at the closest point. */
export const AIRFRAME_SKELETON: [number, number, number, number, number, number][] = [
  [-18, 3.9, 0, 19, 3.9, 0], // fuselage centreline
  [-1, 2.8, -2.2, -8.6, 3.3, -15.4], // left wing
  [-1, 2.8, 2.2, -8.6, 3.3, 15.4], // right wing
  [1.6, 1.45, -6, -2.4, 1.45, -6], // left engine
  [1.6, 1.45, 6, -2.4, 1.45, 6], // right engine
  [-17, 4.6, -1, -19, 4.8, -6.5], // left horizontal stabiliser
  [-17, 4.6, 1, -19, 4.8, 6.5], // right horizontal stabiliser
  [-16.5, 5.6, 0, -18.7, 11.4, 0], // vertical stabiliser
];

/** Planform sample points used to compute the actual minimum horizontal clearance. */
export const PLANFORM_POINTS: [number, number][] = [
  [19.8, 0], [17, 1.6], [17, -1.6], [10, 2], [10, -2], [0, 2], [0, -2], [-12, 1.6], [-12, -1.6], [-19.9, 0],
  [1.6, -6.9], [1.6, 6.9], [-2.4, -6.9], [-2.4, 6.9],
  [-7.6, -15.6], [-9.6, -15.6], [-7.6, 15.6], [-9.6, 15.6], [-4, -10], [-4, 10],
  [-18.5, -6.6], [-19.6, -6.6], [-18.5, 6.6], [-19.6, 6.6],
];

/**
 * Inspection sections by fraction of the loop (u ∈ [0,1)).
 * Route: start beside LEFT wing → forward around NOSE → down the RIGHT side → around TAIL → back up the LEFT side.
 * These are simulated waypoints, not proof of physical coverage.
 */
export const SECTION_RANGES: { from: number; to: number; section: string }[] = [
  { from: 0.0, to: 0.07, section: 'Left Wing' },
  { from: 0.07, to: 0.16, section: 'Left Engine' },
  { from: 0.16, to: 0.34, section: 'Nose & Cockpit' },
  { from: 0.34, to: 0.43, section: 'Right Engine' },
  { from: 0.43, to: 0.57, section: 'Right Wing' },
  { from: 0.57, to: 0.66, section: 'Fuselage' },
  { from: 0.66, to: 0.72, section: 'Stabilizers' },
  { from: 0.72, to: 0.78, section: 'Tail' },
  { from: 0.78, to: 0.84, section: 'Stabilizers' },
  { from: 0.84, to: 0.93, section: 'Fuselage' },
  { from: 0.93, to: 1.0, section: 'Left Wing' },
];

export const MISSION_DEFAULTS = {
  speed: 3.0, // m/s
  clearance: 5.0, // m (minimum horizontal standoff)
  height: 4.5, // m AGL
  repeat: false,
  pathSamples: 72, // editable CatmullRom control points
  tailClimb: 3.0, // extra altitude around the tail to view the fin
  takeoffRate: 1.6, // m/s
  batteryReturnPct: 18,
};

export const LIMITS = {
  speed: [0.5, 8] as const,
  clearance: [2.5, 10] as const,
  height: [2, 10] as const,
};

/** Optional Blender exports. Missing files -> procedural models. */
export const MODELS = {
  aircraftUrl: '/models/aircraft.glb',
  droneUrl: '/models/drone.glb',
  aircraftTargetLength: 39.7,
  droneTargetSize: 1.5,
  /** If the exported aircraft points its nose toward -X, set true. */
  aircraftFlipNose: false,
  /** Node-name patterns that identify propellers in drone.glb (e.g. Quadcopter_Drone_Part05). */
  propellerPatterns: [/prop/i, /rotor/i, /blade/i] as RegExp[],
  /** Or list exact node names from the Blender outliner: */
  propellerNodes: [] as string[],
};
