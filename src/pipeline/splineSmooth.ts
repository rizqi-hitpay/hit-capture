/**
 * Stage 3 — Catmull-Rom spline smoothing anchored on dwell points.
 *
 * The dwell centroids are used as hard control points so the cursor
 * "lands" intentionally on them. Between dwells, Catmull-Rom gives a
 * naturally flowing path without the jitter of raw events.
 */
import type { ResampledPoint, DwellEvent } from '../types';

// ─── Catmull-Rom evaluation ───────────────────────────────────────────────────

/** Evaluate Catmull-Rom segment at t ∈ [0, 1] */
function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * p1 +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

// ─── Build control points including dwell anchors ─────────────────────────────

interface ControlPoint {
  t: number;
  x: number;
  y: number;
}

function buildControlPoints(
  points: ResampledPoint[],
  dwells: DwellEvent[]
): ControlPoint[] {
  if (points.length === 0) return [];

  // Insert dwell anchors into the point stream (merge & sort)
  const anchors: ControlPoint[] = dwells.map((d) => ({ t: d.t, x: d.x, y: d.y }));

  const merged: ControlPoint[] = [...points, ...anchors].sort((a, b) => a.t - b.t);

  // Deduplicate very close timestamps (< 4 ms apart), preferring anchors
  const deduped: ControlPoint[] = [];
  for (const cp of merged) {
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(cp.t - prev.t) < 4) {
      // Replace prev with anchor if current is an anchor
      const isAnchor = anchors.some((a) => a.t === cp.t);
      if (isAnchor) deduped[deduped.length - 1] = cp;
    } else {
      deduped.push(cp);
    }
  }

  return deduped;
}

// ─── Resample via spline ──────────────────────────────────────────────────────

export function splineSmooth(
  points: ResampledPoint[],
  dwells: DwellEvent[]
): ResampledPoint[] {
  const ctrl = buildControlPoints(points, dwells);
  if (ctrl.length < 2) return points;

  // Re-emit points at original timestamps but with spline-smoothed positions
  const result: ResampledPoint[] = [];

  // For each original point, find its spline position
  for (const orig of points) {
    const t = orig.t;

    // Binary search for the segment containing t
    let lo = 0;
    let hi = ctrl.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (ctrl[mid].t <= t) lo = mid;
      else hi = mid;
    }

    // lo..lo+1 is the segment
    const i1 = lo;
    const i2 = Math.min(lo + 1, ctrl.length - 1);
    const i0 = Math.max(i1 - 1, 0);
    const i3 = Math.min(i2 + 1, ctrl.length - 1);

    const span = ctrl[i2].t - ctrl[i1].t;
    const u = span > 0 ? (t - ctrl[i1].t) / span : 0;

    result.push({
      t,
      x: catmullRom(ctrl[i0].x, ctrl[i1].x, ctrl[i2].x, ctrl[i3].x, u),
      y: catmullRom(ctrl[i0].y, ctrl[i1].y, ctrl[i2].y, ctrl[i3].y, u),
    });
  }

  return result;
}
