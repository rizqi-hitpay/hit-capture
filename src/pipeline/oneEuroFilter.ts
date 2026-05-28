/**
 * Stage 2 — One-Euro filter for adaptive tremor removal.
 *
 * Reference: Géry Casiez, Nicolas Roussel, Daniel Vogel (2012)
 * "1€ Filter: A Simple Speed-Based Low-Pass Filter for Noisy Input in Interactive Systems"
 */
import type { ResampledPoint } from '../types';

// ─── 1D One-Euro filter state ─────────────────────────────────────────────────

interface FilterState1D {
  xPrev: number;
  dxPrev: number;
  tPrev: number;
  initialized: boolean;
}

function makeState1D(): FilterState1D {
  return { xPrev: 0, dxPrev: 0, tPrev: 0, initialized: false };
}

function alphaFor(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function step1D(
  state: FilterState1D,
  t: number,
  x: number,
  minCutoff: number,
  beta: number,
  dCutoff: number
): number {
  if (!state.initialized) {
    state.xPrev = x;
    state.dxPrev = 0;
    state.tPrev = t;
    state.initialized = true;
    return x;
  }

  const dt = Math.max((t - state.tPrev) / 1000, 1e-6); // seconds
  const dAlpha = alphaFor(dCutoff, dt);
  const dx = (x - state.xPrev) / dt;
  const dxHat = dAlpha * dx + (1 - dAlpha) * state.dxPrev;

  const cutoff = minCutoff + beta * Math.abs(dxHat);
  const xAlpha = alphaFor(cutoff, dt);
  const xHat = xAlpha * x + (1 - xAlpha) * state.xPrev;

  state.xPrev = xHat;
  state.dxPrev = dxHat;
  state.tPrev = t;

  return xHat;
}

// ─── Apply to a track ─────────────────────────────────────────────────────────

export function applyOneEuroFilter(
  points: ResampledPoint[],
  minCutoff: number,
  beta: number
): ResampledPoint[] {
  const D_CUTOFF = 1.0;
  const stateX = makeState1D();
  const stateY = makeState1D();

  return points.map((p) => ({
    t: p.t,
    x: step1D(stateX, p.t, p.x, minCutoff, beta, D_CUTOFF),
    y: step1D(stateY, p.t, p.y, minCutoff, beta, D_CUTOFF),
  }));
}
