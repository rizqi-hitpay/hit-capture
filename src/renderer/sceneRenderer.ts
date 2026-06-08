/**
 * Scene renderer — pure canvas operations.
 * Composites: gradient background → floating window (video).
 * Works with both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
 */
import type { SceneConfig, RenderFrameData, CropRect, VideoCenter } from '../types';
import { GRADIENT_PRESETS, createGradient } from './gradientPresets';

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class SceneRenderer {
  /** Cached gradient — invalidated when config or canvas size changes */
  private gradientCache: { id: string; grad: CanvasGradient } | null = null;

  /**
   * Render a single frame onto ctx.
   * The canvas must already be sized to sceneConfig.outputWidth × outputHeight.
   *
   * @param cropRect    Defines the visible container window as fractions of the output
   *                    canvas (x, y, w, h in [0, 1]). The container is a viewport mask —
   *                    the video renders at full canvas size behind it.
   * @param zoomLevel   Scale factor applied when no cropRect is set (fallback only).
   * @param videoCenter Canvas-fraction position of the video's center point.
   *                    { x: 0.5, y: 0.5 } places the video centred on the canvas.
   */
  render(
    ctx: AnyCtx,
    frame: RenderFrameData,
    config: SceneConfig,
    cropRect: CropRect | null = null,
    zoomLevel = 1.0,
    videoCenter: VideoCenter = { x: 0.5, y: 0.5 },
  ): void {
    const { outputWidth: W, outputHeight: H } = config;
    this.drawBackground(ctx, config, W, H);
    this.drawFloatingWindow(ctx, frame, config, W, H, cropRect, zoomLevel, videoCenter);
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
    videoCenter: VideoCenter,
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
          natW = (src as HTMLVideoElement).videoWidth  || W;
          natH = (src as HTMLVideoElement).videoHeight || H;
        } else if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) {
          natW = (src as VideoFrame).displayWidth  || W;
          natH = (src as VideoFrame).displayHeight || H;
        } else if (src instanceof ImageBitmap) {
          natW = src.width  || W;
          natH = src.height || H;
        } else {
          natW = W;
          natH = H;
        }

        // Scale video to cover the canvas. Position the video so its center
        // is at (videoCenter.x * W, videoCenter.y * H). The container clip
        // acts as a viewport mask — only the portion under the container is
        // visible. Moving the container reveals different parts of the video
        // without affecting its scale.
        const scale   = Math.max(W / natW, H / natH);
        const scaledW = natW * scale;
        const scaledH = natH * scale;
        const videoX  = videoCenter.x * W - scaledW / 2;
        const videoY  = videoCenter.y * H - scaledH / 2;

        ctx.drawImage(
          src as CanvasImageSource,
          0, 0, natW, natH,
          videoX, videoY, scaledW, scaledH,
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
