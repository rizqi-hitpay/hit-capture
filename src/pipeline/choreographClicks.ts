/**
 * Stage 7 — Click choreography.
 * Inserts a subtle overshoot point then a settle-back for each click,
 * creating the tactile "spring" feel of deliberate clicks.
 *
 * Timeline per click at T:
 *   T+30ms  → overshoot (cursor moves 8px past the click target in direction of travel)
 *   T+80ms  → settle    (cursor returns to exact click coords)
 */
import type { ResampledPoint, RawEvent } from '../types';

export function choreographClicks(
  points: ResampledPoint[],
  rawEvents: RawEvent[],
  overshootPx: number,
  settleMs: number
): ResampledPoint[] {
  const clickEvents = rawEvents.filter((e) => e.k === 'down');
  if (clickEvents.length === 0) return points;

  // Build a mutable copy we'll insert into
  const result = [...points];

  // Process clicks in reverse order so insertions don't shift earlier indices
  const sortedClicks = [...clickEvents].sort((a, b) => b.t - a.t);

  for (const click of sortedClicks) {
    // Find index of the click point in our result
    let clickIdx = result.findIndex(
      (p) => Math.abs(p.t - click.t) < 10
    );
    if (clickIdx < 0) continue;

    // Direction of approach: from 100ms before click to click position
    const lookbackMs = 100;
    const approachIdx = result.findIndex(
      (p) => p.t >= click.t - lookbackMs
    );
    const approachPoint =
      approachIdx >= 0 && approachIdx < clickIdx ? result[approachIdx] : null;

    let dirX = 0;
    let dirY = 0;
    if (approachPoint) {
      const dx = click.x - approachPoint.x;
      const dy = click.y - approachPoint.y;
      const len = Math.hypot(dx, dy) || 1;
      dirX = dx / len;
      dirY = dy / len;
    }

    const overshootT = click.t + settleMs * 0.375; // ~30ms
    const settleT = click.t + settleMs;

    const overshootPoint: ResampledPoint = {
      t: overshootT,
      x: click.x + dirX * overshootPx,
      y: click.y + dirY * overshootPx,
    };
    const settlePoint: ResampledPoint = {
      t: settleT,
      x: click.x,
      y: click.y,
    };

    // Insert after the click index
    result.splice(clickIdx + 1, 0, overshootPoint, settlePoint);
  }

  // Re-sort (splice may have disrupted order slightly)
  result.sort((a, b) => a.t - b.t);

  return result;
}
