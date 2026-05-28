/**
 * Camera easing math for auto-zoom transitions.
 */

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function easeInOutQuart(t: number): number {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/** Linearly interpolate two camera states with an easing curve */
export function lerpCamera(
  fromScale: number, fromX: number, fromY: number,
  toScale: number, toX: number, toY: number,
  progress: number // 0–1 raw progress
): { scale: number; tx: number; ty: number } {
  const t = easeInOutCubic(Math.max(0, Math.min(1, progress)));
  return {
    scale: fromScale + (toScale - fromScale) * t,
    tx: fromX + (toX - fromX) * t,
    ty: fromY + (toY - fromY) * t,
  };
}
