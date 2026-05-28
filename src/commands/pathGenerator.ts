import type { RawEvent } from '../types';

export interface Point { x: number; y: number }

const PATH_HZ = 250;
const INTERVAL_MS = 1000 / PATH_HZ;

/** Cubic Bézier path from `from` to `to` over `durationMs`, timestamped from `startMs`. */
export function bezierPath(from: Point, to: Point, durationMs: number, startMs: number): RawEvent[] {
  const steps = Math.max(2, Math.round(durationMs / INTERVAL_MS));
  const cp1 = controlPoint(from, to, 0.25);
  const cp2 = controlPoint(from, to, 0.75);
  const events: RawEvent[] = [];

  for (let i = 0; i <= steps; i++) {
    const tNorm = easeInOut(i / steps);
    const p = cubicBezier(from, cp1, cp2, to, tNorm);
    events.push({ k: 'move', t: startMs + i * INTERVAL_MS, x: Math.round(p.x), y: Math.round(p.y) });
  }

  return events;
}

/** Stationary dwell events at `at` for `durationMs`, timestamped from `startMs`. */
export function dwellEvents(at: Point, durationMs: number, startMs: number): RawEvent[] {
  const steps = Math.max(1, Math.round(durationMs / INTERVAL_MS));
  const events: RawEvent[] = [];
  for (let i = 0; i <= steps; i++) {
    events.push({ k: 'move', t: startMs + i * INTERVAL_MS, x: at.x, y: at.y });
  }
  return events;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function cubicBezier(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

function controlPoint(from: Point, to: Point, tParam: number): Point {
  const mx = from.x + (to.x - from.x) * tParam;
  const my = from.y + (to.y - from.y) * tParam;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  // Perpendicular offset for a natural arc (up to ±15% of distance)
  const offset = (Math.random() - 0.5) * dist * 0.3;
  return { x: mx + (-dy / dist) * offset, y: my + (dx / dist) * offset };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}
