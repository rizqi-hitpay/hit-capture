/**
 * Stage 5 — Click-target snap.
 * Forces the cursor to land exactly on the click coordinates at the moment
 * each click event fires, removing the sub-pixel drift introduced by smoothing.
 */
import type { ResampledPoint, RawEvent } from '../types';

export function snapClicks(
  points: ResampledPoint[],
  rawEvents: RawEvent[]
): ResampledPoint[] {
  const clickEvents = rawEvents.filter((e) => e.k === 'down');
  if (clickEvents.length === 0) return points;

  const result = points.map((p) => ({ ...p }));

  for (const click of clickEvents) {
    // Find the point closest in time to the click
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < result.length; i++) {
      const d = Math.abs(result[i].t - click.t);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }

    // Snap that point and blend the 2 neighbors for a smooth approach
    result[bestIdx].x = click.x;
    result[bestIdx].y = click.y;

    // Soften the snap by blending the point just before
    if (bestIdx > 0) {
      const prev = result[bestIdx - 1];
      const blend = 0.6; // 60% snap, 40% original
      result[bestIdx - 1] = {
        ...prev,
        x: prev.x * (1 - blend) + click.x * blend,
        y: prev.y * (1 - blend) + click.y * blend,
      };
    }
  }

  return result;
}
