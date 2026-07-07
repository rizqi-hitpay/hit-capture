/**
 * Scene renderer — pure canvas operations.
 * Composites: gradient background → floating window (video).
 * Works with both CanvasRenderingContext2D and OffscreenCanvasRenderingContext2D.
 */
import type { SceneConfig, RenderFrameData, CropRect, VideoCenter, Skew } from '../types';
import { GRADIENT_PRESETS, createGradient } from './gradientPresets';

type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class SceneRenderer {
  /** Cached gradient — invalidated when config or canvas size changes */
  private gradientCache: { id: string; grad: CanvasGradient } | null = null;
  /** Scratch canvases for the 3D tilt projection passes */
  private tiltA: OffscreenCanvas | null = null;
  private tiltB: OffscreenCanvas | null = null;

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
   * @param skew        Window skew in degrees, applied around the window center.
   */
  render(
    ctx: AnyCtx,
    frame: RenderFrameData,
    config: SceneConfig,
    cropRect: CropRect | null = null,
    zoomLevel = 1.0,
    videoCenter: VideoCenter = { x: 0.5, y: 0.5 },
    zoom = 1.0,
    skew: Skew = { x: 0, y: 0, z: 0, tiltX: 0, tiltY: 0 },
  ): void {
    const { outputWidth: W, outputHeight: H } = config;
    this.drawBackground(ctx, config, W, H);

    const hasTilt = (skew.tiltX ?? 0) !== 0 || (skew.tiltY ?? 0) !== 0;
    if (!hasTilt) {
      this.drawFloatingWindow(ctx, frame, config, W, H, cropRect, zoomLevel, videoCenter, zoom, skew);
      return;
    }

    // 3D tilt: render the window (with its 2D skew/rotation) onto a
    // transparent scratch canvas, then perspective-project it strip by strip.
    const a = this.ensureTiltCanvas('a', W, H);
    const actx = a.getContext('2d') as OffscreenCanvasRenderingContext2D;
    actx.clearRect(0, 0, W, H);
    this.drawFloatingWindow(actx, frame, config, W, H, cropRect, zoomLevel, videoCenter, zoom, skew);

    const { winX, winY, winW, winH } = this.windowRect(config, W, H, cropRect, zoomLevel);
    const cx = winX + winW / 2;
    const cy = winY + winH / 2;

    if (skew.tiltY !== 0 && skew.tiltX !== 0) {
      const b = this.ensureTiltCanvas('b', W, H);
      const bctx = b.getContext('2d') as OffscreenCanvasRenderingContext2D;
      bctx.clearRect(0, 0, W, H);
      projectTilt(a, bctx, 'y', skew.tiltY, cx, cy);
      projectTilt(b, ctx, 'x', skew.tiltX, cx, cy);
    } else if (skew.tiltY !== 0) {
      projectTilt(a, ctx, 'y', skew.tiltY, cx, cy);
    } else {
      projectTilt(a, ctx, 'x', skew.tiltX, cx, cy);
    }
  }

  private ensureTiltCanvas(which: 'a' | 'b', W: number, H: number): OffscreenCanvas {
    const cur = which === 'a' ? this.tiltA : this.tiltB;
    if (cur && cur.width === W && cur.height === H) return cur;
    const fresh = new OffscreenCanvas(W, H);
    if (which === 'a') this.tiltA = fresh; else this.tiltB = fresh;
    return fresh;
  }

  /** Floating-window rect in canvas px (shared by drawing and tilt pivot). */
  private windowRect(
    config: SceneConfig,
    W: number,
    H: number,
    cropRect: CropRect | null,
    zoomLevel: number,
  ): { winX: number; winY: number; winW: number; winH: number } {
    if (cropRect) {
      return {
        winX: cropRect.x * W,
        winY: cropRect.y * H,
        winW: cropRect.w * W,
        winH: cropRect.h * H,
      };
    }
    const { paddingPx } = config.window;
    const winW = (W - paddingPx * 2) * zoomLevel;
    const winH = (H - paddingPx * 2) * zoomLevel;
    return { winX: (W - winW) / 2, winY: (H - winH) / 2, winW, winH };
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
    zoom: number,
    skew: Skew,
  ): void {
    const { cornerRadiusPx, shadowBlur, shadowAlpha } = config.window;

    // cropRect positions the floating window as fractions of the output canvas.
    // When absent, the window fills the padded area scaled by zoomLevel.
    const { winX, winY, winW, winH } = this.windowRect(config, W, H, cropRect, zoomLevel);

    // Skew/rotate the whole window (mask, shadow, and content) around its
    // center: z rotates in the plane, then x/y shear.
    const hasSkew = skew.x !== 0 || skew.y !== 0 || skew.z !== 0;
    if (hasSkew) {
      const cx = winX + winW / 2;
      const cy = winY + winH / 2;
      ctx.save();
      ctx.translate(cx, cy);
      if (skew.z !== 0) ctx.rotate((skew.z * Math.PI) / 180);
      ctx.transform(
        1, Math.tan((skew.y * Math.PI) / 180),
        Math.tan((skew.x * Math.PI) / 180), 1,
        0, 0,
      );
      ctx.translate(-cx, -cy);
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
        const scale   = Math.max(W / natW, H / natH) * zoom;
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
    if (hasSkew) ctx.restore();
  }

  /** Reset cached gradient (call when config or canvas size changes) */
  invalidateCache(): void {
    this.gradientCache = null;
  }
}

// ─── 3D tilt projection ──────────────────────────────────────────────────────

/**
 * Perspective-projects src onto dst, rotating the image plane around a
 * vertical ('y') or horizontal ('x') axis through (cx, cy). Approximates a
 * textured 3D quad by painting each 1px DESTINATION column/row exactly once,
 * inverse-mapping it to its source strip — no overlap (which double-composites
 * translucent pixels like the drop shadow into dark bands) and no gaps.
 */
function projectTilt(
  src: OffscreenCanvas,
  dst: AnyCtx,
  axis: 'x' | 'y',
  angleDeg: number,
  cx: number,
  cy: number,
): void {
  const W = src.width;
  const H = src.height;
  const rad = (angleDeg * Math.PI) / 180;
  const sin = Math.sin(rad);
  const cos = Math.cos(rad);
  // Focal length: perspective strength. Scales with canvas size so preview
  // (half resolution) and export look identical.
  const f = 1.5 * Math.max(W, H);

  // Forward: source offset u from the pivot → screen offset (depth z = u·sin).
  const proj = (u: number) => (u * cos * f) / (f + u * sin);
  // Inverse: screen offset xp → source offset u.
  const unproj = (xp: number) => (xp * f) / (f * cos - xp * sin);
  const scaleAt = (u: number) => f / (f + u * sin);

  if (axis === 'y') {
    const eA = cx + proj(0 - cx);
    const eB = cx + proj(W - cx);
    const lo = Math.max(0, Math.floor(Math.min(eA, eB)));
    const hi = Math.min(W, Math.ceil(Math.max(eA, eB)));
    for (let dx = lo; dx < hi; dx++) {
      const xp = dx + 0.5 - cx;
      if (f * cos - xp * sin <= 0) continue; // behind the camera
      const u = unproj(xp);
      const sx = cx + u;
      if (sx < 0 || sx >= W) continue;
      const s = scaleAt(u);
      if (s <= 0) continue;
      // Source px covered by this 1px dest column: 1 / d(proj)/du = 1/(cos·s²)
      const srcW = 1 / (cos * s * s);
      dst.drawImage(src, sx - srcW / 2, 0, srcW, H, dx, cy * (1 - s), 1, H * s);
    }
  } else {
    const eA = cy + proj(0 - cy);
    const eB = cy + proj(H - cy);
    const lo = Math.max(0, Math.floor(Math.min(eA, eB)));
    const hi = Math.min(H, Math.ceil(Math.max(eA, eB)));
    for (let dy = lo; dy < hi; dy++) {
      const yp = dy + 0.5 - cy;
      if (f * cos - yp * sin <= 0) continue;
      const u = unproj(yp);
      const sy = cy + u;
      if (sy < 0 || sy >= H) continue;
      const s = scaleAt(u);
      if (s <= 0) continue;
      const srcH = 1 / (cos * s * s);
      dst.drawImage(src, 0, sy - srcH / 2, W, srcH, cx * (1 - s), dy, W * s, 1);
    }
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
