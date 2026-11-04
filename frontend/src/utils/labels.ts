import type { Category, DetectionMode, InspectionStatus, Priority, ReviewStatus, SourceType } from '@/types';

export const CATEGORIES: Category[] = ['crack', 'dent', 'corrosion'];
export const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'reviewed', 'confirmed', 'false_positive'];

export const CATEGORY_LABEL: Record<Category, string> = { crack: 'Crack', dent: 'Dent', corrosion: 'Corrosion' };
/** Validated categorical palette (CVD ΔE ≥ 10, all pairs, dark surface). Fixed order. */
export const CATEGORY_COLOR: Record<Category, string> = {
  crack: '#d3263a',
  dent: '#4f9bd4',
  corrosion: '#af911a',
};

export const REVIEW_LABEL: Record<ReviewStatus, string> = {
  pending: 'Pending Review',
  reviewed: 'Reviewed',
  confirmed: 'Confirmed',
  false_positive: 'False Positive',
};

/** chip styles: [text, bg, border] */
export const REVIEW_STYLE: Record<ReviewStatus, string> = {
  pending: 'text-warn-ink bg-[#e0a43a]/12 border-[#e0a43a]/35',
  reviewed: 'text-steel-bright bg-steel/12 border-steel/35',
  confirmed: 'text-crit-ink bg-crimson/20 border-crimson/50',
  false_positive: 'text-muted bg-ink/5 border-ink/12',
};

export const PRIORITY_LABEL: Record<Priority, string> = { high: 'High', medium: 'Medium', low: 'Low' };
export const PRIORITY_STYLE: Record<Priority, string> = {
  high: 'text-white bg-crimson border-crimson',
  medium: 'text-warn-ink bg-[#e0a43a]/12 border-[#e0a43a]/35',
  low: 'text-ink-2 bg-ink/5 border-ink/12',
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  camera: 'Live Camera',
  upload: 'Uploaded Video',
  simulation: 'Simulation',
};

export const DETECTION_MODE_LABEL: Record<DetectionMode, string> = {
  ai: 'AI model (YOLO)',
  simulated: 'Simulated detections',
  none: 'No AI model loaded',
};

export const INSPECTION_STATUS_STYLE: Record<InspectionStatus, string> = {
  active: 'text-ok-ink bg-ok/12 border-ok/35',
  paused: 'text-warn-ink bg-[#e0a43a]/12 border-[#e0a43a]/35',
  completed: 'text-steel-bright bg-steel/12 border-steel/35',
  aborted: 'text-warn-ink bg-[#e0a43a]/10 border-[#e0a43a]/30',
  failed: 'text-crit-ink bg-crimson/20 border-crimson/50',
};

export const SECTIONS = [
  'Nose & Cockpit',
  'Left Wing',
  'Left Engine',
  'Right Wing',
  'Right Engine',
  'Fuselage',
  'Tail',
  'Stabilizers',
] as const;
