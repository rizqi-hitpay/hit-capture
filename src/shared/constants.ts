// Capture
export const CAPTURE_HZ = 250;
export const MOVE_INTERVAL_MS = 1000 / CAPTURE_HZ; // ~4 ms

// Pipeline / internal timebase
export const PIPELINE_HZ = 120;
export const PIPELINE_INTERVAL_MS = 1000 / PIPELINE_HZ; // ~8.33 ms

// Dwell detection defaults
export const DWELL_THRESHOLD_PX = 5;
export const DWELL_THRESHOLD_MS = 150;

// Hesitation trimming defaults
export const HESITATION_THRESHOLD_MS = 800;
export const HESITATION_TARGET_MS = 200;

// Click choreography defaults
export const CLICK_OVERSHOOT_PX = 8;
export const CLICK_SETTLE_MS = 80;

// One-Euro filter defaults
export const ONE_EURO_MIN_CUTOFF_DEFAULT = 1.0;
export const ONE_EURO_BETA_DEFAULT = 0.007;

// Scene defaults
export const DEFAULT_CORNER_RADIUS_PX = 16;
export const DEFAULT_PADDING_PX = 40;
export const DEFAULT_SHADOW_BLUR = 60;
export const DEFAULT_SHADOW_ALPHA = 0.3;
export const DEFAULT_CURSOR_SCALE = 1.2;

// Auto-zoom defaults
export const DEFAULT_MAX_ZOOM = 1.6;
export const DEFAULT_ZOOM_EASE_MS = 400;
export const DEFAULT_ZOOM_SENSITIVITY = 0.7;

// Export
export const DEFAULT_OUTPUT_BITRATE = 8_000_000; // 8 Mbps
export const DEFAULT_OUTPUT_FRAMERATE = 30;

// Encode worker backpressure
export const ENCODE_MAX_QUEUE_DEPTH = 5;

// Preview canvas resolution (% of source, for performance)
export const PREVIEW_SCALE = 0.5;

// Pipeline debounce (ms) — avoid re-running on every slider tick
export const PIPELINE_DEBOUNCE_MS = 200;
