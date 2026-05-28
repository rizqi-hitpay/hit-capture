/**
 * PreviewCanvas — live preview at 50% resolution.
 * Renders the scene (gradient bg + floating window + polished cursor) in real time.
 */
import { store } from '../state/editorStore';
import type { EditorState, RawEvent } from '../../types';
import { SceneRenderer } from '../../renderer/sceneRenderer';
import { ZoomController } from '../../renderer/zoomController';
import { transformPoint } from '../../shared/coords';
import { PREVIEW_SCALE } from '../../shared/constants';

export class PreviewCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private renderer = new SceneRenderer();
  private zoom: ZoomController | null = null;
  private rafId: number | null = null;
  private unsub: (() => void) | null = null;
  private playing = false;

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

    // Create the video element and add it to the DOM (hidden).
    // A DOM-attached video element has a fully active media pipeline in Chrome,
    // which means play() works reliably and readyState advances as expected.
    // A purely detached element can silently fail play() on some formats.
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    this.video.style.cssText =
      'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;';
    document.body.appendChild(this.video);

    this.attachPlaybackControls(container);
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
    // Update video source when a new file is loaded
    if (state.videoFile && this.video.src === '') {
      const objectUrl = URL.createObjectURL(state.videoFile);
      this.video.src = objectUrl;
      this.video.load();

      this.video.addEventListener('error', () => {
        const e = this.video.error;
        console.error('[PreviewCanvas] Video load error — code:', e?.code, e?.message);
      }, { once: true });
    }

    // Update canvas size and zoom when track or config changes
    if (state.polishedTrack && state.phase === 'ready') {
      const W = Math.round(state.sceneConfig.outputWidth * PREVIEW_SCALE);
      const H = Math.round(state.sceneConfig.outputHeight * PREVIEW_SCALE);
      if (this.canvas.width !== W || this.canvas.height !== H) {
        this.canvas.width = W;
        this.canvas.height = H;
        this.renderer.invalidateCache();
      }

      this.zoom = new ZoomController(state.sceneConfig.autoZoom);
      this.zoom.build(
        state.polishedTrack,
        state.session?.viewport.w ?? state.sceneConfig.outputWidth,
        state.session?.viewport.h ?? state.sceneConfig.outputHeight
      );

      this.startLoop();
    }
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    const loop = () => {
      // Wrap in try/catch so a one-off render error never permanently kills
      // the loop — just log it and keep going on the next frame.
      try {
        this.drawFrame();
      } catch (err) {
        console.error('[PreviewCanvas] drawFrame error:', err);
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private drawFrame(): void {
    const state = store.get();
    if (state.phase !== 'ready' || !state.polishedTrack) return;

    const currentTimeMs = this.video.currentTime * 1000;
    const { polishedTrack, session, coordTransform, showRawCursor, sceneConfig } = state;

    // Get cursor position
    const points = showRawCursor
      ? (session?.events.filter((e) => e.k === 'move' || e.k === 'down').map((e) => ({
          t: e.t, x: (e as RawEvent).x, y: (e as RawEvent).y
        })) ?? [])
      : polishedTrack.points;

    const { x: rawX, y: rawY } = getCursorAtTime(points, currentTimeMs);
    const { x: vidX, y: vidY } = transformPoint(rawX, rawY, coordTransform);

    // Map video-pixel cursor to preview-canvas coordinates
    const previewW = this.canvas.width;
    const previewH = this.canvas.height;
    const cursorX = (vidX / (session?.viewport.w ?? sceneConfig.outputWidth)) * previewW;
    const cursorY = (vidY / (session?.viewport.h ?? sceneConfig.outputHeight)) * previewH;

    const isClick = polishedTrack.clicks.some((c) => Math.abs(c.t - currentTimeMs) < 50);
    const camera = this.zoom?.getCamera(currentTimeMs) ?? { scale: 1, tx: 0, ty: 0 };

    // Scale preview config
    const previewConfig = {
      ...sceneConfig,
      outputWidth: previewW,
      outputHeight: previewH,
      window: {
        ...sceneConfig.window,
        paddingPx: Math.round(sceneConfig.window.paddingPx * PREVIEW_SCALE),
        cornerRadiusPx: Math.round(sceneConfig.window.cornerRadiusPx * PREVIEW_SCALE),
        shadowBlur: Math.round(sceneConfig.window.shadowBlur * PREVIEW_SCALE),
      },
      cursorScale: sceneConfig.cursorScale * PREVIEW_SCALE,
    };

    this.renderer.render(this.ctx, {
      videoSource: this.video,
      cursorX,
      cursorY,
      isClick,
      clickProgress: 0,
      camera,
      t: currentTimeMs,
    }, previewConfig);

    // Update time display
    this.updateTimeDisplay();
  }

  private attachPlaybackControls(container: HTMLElement): void {
    const playBtn = container.querySelector('#btn-play') as HTMLButtonElement;
    const scrubber = container.querySelector('#scrubber') as HTMLInputElement;

    // Track the in-flight play() promise so we can await it before pausing.
    let playPromise: Promise<void> | null = null;

    playBtn.addEventListener('click', async () => {
      if (this.playing) {
        // Must await the play() promise before calling pause(), otherwise Chrome
        // throws AbortError: "play() interrupted by pause()".
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
          // Log the rejection reason so it's visible in DevTools
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
      // video.duration is Infinity for WebM from MediaRecorder and NaN until
      // metadata loads — guard both cases.
      if (!isFinite(this.video.duration)) return;
      const pct = parseFloat(scrubber.value) / 100;
      this.video.currentTime = this.video.duration * pct;
    });

    this.video.addEventListener('timeupdate', () => {
      if (isFinite(this.video.duration) && this.video.duration > 0) {
        scrubber.value = String((this.video.currentTime / this.video.duration) * 100);
      }
    });
  }

  private updateTimeDisplay(): void {
    const el = document.getElementById('time-display');
    if (!el) return;
    const fmt = (s: number) => {
      if (!isFinite(s)) return '?:??';
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60);
      return `${m}:${String(sec).padStart(2, '0')}`;
    };
    el.textContent = `${fmt(this.video.currentTime)} / ${fmt(this.video.duration)}`;
  }
}

// ─── Cursor interpolation helper ─────────────────────────────────────────────

function getCursorAtTime(
  points: Array<{ t: number; x: number; y: number }>,
  timeMs: number
): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  if (timeMs <= points[0].t) return { x: points[0].x, y: points[0].y };
  if (timeMs >= points[points.length - 1].t) {
    const last = points[points.length - 1];
    return { x: last.x, y: last.y };
  }

  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= timeMs) lo = mid;
    else hi = mid;
  }

  const prev = points[lo];
  const next = points[hi];
  const span = next.t - prev.t;
  const alpha = span > 0 ? (timeMs - prev.t) / span : 0;
  return {
    x: prev.x + (next.x - prev.x) * alpha,
    y: prev.y + (next.y - prev.y) * alpha,
  };
}
