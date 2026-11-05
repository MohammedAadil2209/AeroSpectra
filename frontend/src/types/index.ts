// API contract — mirrors backend/app/schemas/api.py

export type Category = 'crack' | 'dent' | 'corrosion' | 'defect';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type MaintenanceStatus = 'detected' | 'confirmed' | 'work_order' | 'repair_in_progress' | 'repaired' | 'cleared' | 'false_positive' | 'deferred';
export type ReviewStatus = 'pending' | 'reviewed' | 'confirmed' | 'false_positive';
export type SourceType = 'camera' | 'upload' | 'simulation' | 'drone_direct';
export type DataScope = 'demo' | 'real';
export type Priority = 'high' | 'medium' | 'low';
export type DetectionOrigin = 'ai' | 'simulated';
export type DetectionMode = 'ai' | 'simulated' | 'none';
export type InspectionStatus = 'active' | 'paused' | 'completed' | 'aborted' | 'failed';

export interface BBox {
  x: number; y: number; w: number; h: number; // normalised 0..1
  frame_w?: number; frame_h?: number;
}

export interface Aircraft {
  id: string;
  registration: string;
  model: string;
  operator: string;
  base: string;
  is_demo: boolean;
  inspection_count: number;
  finding_count: number;
  open_finding_count: number;
  last_inspection_at: string | null;
}

export interface Detection {
  id: string;
  inspection_id: string;
  aircraft_id: string;
  category: Category;
  confidence: number;
  detected_at: string;
  video_time_s: number;
  bbox: BBox;
  section: string;
  priority: Priority;
  evidence_url: string | null;
  origin: DetectionOrigin;
  model_name: string;
  review_status: ReviewStatus;
  reviewer: string | null;
  reviewer_notes: string;
  reviewed_at: string | null;
  is_demo: boolean;
  // v1.1 - risk engine (advisory), cost estimate, maintenance lifecycle
  risk_score?: number;
  risk_level?: RiskLevel;
  risk_breakdown?: RiskBreakdown;
  recommendation?: string;
  cost_min?: number;
  cost_max?: number;
  labour_hours?: number;
  maintenance_status?: MaintenanceStatus;
  actual_cost?: number | null;
  actual_labour_hours?: number | null;
  repair_photo_url?: string | null;
  cleared_at?: string | null;
  cleared_by?: string | null;
  original_category?: string | null;
  thumb_url?: string | null;
}

export interface RiskFactor { value: number; weight: number; points: number }
export type RiskBreakdown = Partial<Record<'severity' | 'size' | 'section' | 'confidence' | 'cluster' | 'recurrence', RiskFactor>> & {
  _context?: { neighbours: number; prior_findings: number; area_pct: number };
};

export interface Inspection {
  id: string;
  aircraft_id: string;
  source: SourceType;
  source_detail: string;
  status: InspectionStatus;
  detection_mode: DetectionMode;
  started_at: string;
  ended_at: string | null;
  duration_s: number;
  frames_processed: number;
  sections_inspected: string[];
  recording_url: string | null;
  notes: string;
  error: string | null;
  is_demo: boolean;
  detection_count: number;
}

export interface InspectionDetail extends Inspection {
  aircraft: Aircraft;
  detections: Detection[];
}

export interface ComponentStatus {
  status: 'online' | 'offline' | 'degraded' | 'not_configured' | 'unavailable';
  detail: string;
}

export interface AIInfo extends ComponentStatus {
  model?: string | null;
  device?: string | null;
  half?: boolean;
  inference_fps?: number;
  inference_ms?: number;
  confidence?: number;
  infer_every?: number;
  model_card?: ModelCard | null;
  classes?: string[];
  scene_gate?: boolean;
  gate_loaded?: boolean;
  gate_suppressed?: number;
  confirm_hits?: number;
}

export interface ModelCard {
  model_name: string;
  base_model: string;
  classes: string[];
  train_date: string;
  dataset_size: Record<string, number>;
  metrics: { precision: number; recall: number; mAP50: number; 'mAP50-95': number; split?: string };
  device: string;
  epochs_trained?: number;
  notes?: string;
  per_class?: Record<string, { precision: number; recall: number; mAP50: number; 'mAP50-95': number }>;
  negatives_in_training?: number;
}

export interface Health {
  status: string;
  version: string;
  time: string;
  database: ComponentStatus;
  ai_model: AIInfo;
  camera: ComponentStatus;
  active_inspection_id: string | null;
  websocket_clients: number;
}

export interface Analytics {
  scope: DataScope;
  total_inspections: number;
  completed_inspections: number;
  active_inspections: number;
  total_detections: number;
  high_priority: number;
  pending_reviews: number;
  reviewed: number;
  confirmed: number;
  false_positives: number;
  by_category: Record<Category, number>;
  by_status: Record<ReviewStatus, number>;
  by_section: Record<string, number>;
  trend: { date: string; inspections: number; crack: number; dent: number; corrosion: number; defect?: number }[];
  confidence_histogram: { range: string; count: number }[];
  by_risk?: Record<RiskLevel, number>;
  by_maintenance?: Partial<Record<MaintenanceStatus, number>>;
  open_defects?: number;
  cleared_defects?: number;
  open_vs_cleared_trend?: { date: string; new: number; cleared: number; open: number }[];
  estimated_cost_min?: number;
  estimated_cost_max?: number;
  actual_cost?: number;
  currency?: string;
}

export interface ActiveInspection {
  inspection_id: string;
  aircraft_id: string;
  source: SourceType;
  detection_mode: DetectionMode;
  detector: string;
  status: 'active' | 'paused';
  recording: boolean;
  frames: number;
  detections: number;
  elapsed_s: number;
  section: string;
  is_demo: boolean;
  started_at?: string;
  source_fps?: number;
  inference_fps?: number;
  inference_ms?: number;
  connected?: boolean;
  reconnects?: number;
  risk_counts?: Record<RiskLevel, number>;
  cost_min?: number;
  cost_max?: number;
}

export interface UploadInfo {
  upload_id: string;
  filename: string;
  size_bytes: number;
  frames: number;
  fps: number;
  width: number;
  height: number;
  duration_s: number;
}

export interface DetectionFilters {
  category?: Category | '';
  review_status?: ReviewStatus | '';
  aircraft_id?: string;
  inspection_id?: string;
  min_confidence?: number;
  max_confidence?: number;
  date_from?: string;
  date_to?: string;
  q?: string;
}

export interface InspectionProgress {
  inspection_id: string;
  status: 'active' | 'paused';
  detection_count?: number;
  duration_s?: number;
  frames_processed?: number;
  sections_inspected?: string[];
  risk_counts?: Record<RiskLevel, number>;
  cost_min?: number;
  cost_max?: number;
}

export interface FrameMeta {
  inspection_id: string; frame: number; video_time_s: number; elapsed_s: number; fps: number; detections: number; section: string;
  inference_fps?: number; inference_ms?: number; connected?: boolean; reconnects?: number;
  risk_counts?: Record<RiskLevel, number>; cost_min?: number; cost_max?: number;
}

export interface MaintenanceEvent {
  id: string; detection_id: string; aircraft_id: string; from_status: MaintenanceStatus; to_status: MaintenanceStatus;
  actor: string; at: string; notes: string; reason: string; actual_cost: number | null; actual_labour_hours: number | null;
  photo_url: string | null; is_demo: boolean;
}

/** Typed real-time event bus (backend app/services/events.py). */
export type WsEvent =
  | { type: 'connection'; data: { status: string; active_inspection: ActiveInspection | null; ai_model: string; ai?: AIInfo } }
  | { type: 'pong'; data: { active_inspection: ActiveInspection | null } }
  | { type: 'inspection.started'; data: { inspection: Inspection; detector: string; active: ActiveInspection | null } }
  | { type: 'inspection.updated'; data: InspectionProgress }
  | { type: 'inspection.ended'; data: { inspection_id: string; status: string; reason: string; error: string | null; detections: number; inspection: Inspection | null } }
  | { type: 'recording.status'; data: { inspection_id: string; recording: boolean; recording_url: string | null } }
  | { type: 'frame'; data: FrameMeta }
  | { type: 'detection.created'; data: { detection: Detection } }
  | { type: 'defect.updated'; data: { detection: Detection } }
  | { type: 'maintenance.updated'; data: { detection: Detection; event: MaintenanceEvent | null } }
  | { type: 'risk.updated'; data: { version?: number; key?: string; changed?: number; counts?: Record<RiskLevel, number>; preview?: boolean; scope?: DataScope } }
  | { type: 'settings.updated'; data: { key: string; version: number; updated_by: string } }
  | { type: 'kpi.updated'; data: { scope: DataScope; analytics: Analytics } }
  | { type: 'ai.updated'; data: { ai: AIInfo } }
  | { type: 'error'; data: { message: string } };
