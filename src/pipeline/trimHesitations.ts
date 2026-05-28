/**
 * Stage 6 — Hesitation trimming.
 * Compresses idle gaps (cursor idle > thresholdMs) down to targetMs.
 * Adjusts all subsequent timestamps accordingly so the track stays consistent.
 *
 * Returns the trimmed points AND a mapping table from original time → trimmed time
 * (used by the encode worker to map video frame timestamps).
 */
import type { ResampledPoint } from '../types';

export interface TimeMapEntry {
  /** Original timestamp (ms) */
  origT: number;
  /** Trimmed timestamp (ms) */
  trimmedT: number;
}

export interface TrimResult {
  points: ResampledPoint[];
  timeMap: TimeMapEntry[];
}

export function trimHesitations(
  points: ResampledPoint[],
  thresholdMs: number,
  targetMs: number
): TrimResult {
  if (points.length < 2) {
    return {
      points,
      timeMap: points.map((p) => ({ origT: p.t, trimmedT: p.t })),
    };
  }

  const result: ResampledPoint[] = [];
  const timeMap: TimeMapEntry[] = [];
  let offset = 0; // accumulated time that has been trimmed

  result.push({ ...points[0] });
  timeMap.push({ origT: points[0].t, trimmedT: points[0].t });

  for (let i = 1; i < points.length; i++) {
    const gap = points[i].t - points[i - 1].t;

    if (gap > thresholdMs) {
      // Compress this gap
      offset += gap - targetMs;
    }

    const trimmedT = points[i].t - offset;
    result.push({ t: trimmedT, x: points[i].x, y: points[i].y });
    timeMap.push({ origT: points[i].t, trimmedT });
  }

  return { points: result, timeMap };
}

/**
 * Given a trimmed timestamp, find the original timestamp using the time map.
 * Used by the encoder to seek the source video.
 */
export function trimmedToOriginal(
  trimmedT: number,
  timeMap: TimeMapEntry[]
): number {
  if (timeMap.length === 0) return trimmedT;
  if (trimmedT <= timeMap[0].trimmedT) return timeMap[0].origT;
  if (trimmedT >= timeMap[timeMap.length - 1].trimmedT) {
    return timeMap[timeMap.length - 1].origT;
  }

  let lo = 0;
  let hi = timeMap.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (timeMap[mid].trimmedT <= trimmedT) lo = mid;
    else hi = mid;
  }

  const span = timeMap[hi].trimmedT - timeMap[lo].trimmedT;
  const alpha = span > 0 ? (trimmedT - timeMap[lo].trimmedT) / span : 0;
  return timeMap[lo].origT + (timeMap[hi].origT - timeMap[lo].origT) * alpha;
}
