/**
 * Scene renderer — pure canvas operations.
 * Composites: gradient background → floating window (video).
 * Works with both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
 */
import type { SceneConfig, RenderFrameData, CropRect, VideoOffset } from '../types';
import { GRADIENT_PRESETS, createGradient } from './gradientPresets';

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class SceneRenderer {
  /** Cached gradient — invalidated when config or canvas size changes */
  private gradientCache: { id: string; grad: CanvasGradient } | null = null;

  /**
   * Render a single frame onto ctx.
   * The canvas must already be sized to sceneConfig.outputWidth × outputHeight.
   *
   * @param cropRect    When set, defines the floating window position and size as
   *                    fractions of the output canvas (x, y, w, h in [0, 1]).
   *                    When null, the window fills the padded area scaled by zoomLevel.
   * @param zoomLevel   Scale factor applied when no cropRect is set (1.0 = fill padded area).
   * @param videoOffset Controls which part of the video is visible inside the window.
   *                    { x: 0.5, y: 0.5 } = centred (default).
   */
  render(
    ctx: AnyCtx,
    frame: RenderFrameData,
    config: SceneConfig,
    cropRect: CropRect | null = null,
    zoomLevel = 1.0,
    videoOffset: VideoOffset = { x: 0.5, y: 0.5 },
  ): void {
    const { outputWidth: W, outputHeight: H } = config;
    this.drawBackground(ctx, config, W, H);
    this.drawFloatingWindow(ctx, frame, config, W, H, cropRect, zoomLevel, videoOffset);
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
    videoOffset: VideoOffset,
  ): void {
    const { paddingPx, cornerRadiusPx, shadowBlur, shadowAlpha } = config.window;

    // cropRect positions the floating window as fractions of the output canvas.
    // When absent, the window fills the padded area scaled by zoomLevel.
    let winX: number, winY: number, winW: number, winH: number;
    if (cropRect) {
      winX = cropRect.x * W;
      winY = cropRect.y * H;
      winW = cropRect.w * W;
      winH = cropRect.h * H;
    } else {
      const baseW = W - paddingPx * 2;
      const baseH = H - paddingPx * 2;
      winW = baseW * zoomLevel;
      winH = baseH * zoomLevel;
      winX = (W - winW) / 2;
      winY = (H - winH) / 2;
    }

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

        // Cover-crop: scale so the shorter axis fills the window.
        // videoOffset always pans within the full source video regardless of cropRect.
        const scale = Math.max(winW / natW, winH / natH);
        const srcW  = winW / scale;
        const srcH  = winH / scale;
        const sx    = (natW - srcW) * videoOffset.x;
        const sy    = (natH - srcH) * videoOffset.y;

        ctx.drawImage(
          src as CanvasImageSource,
          sx, sy, srcW, srcH,
          winX, winY, winW, winH,
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
