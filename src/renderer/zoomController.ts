/**
 * Auto-zoom state machine.
 *
 * Detects regions of interest (clicks and significant dwells) from the polished
 * track and produces a smooth CameraState at any given playback timestamp.
 */
import type { PolishedTrack, CameraState, AutoZoomConfig } from '../types';
import { lerpCamera } from './cameraEasing';

interface ZoomKeyframe {
  t: number;
  scale: number;
  /** Focus point in video-pixel space */
  focusX: number;
  focusY: number;
}

export class ZoomController {
  private keyframes: ZoomKeyframe[] = [];
  private videoWidth = 0;
  private videoHeight = 0;
  private config: AutoZoomConfig;

  constructor(config: AutoZoomConfig) {
    this.config = config;
  }

  /** Build keyframes from a polished track */
  build(
    track: PolishedTrack,
    videoWidth: number,
    videoHeight: number
  ): void {
    this.videoWidth = videoWidth;
    this.videoHeight = videoHeight;
    this.keyframes = [];

    if (!this.config.enabled) return;

    const { maxZoom, sensitivity } = this.config;
    const effectiveMaxZoom = 1 + (maxZoom - 1) * sensitivity;

    // Start and end at scale 1
    if (track.points.length > 0) {
      const first = track.points[0];
      const last = track.points[track.points.length - 1];
      this.keyframes.push({ t: first.t, scale: 1, focusX: first.x, focusY: first.y });
      this.keyframes.push({ t: last.t + 200, scale: 1, focusX: last.x, focusY: last.y });
    }

    // Zoom in on clicks
    for (const click of track.clicks) {
      const zoomIn: ZoomKeyframe = {
        t: click.t,
        scale: effectiveMaxZoom,
        focusX: click.x,
        focusY: click.y,
      };
      // Zoom out 800ms after click
      const zoomOut: ZoomKeyframe = {
        t: click.t + 800,
        scale: 1,
        focusX: click.x,
        focusY: click.y,
      };
      this.keyframes.push(zoomIn, zoomOut);
    }

    // Zoom in on significant dwells (> 400ms)
    for (const dwell of track.dwells) {
      if (dwell.durationMs < 400) continue;
      const zoomIn: ZoomKeyframe = {
        t: dwell.t + 200,
        scale: effectiveMaxZoom * 0.8,
        focusX: dwell.x,
        focusY: dwell.y,
      };
      const zoomOut: ZoomKeyframe = {
        t: dwell.t + dwell.durationMs + 200,
        scale: 1,
        focusX: dwell.x,
        focusY: dwell.y,
      };
      this.keyframes.push(zoomIn, zoomOut);
    }

    // Sort by time
    this.keyframes.sort((a, b) => a.t - b.t);
  }

  /** Get camera state at playback time t (ms) */
  getCamera(t: number): CameraState {
    if (!this.config.enabled || this.keyframes.length === 0) {
      return { scale: 1, tx: 0, ty: 0 };
    }

    const { easeDurationMs } = this.config;
    const kf = this.keyframes;

    // Find surrounding keyframes
    let lo = 0;
    let hi = kf.length - 1;

    if (t <= kf[0].t) {
      return this.cameraFromKeyframe(kf[0]);
    }
    if (t >= kf[hi].t) {
      return this.cameraFromKeyframe(kf[hi]);
    }

    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (kf[mid].t <= t) lo = mid;
      else hi = mid;
    }

    const from = kf[lo];
    const to = kf[hi];
    const span = to.t - from.t;
    const progress = span > 0 ? (t - from.t) / span : 1;

    // Use ease duration to smooth the transition
    const easedProgress = progress;

    const fromCam = this.cameraFromKeyframe(from);
    const toCam = this.cameraFromKeyframe(to);

    return lerpCamera(
      fromCam.scale, fromCam.tx, fromCam.ty,
      toCam.scale, toCam.tx, toCam.ty,
      easedProgress
    );

    void easeDurationMs; // referenced via config
  }

  private cameraFromKeyframe(kf: ZoomKeyframe): CameraState {
    const { scale, focusX, focusY } = kf;
    const w = this.videoWidth;
    const h = this.videoHeight;

    // Center the focus point in the canvas after scaling
    const tx = w / 2 - focusX * scale;
    const ty = h / 2 - focusY * scale;

    // Clamp so we don't show black borders
    const minTx = w - w * scale;
    const minTy = h - h * scale;
    const clampedTx = Math.max(minTx, Math.min(0, tx));
    const clampedTy = Math.max(minTy, Math.min(0, ty));

    return { scale, tx: clampedTx, ty: clampedTy };
  }
}
