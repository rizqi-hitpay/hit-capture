/**
 * Stage 4 — Dwell detection.
 * A dwell is a period where the cursor moves less than `thresholdPx` for
 * longer than `thresholdMs`. Returns an array of dwell events for use by
 * the spline smoother (anchoring) and auto-zoom (region-of-interest detection).
 */
import type { ResampledPoint, DwellEvent } from '../types';

export function detectDwells(
  points: ResampledPoint[],
  thresholdPx: number,
  thresholdMs: number
): DwellEvent[] {
  const dwells: DwellEvent[] = [];
  if (points.length < 2) return dwells;

  let windowStart = 0;

  for (let i = 1; i < points.length; i++) {
    const refX = points[windowStart].x;
    const refY = points[windowStart].y;
    const dist = Math.hypot(points[i].x - refX, points[i].y - refY);

    if (dist > thresholdPx) {
      // Check if the window we had was long enough to be a dwell
      const duration = points[i - 1].t - points[windowStart].t;
      if (duration >= thresholdMs) {
        // Centroid of dwell region
        const subset = points.slice(windowStart, i);
        const cx = subset.reduce((s, p) => s + p.x, 0) / subset.length;
        const cy = subset.reduce((s, p) => s + p.y, 0) / subset.length;
        dwells.push({
          t: points[windowStart].t,
          x: cx,
          y: cy,
          durationMs: duration,
        });
      }
      windowStart = i;
    }
  }

  // Check the trailing window
  const lastDuration = points[points.length - 1].t - points[windowStart].t;
  if (lastDuration >= thresholdMs) {
    const subset = points.slice(windowStart);
    const cx = subset.reduce((s, p) => s + p.x, 0) / subset.length;
    const cy = subset.reduce((s, p) => s + p.y, 0) / subset.length;
    dwells.push({
      t: points[windowStart].t,
      x: cx,
      y: cy,
      durationMs: lastDuration,
    });
  }

  return dwells;
}
