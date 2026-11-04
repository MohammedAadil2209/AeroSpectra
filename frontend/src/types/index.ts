// API contract — mirrors backend/app/schemas/api.py

export type Category = 'crack' | 'dent' | 'corrosion';
export type ReviewStatus = 'pending' | 'reviewed' | 'confirmed' | 'false_positive';
export type SourceType = 'camera' | 'upload' | 'simulation';
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
}

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

export interface Health {
  status: string;
  version: string;
  time: string;
  database: ComponentStatus;
  ai_model: ComponentStatus;
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
  trend: { date: string; inspections: number; crack: number; dent: number; corrosion: number }[];
  confidence_histogram: { range: string; count: number }[];
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

export type WsEvent =
  | { type: 'connection'; data: { status: string; active_inspection: ActiveInspection | null; ai_model: string } }
  | { type: 'pong'; data: { active_inspection: ActiveInspection | null } }
  | { type: 'inspection_started'; data: { inspection: Partial<Inspection>; detector: string } }
  | { type: 'inspection_paused'; data: { inspection_id: string } }
  | { type: 'inspection_resumed'; data: { inspection_id: string } }
  | { type: 'inspection_stopped'; data: { inspection_id: string; status: string; reason: string; error: string | null; detections: number } }
  | { type: 'recording_status'; data: { inspection_id: string; recording: boolean; recording_url: string | null } }
  | { type: 'frame'; data: { inspection_id: string; frame: number; video_time_s: number; elapsed_s: number; fps: number; detections: number; section: string } }
  | { type: 'detection'; data: { detection: Detection } }
  | { type: 'detection_reviewed'; data: { detection: Detection } }
  | { type: 'error'; data: { message: string } };
