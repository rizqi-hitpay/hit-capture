import type { GradientDef, GradientPresetId } from '../types';

export const GRADIENT_PRESETS: Record<GradientPresetId, GradientDef> = {
  dawn: {
    id: 'dawn',
    label: 'Dawn',
    angleDeg: 135,
    stops: [
      { offset: 0, color: '#ffecd2' },
      { offset: 0.5, color: '#fcb69f' },
      { offset: 1, color: '#ff9a9e' },
    ],
  },
  dusk: {
    id: 'dusk',
    label: 'Dusk',
    angleDeg: 135,
    stops: [
      { offset: 0, color: '#a18cd1' },
      { offset: 1, color: '#fbc2eb' },
    ],
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    angleDeg: 160,
    stops: [
      { offset: 0, color: '#4facfe' },
      { offset: 1, color: '#00f2fe' },
    ],
  },
  forest: {
    id: 'forest',
    label: 'Forest',
    angleDeg: 120,
    stops: [
      { offset: 0, color: '#43e97b' },
      { offset: 1, color: '#38f9d7' },
    ],
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    angleDeg: 145,
    stops: [
      { offset: 0, color: '#1e2a3a' },
      { offset: 1, color: '#2d3f55' },
    ],
  },
};

export const GRADIENT_IDS = Object.keys(GRADIENT_PRESETS) as GradientPresetId[];

/**
 * Create a CanvasGradient from a preset definition for a canvas of the given size.
 */
export function createGradient(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  def: GradientDef,
  width: number,
  height: number
): CanvasGradient {
  const angleRad = (def.angleDeg * Math.PI) / 180;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfDiag = Math.hypot(width, height) / 2;

  const cx = width / 2;
  const cy = height / 2;
  const x0 = cx - cos * halfDiag;
  const y0 = cy - sin * halfDiag;
  const x1 = cx + cos * halfDiag;
  const y1 = cy + sin * halfDiag;

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const stop of def.stops) {
    grad.addColorStop(stop.offset, stop.color);
  }
  return grad;
}
