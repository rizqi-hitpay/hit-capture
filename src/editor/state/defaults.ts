import type { PipelineParams, SceneConfig, CropRect, VideoCenter, Skew, Keyframe, EditorMode } from '../../types';
import {
  DWELL_THRESHOLD_PX,
  DWELL_THRESHOLD_MS,
  HESITATION_THRESHOLD_MS,
  HESITATION_TARGET_MS,
  CLICK_OVERSHOOT_PX,
  CLICK_SETTLE_MS,
  ONE_EURO_MIN_CUTOFF_DEFAULT,
  ONE_EURO_BETA_DEFAULT,
  DEFAULT_CORNER_RADIUS_PX,
  DEFAULT_PADDING_PX,
  DEFAULT_SHADOW_BLUR,
  DEFAULT_SHADOW_ALPHA,
  DEFAULT_CURSOR_SCALE,
  DEFAULT_MAX_ZOOM,
  DEFAULT_ZOOM_EASE_MS,
  DEFAULT_ZOOM_SENSITIVITY,
} from '../../shared/constants';

export const DEFAULT_CONTAINER_RECT: CropRect = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
export const DEFAULT_ZOOM_LEVEL = 1.0;
export const DEFAULT_VIDEO_CENTER: VideoCenter = { x: 0.5, y: 0.5 };
export const DEFAULT_SKEW: Skew = { x: 0, y: 0, z: 0, tiltX: 0, tiltY: 0 };
export const DEFAULT_KEYFRAMES: Keyframe[] = [];
export const DEFAULT_SELECTED_KEYFRAME_ID: string | null = null;
export const DEFAULT_EDITOR_MODE: EditorMode = 'animate';

export const DEFAULT_PIPELINE_PARAMS: PipelineParams = {
  smoothingStrength: 0.65,
  dwellThresholdPx: DWELL_THRESHOLD_PX,
  dwellThresholdMs: DWELL_THRESHOLD_MS,
  hesitationThresholdMs: HESITATION_THRESHOLD_MS,
  hesitationTargetMs: HESITATION_TARGET_MS,
  clickOvershootPx: CLICK_OVERSHOOT_PX,
  clickSettleMs: CLICK_SETTLE_MS,
  oneEuroMinCutoff: ONE_EURO_MIN_CUTOFF_DEFAULT,
  oneEuroBeta: ONE_EURO_BETA_DEFAULT,
};

export const DEFAULT_SCENE_CONFIG: SceneConfig = {
  outputWidth: 1280,
  outputHeight: 720,
  gradient: 'dawn',
  window: {
    paddingPx: DEFAULT_PADDING_PX,
    cornerRadiusPx: DEFAULT_CORNER_RADIUS_PX,
    shadowBlur: DEFAULT_SHADOW_BLUR,
    shadowAlpha: DEFAULT_SHADOW_ALPHA,
  },
  autoZoom: {
    enabled: true,
    sensitivity: DEFAULT_ZOOM_SENSITIVITY,
    maxZoom: DEFAULT_MAX_ZOOM,
    easeDurationMs: DEFAULT_ZOOM_EASE_MS,
  },
  cursorScale: DEFAULT_CURSOR_SCALE,
};
