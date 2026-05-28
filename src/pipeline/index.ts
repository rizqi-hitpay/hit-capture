/**
 * Pipeline orchestrator — chains all 7 stages.
 * Pure function: no DOM, no chrome.*, no side effects.
 */
import type {
  RawEvent,
  PipelineParams,
  PolishedTrack,
  ClickEvent,
  DwellEvent,
} from '../types';
import type { CaptureSession } from '../types';

import { resample } from './resample';
import { applyOneEuroFilter } from './oneEuroFilter';
import { detectDwells } from './detectDwells';
import { splineSmooth } from './splineSmooth';
import { snapClicks } from './snapClicks';
import { trimHesitations } from './trimHesitations';
import { choreographClicks } from './choreographClicks';

/** Interpolate One-Euro params based on smoothingStrength 0–1 */
function resolvedOneEuroParams(params: PipelineParams): { minCutoff: number; beta: number } {
  const s = params.smoothingStrength;
  return {
    minCutoff: params.oneEuroMinCutoff * (3.0 - 2.5 * s), // [3.0 → 0.5]
    beta: params.oneEuroBeta * (1 - s * 0.95),            // [1.0 → 0.05]
  };
}

export function runPipeline(
  events: RawEvent[],
  params: PipelineParams,
  _viewport: CaptureSession['viewport']
): PolishedTrack {
  if (events.length === 0) {
    return { points: [], dwells: [], clicks: [], totalDurationMs: 0 };
  }

  // Stage 1 — resample to 120 Hz
  const resampled = resample(events);

  // Stage 2 — One-Euro filter
  const { minCutoff, beta } = resolvedOneEuroParams(params);
  const filtered = applyOneEuroFilter(resampled, minCutoff, beta);

  // Stage 4 — Dwell detection (runs on filtered track, before spline)
  const dwells: DwellEvent[] = detectDwells(
    filtered,
    params.dwellThresholdPx,
    params.dwellThresholdMs
  );

  // Stage 3 — Catmull-Rom spline (anchored on dwell centroids)
  const splined = splineSmooth(filtered, dwells);

  // Stage 5 — Click-target snap
  const snapped = snapClicks(splined, events);

  // Stage 6 — Hesitation trimming
  const { points: trimmed } = trimHesitations(
    snapped,
    params.hesitationThresholdMs,
    params.hesitationTargetMs
  );

  // Stage 7 — Click choreography (overshoot + settle)
  const choreographed = choreographClicks(
    trimmed,
    events,
    params.clickOvershootPx,
    params.clickSettleMs
  );

  // Extract click events from raw for the track metadata
  const clicks: ClickEvent[] = events
    .filter((e) => e.k === 'down')
    .map((e) => ({ t: e.t, x: e.x, y: e.y, button: e.b ?? 0 }));

  const totalDurationMs =
    choreographed.length > 0
      ? choreographed[choreographed.length - 1].t - choreographed[0].t
      : 0;

  return {
    points: choreographed,
    dwells,
    clicks,
    totalDurationMs,
  };
}
