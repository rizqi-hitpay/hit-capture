import { store, setCropRect, setCropMode } from '../state/editorStore';
import type { EditorState, CropRect } from '../../types';
import { SceneRenderer } from '../../renderer/sceneRenderer';
import { PREVIEW_SCALE } from '../../shared/constants';

// Drag state for crop drawing
interface DragState {
  startX: number; // canvas-space
  startY: number;
  curX: number;
  curY: number;
}

export class PreviewCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private renderer = new SceneRenderer();
  private rafId: number | null = null;
  private unsub: (() => void) | null = null;
  private playing = false;
  private drag: DragState | null = null;

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
    this.attachCropListeners();
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
    // Load new video file
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

    // Update canvas cursor style based on crop mode
    this.canvas.style.cursor = state.cropMode ? 'crosshair' : 'default';
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
      state.videoOffset,
    );

    // Overlay: current crop rect guide (dashed orange border)
    if (cropRect && !state.cropMode) {
      this.drawCropGuide(previewW, previewH, cropRect);
    }

    // Overlay: active drag selection
    if (state.cropMode && this.drag) {
      this.drawDragSelection(this.drag);
    }

    this.updateTimeDisplay();
  }

  // ─── Crop overlay helpers ────────────────────────────────────────────────────

  /** Returns the floating window rect in preview-canvas pixels (when no cropRect). */
  private windowRect(previewW: number, previewH: number, paddingPx: number, zoomLevel: number) {
    const baseW = previewW - paddingPx * 2;
    const baseH = previewH - paddingPx * 2;
    const winW = baseW * zoomLevel;
    const winH = baseH * zoomLevel;
    return { x: (previewW - winW) / 2, y: (previewH - winH) / 2, w: winW, h: winH };
  }

  private drawCropGuide(previewW: number, previewH: number, crop: CropRect): void {
    const x = crop.x * previewW;
    const y = crop.y * previewH;
    const w = crop.w * previewW;
    const h = crop.h * previewH;

    this.ctx.save();
    this.ctx.strokeStyle = '#f6ad55';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([6, 3]);
    this.ctx.strokeRect(x, y, w, h);
    this.ctx.setLineDash([]);
    this.ctx.restore();
  }

  private drawDragSelection(drag: DragState): void {
    const x = Math.min(drag.startX, drag.curX);
    const y = Math.min(drag.startY, drag.curY);
    const w = Math.abs(drag.curX - drag.startX);
    const h = Math.abs(drag.curY - drag.startY);

    this.ctx.save();
    // Dark overlay
    this.ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // Clear selection area
    this.ctx.clearRect(x, y, w, h);
    // Re-render just the selection (draw over the cleared area with the scene)
    // — keep it simple: just show the orange border with corner handles
    this.ctx.strokeStyle = '#f6ad55';
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([]);
    this.ctx.strokeRect(x, y, w, h);
    // Rule-of-thirds guides inside selection
    this.ctx.strokeStyle = 'rgba(246,173,85,0.35)';
    this.ctx.lineWidth = 0.5;
    for (let i = 1; i < 3; i++) {
      const gx = x + (w / 3) * i;
      const gy = y + (h / 3) * i;
      this.ctx.beginPath(); this.ctx.moveTo(gx, y); this.ctx.lineTo(gx, y + h); this.ctx.stroke();
      this.ctx.beginPath(); this.ctx.moveTo(x, gy); this.ctx.lineTo(x + w, gy); this.ctx.stroke();
    }
    this.ctx.restore();
  }

  // ─── Crop mouse events ───────────────────────────────────────────────────────

  private attachCropListeners(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      if (!store.get().cropMode) return;
      const pos = this.canvasPos(e);
      this.drag = { startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y };
      e.preventDefault();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      if (!this.drag) return;
      const pos = this.canvasPos(e);
      this.drag = { ...this.drag, curX: pos.x, curY: pos.y };
    });

    const commitDrag = () => {
      if (!this.drag) return;
      const state = store.get();
      if (!state.cropMode) { this.drag = null; return; }

      const cW = this.canvas.width;
      const cH = this.canvas.height;

      const x0 = Math.min(this.drag.startX, this.drag.curX);
      const y0 = Math.min(this.drag.startY, this.drag.curY);
      const x1 = Math.max(this.drag.startX, this.drag.curX);
      const y1 = Math.max(this.drag.startY, this.drag.curY);
      const rectW = x1 - x0;
      const rectH = y1 - y0;

      // Only commit if the drawn rect is large enough to be intentional
      if (rectW > 8 && rectH > 8) {
        // Save as fractions of the output canvas (clamped to [0,1])
        const crop: CropRect = {
          x: Math.max(0, Math.min(1, x0 / cW)),
          y: Math.max(0, Math.min(1, y0 / cH)),
          w: Math.max(0, Math.min(1 - x0 / cW, rectW / cW)),
          h: Math.max(0, Math.min(1 - y0 / cH, rectH / cH)),
        };
        setCropRect(crop); // also sets cropMode = false
      } else {
        setCropMode(false);
      }

      this.drag = null;
    };

    this.canvas.addEventListener('mouseup', commitDrag);
    this.canvas.addEventListener('mouseleave', () => {
      // Cancel drag if mouse leaves canvas
      if (this.drag) { this.drag = null; setCropMode(false); }
    });
  }

  /** Convert a MouseEvent to canvas-pixel coordinates. */
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
