/**
 * Scene renderer — pure canvas operations.
 * Composites: gradient background → floating window (video) → cursor.
 * Works with both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
 */
import type { SceneConfig, RenderFrameData } from '../types';
import { GRADIENT_PRESETS, createGradient } from './gradientPresets';
import { CursorSprite } from './cursorSprite';

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class SceneRenderer {
  private cursorSprite = new CursorSprite();
  /** Cached gradient — invalidated when config changes */
  private gradientCache: { id: string; grad: CanvasGradient } | null = null;

  /**
   * Render a single frame onto ctx.
   * The canvas must already be sized to sceneConfig.outputWidth × outputHeight.
   */
  render(ctx: AnyCtx, frame: RenderFrameData, config: SceneConfig): void {
    const { outputWidth: W, outputHeight: H } = config;

    // 1. Gradient background
    this.drawBackground(ctx, config, W, H);

    // 2. Floating window with video
    this.drawFloatingWindow(ctx, frame, config, W, H);

    // 3. Cursor on top (in screen space)
    const cursorDisplayScale = config.cursorScale;

    // Register click ripple
    if (frame.isClick) {
      this.cursorSprite.addRipple(frame.cursorX, frame.cursorY, frame.t);
    }

    this.cursorSprite.draw(
      ctx,
      frame.cursorX,
      frame.cursorY,
      cursorDisplayScale,
      frame.t
    );
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
    H: number
  ): void {
    const { paddingPx, cornerRadiusPx, shadowBlur, shadowAlpha } = config.window;
    const { camera } = frame;

    // Window rect (the video lives inside the padded area)
    const winX = paddingPx;
    const winY = paddingPx;
    const winW = W - paddingPx * 2;
    const winH = H - paddingPx * 2;

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

    // Apply camera transform (zoom/pan) within the window
    ctx.translate(winX + camera.tx * (winW / W), winY + camera.ty * (winH / H));
    ctx.scale(camera.scale, camera.scale);

    // Draw video frame.
    //
    // Two guards:
    //  1. readyState < HAVE_CURRENT_DATA (2) → ctx.drawImage throws InvalidStateError,
    //     which would kill the RAF loop permanently if uncaught.
    //  2. Use COVER semantics (object-fit: cover) — center-crop the source video so
    //     it fills the destination rect without letterbox/pillarbox black bars.
    if (frame.videoSource) {
      const src = frame.videoSource;
      const isVideoEl =
        typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement;
      const hasFrame = !isVideoEl || (src as HTMLVideoElement).readyState >= 2;

      if (hasFrame) {
        const destW = winW / camera.scale;
        const destH = winH / camera.scale;

        // Natural dimensions of the source — must match actual pixel size for
        // cover-crop math to be correct.
        let natW: number;
        let natH: number;
        if (isVideoEl) {
          natW = (src as HTMLVideoElement).videoWidth || destW;
          natH = (src as HTMLVideoElement).videoHeight || destH;
        } else if (typeof VideoFrame !== 'undefined' && src instanceof VideoFrame) {
          natW = (src as VideoFrame).displayWidth || destW;
          natH = (src as VideoFrame).displayHeight || destH;
        } else if (src instanceof ImageBitmap) {
          natW = src.width || destW;
          natH = src.height || destH;
        } else {
          natW = destW;
          natH = destH;
        }

        // Cover crop: scale so the shorter dimension fills the dest, then
        // center-crop the longer dimension.  Eliminates black bars entirely.
        const scale = Math.max(destW / natW, destH / natH);
        const cropW = destW / scale;   // source pixels wide to use
        const cropH = destH / scale;   // source pixels tall to use
        const sx = (natW - cropW) / 2; // center-crop X
        const sy = (natH - cropH) / 2; // center-crop Y

        ctx.drawImage(
          src as CanvasImageSource,
          sx, sy, cropW, cropH,   // source rect (cropped)
          0, 0, destW, destH       // destination rect (fills window)
        );
      }
      // If no frame yet the black window background shows — loop keeps running.
    }

    ctx.restore();
  }

  /** Reset cached gradient on config change */
  invalidateCache(): void {
    this.gradientCache = null;
  }
}

// ─── roundRect polyfill (Chrome 99+ has native, but keep for safety) ─────────

function roundRect(
  ctx: AnyCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
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
