/**
 * Stage 1 — Resample raw cursor events to a fixed 120 Hz timebase.
 * Uses linear interpolation between adjacent move events.
 */
import type { RawEvent, ResampledPoint } from '../types';
import { PIPELINE_INTERVAL_MS } from '../shared/constants';

export function resample(events: RawEvent[]): ResampledPoint[] {
  // Extract move events (includes synthesized positions from down/up)
  const moves = events
    .filter((e) => e.k === 'move' || e.k === 'down' || e.k === 'up')
    .sort((a, b) => a.t - b.t);

  if (moves.length < 2) {
    return moves.map((e) => ({ t: e.t, x: e.x, y: e.y }));
  }

  const result: ResampledPoint[] = [];
  const tStart = moves[0].t;
  const tEnd = moves[moves.length - 1].t;

  let srcIdx = 0;
  let t = tStart;

  while (t <= tEnd) {
    // Advance source pointer so moves[srcIdx+1].t >= t
    while (
      srcIdx < moves.length - 2 &&
      moves[srcIdx + 1].t < t
    ) {
      srcIdx++;
    }

    const p0 = moves[srcIdx];
    const p1 = moves[srcIdx + 1] ?? p0;

    const span = p1.t - p0.t;
    const alpha = span > 0 ? (t - p0.t) / span : 0;
    const x = p0.x + (p1.x - p0.x) * alpha;
    const y = p0.y + (p1.y - p0.y) * alpha;

    result.push({ t, x, y });
    t += PIPELINE_INTERVAL_MS;
  }

  return result;
}
