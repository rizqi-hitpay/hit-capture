import { store, setCropRect, setVideoCenter, updateKeyframe, selectKeyframe } from '../state/editorStore';
import type { EditorState, CropRect } from '../../types';
import { SceneRenderer } from '../../renderer/sceneRenderer';
import { PREVIEW_SCALE } from '../../shared/constants';
import { getStateAtTime } from '../utils/keyframeInterpolation';
import type { Timeline } from './Timeline';

// ─── Container interaction types ─────────────────────────────────────────────

type HandleId = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se';

type InteractionMode =
  | { kind: 'idle' }
  | { kind: 'drawing'; startX: number; startY: number; curX: number; curY: number }
  | { kind: 'moving';  startX: number; startY: number; origRect: CropRect; origVideoCenter: { x: number; y: number } }
  | { kind: 'resizing'; handle: HandleId; startX: number; startY: number; origRect: CropRect };

const HANDLE_SIZE = 8;   // px square side
const HANDLE_HIT  = 12;  // px hit radius (generous for small handles)
const MIN_SIZE    = 0.05; // minimum container dimension as fraction
const MIN_DRAW_PX = 16;  // discard micro-drags

const HANDLE_CURSORS: Record<HandleId, string> = {
  nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
   w:  'w-resize',                  e:  'e-resize',
  sw: 'sw-resize', s: 's-resize', se: 'se-resize',
};

// ─── Pure helpers ────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface Rect { x: number; y: number; w: number; h: number; }

function handleCenters(r: Rect): Record<HandleId, { cx: number; cy: number }> {
  const mx = r.x + r.w / 2;
  const my = r.y + r.h / 2;
  const rx = r.x + r.w;
  const ry = r.y + r.h;
  return {
    nw: { cx: r.x, cy: r.y },  n: { cx: mx, cy: r.y },  ne: { cx: rx, cy: r.y },
     w: { cx: r.x, cy: my },                               e: { cx: rx, cy: my },
    sw: { cx: r.x, cy: ry },   s: { cx: mx, cy: ry },   se: { cx: rx, cy: ry },
  };
}

function hitTestContainer(
  px: number, py: number,
  r: Rect,
): { zone: 'handle'; id: HandleId } | { zone: 'body' } | { zone: 'outside' } {
  const centers = handleCenters(r);
  for (const [id, { cx, cy }] of Object.entries(centers) as [HandleId, { cx: number; cy: number }][]) {
    if (Math.abs(px - cx) <= HANDLE_HIT && Math.abs(py - cy) <= HANDLE_HIT) {
      return { zone: 'handle', id };
    }
  }
  if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
    return { zone: 'body' };
  }
  return { zone: 'outside' };
}

function applyResize(
  orig: CropRect,
  handle: HandleId,
  startX: number, startY: number,
  curX: number,   curY: number,
  canvasW: number, canvasH: number,
): CropRect {
  const dx = (curX - startX) / canvasW;
  const dy = (curY - startY) / canvasH;

  let { x, y, w, h } = orig;

  if (handle === 'nw' || handle === 'w' || handle === 'sw') {
    const newX = clamp(x + dx, 0, x + w - MIN_SIZE);
    w = w + (x - newX);
    x = newX;
  }
  if (handle === 'ne' || handle === 'e' || handle === 'se') {
    w = clamp(w + dx, MIN_SIZE, 1 - x);
  }
  if (handle === 'nw' || handle === 'n' || handle === 'ne') {
    const newY = clamp(y + dy, 0, y + h - MIN_SIZE);
    h = h + (y - newY);
    y = newY;
  }
  if (handle === 'sw' || handle === 's' || handle === 'se') {
    h = clamp(h + dy, MIN_SIZE, 1 - y);
  }

  return { x, y, w, h };
}

// ─── Component ───────────────────────────────────────────────────────────────

export class PreviewCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private renderer = new SceneRenderer();
  private rafId: number | null = null;
  private unsub: (() => void) | null = null;
  private playing = false;
  private playPromise: Promise<void> | null = null;
  private imode: InteractionMode = { kind: 'idle' };
  private timeline: Timeline | null = null;
  // For WebM files where video.duration === Infinity, we track the furthest
  // time we've seen so the timeline has something to render against.
  private effectiveDuration = 0;

  constructor(container: HTMLElement) {
    container.innerHTML = `
      <div class="preview-area">
        <canvas id="preview-canvas" class="preview-canvas"></canvas>
      </div>
    `;

    this.canvas = container.querySelector('#preview-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;

    // A DOM-attached video element has a fully active media pipeline in Chrome,
    // ensuring play() works reliably and readyState advances as expected.
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.style.cssText =
      'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(this.video);

    this.video.addEventListener('ended', () => { this.playing = false; });

    // WebM files from MediaRecorder have duration === Infinity. Track the
    // furthest currentTime we observe so getDuration() has a real value.
    const updateEffectiveDuration = () => {
      const t = this.video.currentTime;
      if (t > this.effectiveDuration) {
        this.effectiveDuration = t;
        this.timeline?.syncPlayhead(t);
      }
    };
    this.video.addEventListener('timeupdate', updateEffectiveDuration);
    this.video.addEventListener('seeked',     updateEffectiveDuration);

    this.attachContainerListeners();
    this.unsub = store.subscribe((state) => this.onStateChange(state));
  }

  destroy(): void {
    this.unsub?.();
    this.stopLoop();
    this.video.pause();
    if (this.video.src) URL.revokeObjectURL(this.video.src);
    this.video.src = '';
    this.video.remove();
  }

  public getCurrentTime(): number { return this.video.currentTime; }
  public getDuration(): number {
    if (isFinite(this.video.duration) && this.video.duration > 0) return this.video.duration;
    return this.effectiveDuration;
  }
  public seekTo(t: number): void { this.video.currentTime = t; }
  public isPlaying(): boolean { return this.playing; }
  public isLooping(): boolean { return this.video.loop; }
  public goToStart(): void { this.video.currentTime = 0; }
  public goToEnd(): void { const d = this.getDuration(); if (d > 0) this.video.currentTime = d; }

  public async togglePlay(): Promise<void> {
    if (this.playing) {
      if (this.playPromise) await this.playPromise.catch(() => {});
      this.video.pause();
      this.playing = false;
    } else {
      this.playPromise = this.video.play();
      this.playing = true;
      try {
        await this.playPromise;
      } catch (err) {
        console.error('[PreviewCanvas] play() failed:', (err as Error)?.name, (err as Error)?.message);
        this.playing = false;
      } finally {
        this.playPromise = null;
      }
    }
  }

  public toggleLoop(): void { this.video.loop = !this.video.loop; }
  public setTimeline(t: Timeline): void { this.timeline = t; }

  private onStateChange(state: EditorState): void {
    if (state.videoFile && this.video.src === '') {
      this.video.src = URL.createObjectURL(state.videoFile);
      this.video.load();
      this.video.addEventListener('error', () => {
        const e = this.video.error;
        console.error('[PreviewCanvas] Video load error:', e?.code, e?.message);
      }, { once: true });
      // Once metadata is available, probe the real duration.
      // For WebM files video.duration === Infinity even after loadedmetadata,
      // so we seek to a huge value; the browser clamps to the true end and the
      // seeked event reveals the actual duration. Then we jump back to 0.
      this.video.addEventListener('loadedmetadata', () => {
        if (isFinite(this.video.duration) && this.video.duration > 0) {
          this.effectiveDuration = this.video.duration;
          this.timeline?.syncPlayhead(0);
        } else {
          // WebM: seek to end to discover real duration
          let probing = true;
          const onSeeked = () => {
            if (!probing) return;
            probing = false;
            this.effectiveDuration = this.video.currentTime;
            this.video.removeEventListener('seeked', onSeeked);
            this.video.currentTime = 0;
            this.timeline?.syncPlayhead(0);
          };
          this.video.addEventListener('seeked', onSeeked);
          this.video.currentTime = 1e9;
        }
      }, { once: true });
    }

    if (state.phase === 'ready') {
      const W = Math.round(state.sceneConfig.outputWidth  * PREVIEW_SCALE);
      const H = Math.round(state.sceneConfig.outputHeight * PREVIEW_SCALE);
      if (this.canvas.width !== W || this.canvas.height !== H) {
        this.canvas.width  = W;
        this.canvas.height = H;
        this.renderer.invalidateCache();
      }
      this.startLoop();
    }
  }

  // ─── Render loop ────────────────────────────────────────────────────────────

  private startLoop(): void {
    if (this.rafId !== null) return;
    const loop = () => {
      try { this.drawFrame(); } catch (err) {
        console.error('[PreviewCanvas] drawFrame error:', err);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  private drawFrame(): void {
    const state = store.get();
    if (state.phase !== 'ready') return;

    const t = this.video.currentTime;
    let { cropRect, videoCenter, zoomLevel } = state;
    let zoom = 1.0;

    const useInterpolation =
      state.keyframes.length > 0 &&
      (state.editorMode === 'preview' || state.selectedKeyframeId === null);

    if (useInterpolation) {
      const interp = getStateAtTime(state.keyframes, t);
      if (interp) {
        cropRect    = interp.containerRect;
        videoCenter = interp.videoCenter;
        zoom        = interp.zoom;
      }
    } else if (state.selectedKeyframeId !== null) {
      const kf = state.keyframes.find((k) => k.id === state.selectedKeyframeId);
      zoom = kf ? kf.zoom : zoomLevel;
    }

    const previewW = this.canvas.width;
    const previewH = this.canvas.height;
    const { sceneConfig } = state;

    const previewConfig = {
      ...sceneConfig,
      outputWidth:  previewW,
      outputHeight: previewH,
      window: {
        ...sceneConfig.window,
        paddingPx:      Math.round(sceneConfig.window.paddingPx      * PREVIEW_SCALE),
        cornerRadiusPx: Math.round(sceneConfig.window.cornerRadiusPx * PREVIEW_SCALE),
        shadowBlur:     Math.round(sceneConfig.window.shadowBlur      * PREVIEW_SCALE),
      },
      cursorScale: 0,
    };

    this.renderer.render(
      this.ctx,
      { videoSource: this.video, cursorX: 0, cursorY: 0, isClick: false, clickProgress: 0, camera: { scale: 1, tx: 0, ty: 0 }, t: 0 },
      previewConfig,
      cropRect,
      1.0,
      videoCenter,
      zoom,
    );

    this.drawContainerOverlay();
    this.timeline?.syncPlayhead(t);
  }

  // ─── Container overlay ───────────────────────────────────────────────────────

  private drawContainerOverlay(): void {
    if (store.get().editorMode === 'preview') return;
    if (this.imode.kind === 'drawing') {
      this.drawDrawingOverlay();
      return;
    }

    const r = store.get().cropRect;
    if (!r) return;

    const cW = this.canvas.width;
    const cH = this.canvas.height;
    const x = r.x * cW;
    const y = r.y * cH;
    const w = r.w * cW;
    const h = r.h * cH;

    this.ctx.save();

    // Dashed white border
    this.ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([5, 4]);
    this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    this.ctx.setLineDash([]);

    // Resize handles — only shown when Edit Container mode is active
    if (store.get().editContainerMode) {
      const hs = HANDLE_SIZE;
      const centers = handleCenters({ x, y, w, h });
      for (const { cx, cy } of Object.values(centers)) {
        this.ctx.fillStyle = '#fff';
        this.ctx.strokeStyle = '#6366f1';
        this.ctx.lineWidth = 1.5;
        this.ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        this.ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
      }
    }

    this.ctx.restore();
  }

  private drawDrawingOverlay(): void {
    if (this.imode.kind !== 'drawing') return;
    const { startX, startY, curX, curY } = this.imode;
    const x = Math.min(startX, curX);
    const y = Math.min(startY, curY);
    const w = Math.abs(curX - startX);
    const h = Math.abs(curY - startY);

    this.ctx.save();
    this.ctx.strokeStyle = '#6366f1';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([6, 3]);
    this.ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  // ─── Container interaction ───────────────────────────────────────────────────

  private containerPx(): Rect | null {
    const r = store.get().cropRect;
    if (!r) return null;
    return {
      x: r.x * this.canvas.width,
      y: r.y * this.canvas.height,
      w: r.w * this.canvas.width,
      h: r.h * this.canvas.height,
    };
  }

  private attachContainerListeners(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      const st = store.get();
      if (st.phase !== 'ready' || st.editorMode === 'preview') return;
      const pos = this.canvasPos(e);
      const container = this.containerPx();

      if (container) {
        const hit = hitTestContainer(pos.x, pos.y, container);
        if (hit.zone === 'handle' && st.editContainerMode) {
          const origRect = store.get().cropRect!;
          this.imode = { kind: 'resizing', handle: hit.id, startX: pos.x, startY: pos.y, origRect };
          e.preventDefault();
          return;
        }
        if (hit.zone === 'body' || (hit.zone === 'handle' && !st.editContainerMode)) {
          const { cropRect, videoCenter } = store.get();
          this.imode = {
            kind: 'moving',
            startX: pos.x,
            startY: pos.y,
            origRect: cropRect!,
            origVideoCenter: { ...videoCenter },
          };
          e.preventDefault();
          return;
        }
      }

      // Click on background → deselect keyframe, start drawing new container
      selectKeyframe(null);
      this.imode = { kind: 'drawing', startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y };
      e.preventDefault();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (store.get().editorMode === 'preview') {
        this.canvas.style.cursor = 'default';
        return;
      }
      const pos = this.canvasPos(e);

      if (this.imode.kind === 'idle') {
        const container = this.containerPx();
        if (container) {
          const hit = hitTestContainer(pos.x, pos.y, container);
          if (hit.zone === 'handle' && store.get().editContainerMode) {
            this.canvas.style.cursor = HANDLE_CURSORS[hit.id];
          } else if (hit.zone === 'body' || hit.zone === 'handle') {
            this.canvas.style.cursor = 'move';
          } else {
            this.canvas.style.cursor = 'crosshair';
          }
        } else {
          this.canvas.style.cursor = 'crosshair';
        }
        return;
      }

      if (this.imode.kind === 'drawing') {
        this.imode = { ...this.imode, curX: pos.x, curY: pos.y };
        return;
      }

      if (this.imode.kind === 'moving') {
        const { startX, startY, origRect, origVideoCenter } = this.imode;
        const dx = (pos.x - startX) / this.canvas.width;
        const dy = (pos.y - startY) / this.canvas.height;
        const newRect = {
          ...origRect,
          x: clamp(origRect.x + dx, 0, 1 - origRect.w),
          y: clamp(origRect.y + dy, 0, 1 - origRect.h),
        };
        setCropRect(newRect);
        const { selectedKeyframeId } = store.get();
        if (selectedKeyframeId) {
          updateKeyframe(selectedKeyframeId, { containerRect: newRect });
        }
        if (!store.get().editContainerMode) {
          const newCenter = {
            x: origVideoCenter.x + dx,
            y: origVideoCenter.y + dy,
          };
          setVideoCenter(newCenter);
          if (selectedKeyframeId) {
            updateKeyframe(selectedKeyframeId, { videoCenter: newCenter });
          }
        }
        return;
      }

      if (this.imode.kind === 'resizing') {
        const { handle, startX, startY, origRect } = this.imode;
        const newRect = applyResize(origRect, handle, startX, startY, pos.x, pos.y, this.canvas.width, this.canvas.height);
        setCropRect(newRect);
        const { selectedKeyframeId } = store.get();
        if (selectedKeyframeId) {
          updateKeyframe(selectedKeyframeId, { containerRect: newRect });
        }
        return;
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      if (this.imode.kind === 'drawing') {
        this.commitDraw();
      }
      this.imode = { kind: 'idle' };
      this.canvas.style.cursor = 'crosshair';
    });

    this.canvas.addEventListener('mouseleave', () => {
      if (this.imode.kind === 'drawing') {
        // Discard in-progress draw — leave existing container unchanged
      }
      // moving/resizing: live state is already committed to store, nothing to do
      this.imode = { kind: 'idle' };
    });
  }

  private commitDraw(): void {
    if (this.imode.kind !== 'drawing') return;
    const { startX, startY, curX, curY } = this.imode;
    const x0 = Math.min(startX, curX);
    const y0 = Math.min(startY, curY);
    const x1 = Math.max(startX, curX);
    const y1 = Math.max(startY, curY);
    const wPx = x1 - x0;
    const hPx = y1 - y0;

    if (wPx > MIN_DRAW_PX && hPx > MIN_DRAW_PX) {
      setCropRect({
        x: clamp(x0 / this.canvas.width,  0, 1),
        y: clamp(y0 / this.canvas.height, 0, 1),
        w: clamp(wPx / this.canvas.width,  0, 1 - x0 / this.canvas.width),
        h: clamp(hPx / this.canvas.height, 0, 1 - y0 / this.canvas.height),
      });
    }
  }

  /** Convert a MouseEvent to canvas-pixel coordinates (accounting for CSS scaling). */
  private canvasPos(e: MouseEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width  / rect.width;
    const scaleY = this.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  }

}
