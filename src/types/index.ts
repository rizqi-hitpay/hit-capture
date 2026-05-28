// ─── Capture ──────────────────────────────────────────────────────────────────

export type RawEventKind = 'move' | 'down' | 'up' | 'scroll';

export interface RawEvent {
  /** Abbreviated event kind for compact JSON */
  k: RawEventKind;
  /** performance.now() ms, relative to recording start */
  t: number;
  /** clientX (CSS pixels) */
  x: number;
  /** clientY (CSS pixels) */
  y: number;
  /** scrollX delta (scroll events only) */
  sx?: number;
  /** scrollY delta (scroll events only) */
  sy?: number;
  /** pointer button (0=left, 1=middle, 2=right) */
  b?: number;
}

export interface CaptureSession {
  version: 1;
  /** ISO timestamp of recording start (wall clock reference) */
  startedAt: string;
  durationMs: number;
  viewport: { w: number; h: number; dpr: number };
  events: RawEvent[];
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface PipelineParams {
  /** 0–1; scales smoothing intensity */
  smoothingStrength: number;
  /** px; cursor movement threshold for dwell detection */
  dwellThresholdPx: number;
  /** ms; dwell duration threshold */
  dwellThresholdMs: number;
  /** ms; idle gaps longer than this are compressed */
  hesitationThresholdMs: number;
  /** ms; idle gaps are compressed to this duration */
  hesitationTargetMs: number;
  /** px; cursor overshoot distance on click */
  clickOvershootPx: number;
  /** ms; time to settle back to click coords after overshoot */
  clickSettleMs: number;
  /** One-Euro filter minCutoff base */
  oneEuroMinCutoff: number;
  /** One-Euro filter beta (speed-adaptive gain) */
  oneEuroBeta: number;
}

export interface ResampledPoint {
  /** ms on 120Hz internal timebase */
  t: number;
  x: number;
  y: number;
}

export interface DwellEvent {
  t: number;
  x: number;
  y: number;
  durationMs: number;
}

export interface ClickEvent {
  t: number;
  x: number;
  y: number;
  button: number;
}

export interface PolishedPoint {
  /** ms on the trimmed/compressed timebase */
  t: number;
  x: number;
  y: number;
}

export interface PolishedTrack {
  points: PolishedPoint[];
  dwells: DwellEvent[];
  clicks: ClickEvent[];
  totalDurationMs: number;
}

// ─── Scene / Render ──────────────────────────────────────────────────────────

export type GradientPresetId = 'dawn' | 'dusk' | 'ocean' | 'forest' | 'slate';

export interface GradientStop {
  offset: number;
  color: string;
}

export interface GradientDef {
  id: GradientPresetId;
  label: string;
  stops: GradientStop[];
  angleDeg: number;
}

export interface FloatingWindowConfig {
  /** px padding around video window */
  paddingPx: number;
  /** px border radius on the floating window */
  cornerRadiusPx: number;
  /** shadow blur radius */
  shadowBlur: number;
  /** shadow opacity 0–1 */
  shadowAlpha: number;
}

export interface AutoZoomConfig {
  enabled: boolean;
  /** 0–1; scales zoom magnitude */
  sensitivity: number;
  /** max zoom multiplier, e.g. 1.6 */
  maxZoom: number;
  /** ms; camera ease-in/out duration */
  easeDurationMs: number;
}

export interface SceneConfig {
  outputWidth: number;
  outputHeight: number;
  gradient: GradientPresetId;
  window: FloatingWindowConfig;
  autoZoom: AutoZoomConfig;
  /** cursor scale multiplier (1.0 = native) */
  cursorScale: number;
}

// ─── Render frame ─────────────────────────────────────────────────────────────

export interface CameraState {
  scale: number;
  /** translate X in canvas pixels */
  tx: number;
  /** translate Y in canvas pixels */
  ty: number;
}

export interface RenderFrameData {
  videoSource: HTMLVideoElement | ImageBitmap | OffscreenCanvas | VideoFrame;
  cursorX: number;
  cursorY: number;
  isClick: boolean;
  /** 0–1 animation progress for click ripple */
  clickProgress: number;
  camera: CameraState;
  t: number;
}

// ─── Coordinate transform ────────────────────────────────────────────────────

export interface CoordTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

// ─── Editor state ─────────────────────────────────────────────────────────────

export type EditorPhase =
  | 'empty'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'exporting';

export interface EditorState {
  phase: EditorPhase;
  videoFile: File | null;
  session: CaptureSession | null;
  pipelineParams: PipelineParams;
  sceneConfig: SceneConfig;
  polishedTrack: PolishedTrack | null;
  coordTransform: CoordTransform;
  autoAligned: boolean;
  showRawCursor: boolean;
  exportProgress: number;
  error: string | null;
}

// ─── Worker messages ──────────────────────────────────────────────────────────

export interface PipelineWorkerIn {
  type: 'RUN_PIPELINE';
  events: RawEvent[];
  params: PipelineParams;
  viewport: CaptureSession['viewport'];
}

export type PipelineWorkerOut =
  | { type: 'DONE'; track: PolishedTrack }
  | { type: 'ERROR'; message: string };

export interface EncodeWorkerIn {
  type: 'START_ENCODE';
  videoFile: File;
  track: PolishedTrack;
  sceneConfig: SceneConfig;
  session: CaptureSession;
  coordTransform: CoordTransform;
}

export type EncodeWorkerOut =
  | { type: 'PROGRESS'; percent: number }
  | { type: 'DONE'; buffer: ArrayBuffer }
  | { type: 'ERROR'; message: string };

// ─── Extension messaging ──────────────────────────────────────────────────────

export type RecordingState = 'idle' | 'starting' | 'recording' | 'stopping';

export type SwMessage =
  | { type: 'TOGGLE_RECORDING' }
  | { type: 'GET_STATE' };

export type SwResponse =
  | { type: 'STATE'; recordingState: RecordingState }
  | { type: 'OK' };

export type ContentMessage =
  | { type: 'START_RECORDING'; startedAt: string; streamId?: string }
  | { type: 'STOP_RECORDING' };

export type ContentResponse =
  | { type: 'SESSION_DATA'; session: CaptureSession }
  | { type: 'ERROR'; message: string };
