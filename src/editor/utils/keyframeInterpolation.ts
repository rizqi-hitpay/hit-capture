import type { Keyframe, CropRect, VideoCenter, Skew } from '../../types';
import { lerp } from '../../shared/coords';

export interface InterpolatedState {
  containerRect: CropRect;
  videoCenter: VideoCenter;
  zoom: number;
  skew: Skew;
}

const NO_SKEW: Skew = { x: 0, y: 0, z: 0, tiltX: 0, tiltY: 0 };

/**
 * Interpolates keyframe state at time `t` (seconds).
 * Returns null when the keyframes array is empty — callers fall back to store values.
 * Before the first / after the last keyframe, the boundary value is held.
 */
export function getStateAtTime(keyframes: Keyframe[], t: number): InterpolatedState | null {
  if (keyframes.length === 0) return null;

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  if (t <= sorted[0].time) {
    const k = sorted[0];
    return { containerRect: k.containerRect, videoCenter: k.videoCenter, zoom: k.zoom, skew: k.skew ?? NO_SKEW };
  }

  const last = sorted[sorted.length - 1];
  if (t >= last.time) {
    return { containerRect: last.containerRect, videoCenter: last.videoCenter, zoom: last.zoom, skew: last.skew ?? NO_SKEW };
  }

  let a = sorted[0];
  let b = sorted[1];
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].time && t <= sorted[i + 1].time) {
      a = sorted[i];
      b = sorted[i + 1];
      break;
    }
  }

  const p = (t - a.time) / (b.time - a.time);

  return {
    containerRect: {
      x: lerp(a.containerRect.x, b.containerRect.x, p),
      y: lerp(a.containerRect.y, b.containerRect.y, p),
      w: lerp(a.containerRect.w, b.containerRect.w, p),
      h: lerp(a.containerRect.h, b.containerRect.h, p),
    },
    videoCenter: {
      x: lerp(a.videoCenter.x, b.videoCenter.x, p),
      y: lerp(a.videoCenter.y, b.videoCenter.y, p),
    },
    zoom: lerp(a.zoom, b.zoom, p),
    skew: {
      x: lerp(a.skew?.x ?? 0, b.skew?.x ?? 0, p),
      y: lerp(a.skew?.y ?? 0, b.skew?.y ?? 0, p),
      z: lerp(a.skew?.z ?? 0, b.skew?.z ?? 0, p),
      tiltX: lerp(a.skew?.tiltX ?? 0, b.skew?.tiltX ?? 0, p),
      tiltY: lerp(a.skew?.tiltY ?? 0, b.skew?.tiltY ?? 0, p),
    },
  };
}
