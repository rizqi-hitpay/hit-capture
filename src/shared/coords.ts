import type { CaptureSession, CoordTransform } from '../types';

export function identityTransform(): CoordTransform {
  return { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
}

/**
 * Attempts to auto-detect the coordinate mapping between cursor events
 * (clientX/Y in CSS pixels) and the source video dimensions.
 *
 * Returns `autoAligned = true` when a reliable auto-match is found,
 * `false` when the user will need a manual calibration step.
 */
export function computeTransform(
  session: CaptureSession,
  videoWidth: number,
  videoHeight: number
): { transform: CoordTransform; autoAligned: boolean } {
  const { w, h, dpr } = session.viewport;

  // DPR-corrected match (e.g. Retina screen recorded at 2× physical pixels)
  if (
    Math.abs(videoWidth - w * dpr) < 2 &&
    Math.abs(videoHeight - h * dpr) < 2
  ) {
    return {
      transform: { scaleX: dpr, scaleY: dpr, offsetX: 0, offsetY: 0 },
      autoAligned: true,
    };
  }

  // Exact CSS-pixel match
  if (Math.abs(videoWidth - w) < 2 && Math.abs(videoHeight - h) < 2) {
    return { transform: identityTransform(), autoAligned: true };
  }

  // Best-effort proportional scale — user should validate
  const scaleX = videoWidth / w;
  const scaleY = videoHeight / h;
  return {
    transform: { scaleX, scaleY, offsetX: 0, offsetY: 0 },
    autoAligned: false,
  };
}

export function transformPoint(
  x: number,
  y: number,
  t: CoordTransform
): { x: number; y: number } {
  return { x: x * t.scaleX + t.offsetX, y: y * t.scaleY + t.offsetY };
}

/**
 * Linear interpolation
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Clamp value between min and max
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
