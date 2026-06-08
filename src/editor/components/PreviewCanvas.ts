import { store, setCropRect, setVideoCenter } from '../state/editorStore';
import type { EditorState, CropRect } from '../../types';
import { SceneRenderer } from '../../renderer/sceneRenderer';
import { PREVIEW_SCALE } from '../../shared/constants';

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
  private imode: InteractionMode = { kind: 'idle' };

  constructor(container: HTMLElement) {
    container.innerHTML = `
      <div class="preview-area">
        <canvas id="preview-canvas" class="preview-canvas"></canvas>
        <div class="playback-controls">
          <button class="btn-play" id="btn-play">▶</button>
          <input type="range" id="scrubber" class="scrubber" min="0" max="100" value="0" step="0.1" />
          <span class="time-display" id="time-display">0:00 / 0:00</span>
        </div>
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

    this.attachPlaybackControls(container);
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

  private onStateChange(state: EditorState): void {
    if (state.videoFile && this.video.src === '') {
      this.video.src = URL.createObjectURL(state.videoFile);
      this.video.load();
      this.video.addEventListener('error', () => {
        const e = this.video.error;
        console.error('[PreviewCanvas] Video load error:', e?.code, e?.message);
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

    const previewW = this.canvas.width;
    const previewH = this.canvas.height;
    const { sceneConfig, cropRect, zoomLevel } = state;

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
      zoomLevel,
      state.videoCenter,
    );

    this.drawContainerOverlay();
    this.updateTimeDisplay();
  }

  // ─── Container overlay ───────────────────────────────────────────────────────

  private drawContainerOverlay(): void {
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

    // 8 resize handles — white fill, indigo border
    const hs = HANDLE_SIZE;
    const centers = handleCenters({ x, y, w, h });
    for (const { cx, cy } of Object.values(centers)) {
      this.ctx.fillStyle = '#fff';
      this.ctx.strokeStyle = '#6366f1';
      this.ctx.lineWidth = 1.5;
      this.ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      this.ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
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
      if (store.get().phase !== 'ready') return;
      const pos = this.canvasPos(e);
      const container = this.containerPx();

      if (container) {
        const hit = hitTestContainer(pos.x, pos.y, container);
        if (hit.zone === 'handle') {
          const origRect = store.get().cropRect!;
          this.imode = { kind: 'resizing', handle: hit.id, startX: pos.x, startY: pos.y, origRect };
          e.preventDefault();
          return;
        }
        if (hit.zone === 'body') {
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

      // Click on background → start drawing new container
      this.imode = { kind: 'drawing', startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y };
      e.preventDefault();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const pos = this.canvasPos(e);

      if (this.imode.kind === 'idle') {
        const container = this.containerPx();
        if (container) {
          const hit = hitTestContainer(pos.x, pos.y, container);
          if (hit.zone === 'handle') {
            this.canvas.style.cursor = HANDLE_CURSORS[hit.id];
          } else if (hit.zone === 'body') {
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
        if (!store.get().editContainerMode) {
          // Non-edit mode: move video center by same delta → same video content stays visible
          setVideoCenter({
            x: origVideoCenter.x + dx,
            y: origVideoCenter.y + dy,
          });
        }
        return;
      }

      if (this.imode.kind === 'resizing') {
        const { handle, startX, startY, origRect } = this.imode;
        setCropRect(applyResize(origRect, handle, startX, startY, pos.x, pos.y, this.canvas.width, this.canvas.height));
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

  // ─── Playback controls ───────────────────────────────────────────────────────

  private attachPlaybackControls(container: HTMLElement): void {
    const playBtn = container.querySelector('#btn-play') as HTMLButtonElement;
    const scrubber = container.querySelector('#scrubber') as HTMLInputElement;

    let playPromise: Promise<void> | null = null;

    playBtn.addEventListener('click', async () => {
      if (this.playing) {
        if (playPromise) await playPromise.catch(() => {});
        this.video.pause();
        this.playing = false;
        playBtn.textContent = '▶';
      } else {
        playPromise = this.video.play();
        this.playing = true;
        playBtn.textContent = '⏸';
        try {
          await playPromise;
        } catch (err) {
          console.error('[PreviewCanvas] play() failed:', (err as Error)?.name, (err as Error)?.message);
          this.playing = false;
          playBtn.textContent = '▶';
        } finally {
          playPromise = null;
        }
      }
    });

    this.video.addEventListener('ended', () => {
      this.playing = false;
      playBtn.textContent = '▶';
    });

    scrubber.addEventListener('input', () => {
      const dur = isFinite(this.video.duration) ? this.video.duration : 0;
      if (dur > 0) this.video.currentTime = dur * (parseFloat(scrubber.value) / 100);
    });

    this.video.addEventListener('timeupdate', () => {
      const dur = isFinite(this.video.duration) ? this.video.duration : 0;
      if (dur > 0) scrubber.value = String((this.video.currentTime / dur) * 100);
    });
  }

  private updateTimeDisplay(): void {
    const el = document.getElementById('time-display');
    if (!el) return;
    const fmt = (s: number) => {
      if (!isFinite(s) || isNaN(s)) return '?:??';
      const m = Math.floor(s / 60);
      return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    };
    const dur = isFinite(this.video.duration) ? this.video.duration : 0;
    el.textContent = `${fmt(this.video.currentTime)} / ${fmt(dur)}`;
  }
}
