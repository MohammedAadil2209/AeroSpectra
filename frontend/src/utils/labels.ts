import type { Category, DetectionMode, InspectionStatus, MaintenanceStatus, Priority, ReviewStatus, RiskLevel, SourceType } from '@/types';

export const CATEGORIES: Category[] = ['crack', 'dent', 'corrosion', 'defect'];
export const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'reviewed', 'confirmed', 'false_positive'];

export const CATEGORY_LABEL: Record<Category, string> = { crack: 'Crack', dent: 'Dent', corrosion: 'Corrosion', defect: 'Defect' };
/** Validated categorical palette (CVD ΔE ≥ 10, all pairs, dark surface). Fixed order. */
export const CATEGORY_COLOR: Record<Category, string> = {
  crack: '#d3263a',
  dent: '#4f9bd4',
  corrosion: '#af911a',
  // generic single-class AI output: light teal, separated from the others by lightness as well as hue (CVD-safe)
  defect: '#41c9b0',
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
  drone_direct: 'Drone (direct Wi-Fi)',
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

export const RISK_LEVELS: RiskLevel[] = ['low', 'medium', 'high', 'critical'];
export const RISK_LABEL: Record<RiskLevel, string> = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
/** Ordinal ramp (light to dark, CVD-safe by lightness). */
export const RISK_COLOR: Record<RiskLevel, string> = { low: '#8aa4b8', medium: '#e0a43a', high: '#e0663a', critical: '#c8102e' };
export const RISK_STYLE: Record<RiskLevel, string> = {
  low: 'text-ink-2 bg-ink/5 border-ink/15',
  medium: 'text-warn-ink bg-[#e0a43a]/15 border-[#e0a43a]/45',
  high: 'text-white bg-[#c4501f] border-[#c4501f]',
  critical: 'text-white bg-[#a50d24] border-[#a50d24]',
};
export const RISK_FACTORS = ['severity', 'size', 'section', 'confidence', 'cluster', 'recurrence'] as const;
export const RISK_FACTOR_LABEL: Record<string, string> = {
  severity: 'Defect type severity',
  size: 'Relative size',
  section: 'Section criticality',
  confidence: 'AI confidence',
  cluster: 'Clustering',
  recurrence: 'Recurrence (history)',
};
export const RISK_FACTOR_COLOR: Record<string, string> = {
  severity: '#c8102e', size: '#e0663a', section: '#4f9bd4', confidence: '#41c9b0', cluster: '#af911a', recurrence: '#9b7fd4',
};

export const MAINTENANCE_STATUSES: MaintenanceStatus[] = ['detected', 'confirmed', 'work_order', 'repair_in_progress', 'repaired', 'cleared', 'false_positive', 'deferred'];
export const MAINTENANCE_LABEL: Record<MaintenanceStatus, string> = {
  detected: 'Detected',
  confirmed: 'Confirmed',
  work_order: 'Work order raised',
  repair_in_progress: 'Repair in progress',
  repaired: 'Repaired',
  cleared: 'Verified & Cleared',
  false_positive: 'False positive',
  deferred: 'Deferred',
};
export const MAINTENANCE_FLOW: MaintenanceStatus[] = ['detected', 'confirmed', 'work_order', 'repair_in_progress', 'repaired', 'cleared'];
export const MAINTENANCE_TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  detected: ['confirmed', 'false_positive', 'deferred'],
  confirmed: ['work_order', 'deferred', 'false_positive'],
  work_order: ['repair_in_progress', 'deferred'],
  repair_in_progress: ['repaired', 'deferred'],
  repaired: ['cleared', 'repair_in_progress'],
  cleared: [],
  false_positive: ['detected'],
  deferred: ['confirmed', 'work_order', 'detected'],
};
export const OPEN_MAINTENANCE = new Set<MaintenanceStatus>(['detected', 'confirmed', 'work_order', 'repair_in_progress', 'repaired', 'deferred']);
export const MAINTENANCE_STYLE: Record<MaintenanceStatus, string> = {
  detected: 'text-warn-ink bg-[#e0a43a]/12 border-[#e0a43a]/35',
  confirmed: 'text-crit-ink bg-crimson/15 border-crimson/40',
  work_order: 'text-steel-bright bg-steel/12 border-steel/35',
  repair_in_progress: 'text-steel-bright bg-steel/20 border-steel/50',
  repaired: 'text-ok-ink bg-ok/10 border-ok/30',
  cleared: 'text-ok-ink bg-ok/20 border-ok/50',
  false_positive: 'text-muted bg-ink/5 border-ink/12',
  deferred: 'text-muted bg-ink/8 border-ink/20',
};
