/**
 * Scene renderer — pure canvas operations.
 * Composites: gradient background → floating window (video).
 * Works with both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
 */
import type { SceneConfig, RenderFrameData, CropRect } from '../types';
import { GRADIENT_PRESETS, createGradient } from './gradientPresets';

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class SceneRenderer {
  /** Cached gradient — invalidated when config or canvas size changes */
  private gradientCache: { id: string; grad: CanvasGradient } | null = null;

  /**
   * Render a single frame onto ctx.
   * The canvas must already be sized to sceneConfig.outputWidth × outputHeight.
   *
   * @param cropRect  User-defined crop region (0–1 fractions of video natural size).
   *                  When null the full video is cover-cropped to fill the window.
   * @param zoomLevel Scale factor for the floating window (1.0 = fill padded area).
   *                  Values > 1 make the window larger; < 1 make it smaller.
   */
  render(
    ctx: AnyCtx,
    frame: RenderFrameData,
    config: SceneConfig,
    cropRect: CropRect | null = null,
    zoomLevel = 1.0,
  ): void {
    const { outputWidth: W, outputHeight: H } = config;
    this.drawBackground(ctx, config, W, H);
    this.drawFloatingWindow(ctx, frame, config, W, H, cropRect, zoomLevel);
  }

  private drawBackground(ctx: AnyCtx, config: SceneConfig, W: number, H: number): void {
    const def = GRADIENT_PRESETS[config.gradient];
    const cacheKey = `${config.gradient}-${W}-${H}`;

    if (!this.gradientCache || this.gradientCache.id !== cacheKey) {
      this.gradientCache = {
        id: cacheKey,
        grad: createGradient(ctx as CanvasRenderingContext2D, def, W, H),
      };
    }

    ctx.fillStyle = this.gradientCache.grad;
    ctx.fillRect(0, 0, W, H);
  }

  private drawFloatingWindow(
    ctx: AnyCtx,
    frame: RenderFrameData,
    config: SceneConfig,
    W: number,
    H: number,
    cropRect: CropRect | null,
    zoomLevel: number,
  ): void {
    const { paddingPx, cornerRadiusPx, shadowBlur, shadowAlpha } = config.window;

    // Base window fills the padded area; zoomLevel scales it around center.
    const baseW = W - paddingPx * 2;
    const baseH = H - paddingPx * 2;
    const winW = baseW * zoomLevel;
    const winH = baseH * zoomLevel;
    const winX = (W - winW) / 2;
    const winY = (H - winH) / 2;

    ctx.save();

    // Drop shadow
    ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`;
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetY = shadowBlur * 0.3;

    // Rounded rect fill (window background)
    ctx.beginPath();
    roundRect(ctx, winX, winY, winW, winH, cornerRadiusPx);
    ctx.fillStyle = '#000';
    ctx.fill();

    ctx.restore();
    ctx.save();

    // Clip to window
    ctx.beginPath();
    roundRect(ctx, winX, winY, winW, winH, cornerRadiusPx);
    ctx.clip();

    if (frame.videoSource) {
      const src = frame.videoSource;
      const isVideoEl =
        typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement;
      const hasFrame = !isVideoEl || (src as HTMLVideoElement).readyState >= 2;

      if (hasFrame) {
        // Resolve natural dimensions of the source
        let natW: number;
        let natH: number;
        if (isVideoEl) {
          natW = (src as HTMLVideoElement).videoWidth  || winW;
          natH = (src as HTMLVideoElement).videoHeight || winH;
        } else if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) {
          natW = (src as VideoFrame).displayWidth  || winW;
          natH = (src as VideoFrame).displayHeight || winH;
        } else if (src instanceof ImageBitmap) {
          natW = src.width  || winW;
          natH = src.height || winH;
        } else {
          natW = winW;
          natH = winH;
        }

        let sx: number, sy: number, srcW: number, srcH: number;

        if (cropRect) {
          // User-defined crop region: draw exactly what they selected, stretched
          // to fill the floating window (preserves their framing intent).
          sx   = cropRect.x * natW;
          sy   = cropRect.y * natH;
          srcW = cropRect.w * natW;
          srcH = cropRect.h * natH;
        } else {
          // Default: cover-crop — scale so the shorter axis fills the window,
          // center-crop the longer axis. Eliminates black bars entirely.
          const scale = Math.max(winW / natW, winH / natH);
          srcW = winW / scale;
          srcH = winH / scale;
          sx   = (natW - srcW) / 2;
          sy   = (natH - srcH) / 2;
        }

        ctx.drawImage(
          src as CanvasImageSource,
          sx, sy, srcW, srcH,  // source rect
          winX, winY, winW, winH, // destination rect
        );
      }
    }

    ctx.restore();
  }

  /** Reset cached gradient (call when config or canvas size changes) */
  invalidateCache(): void {
    this.gradientCache = null;
  }
}

// ─── roundRect polyfill (Chrome 99+ has native, but keep for safety) ─────────

function roundRect(
  ctx: AnyCtx,
  x: number, y: number, w: number, h: number, r: number,
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}
