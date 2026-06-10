import {
  store,
  addKeyframe,
  duplicateKeyframe,
  updateKeyframe,
  deleteKeyframe,
  selectKeyframe,
  undoKeyframe,
  canUndoKeyframe,
  setEditorMode,
} from '../state/editorStore';

export interface VideoControls {
  togglePlay(): void;
  isPlaying(): boolean;
  isLooping(): boolean;
  toggleLoop(): void;
  goToStart(): void;
  goToEnd(): void;
  getCurrentTime(): number;
  getDuration(): number;
  seekTo(t: number): void;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || isNaN(s)) return '0:00.0';
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${sec}`;
}

export class Timeline {
  private el: HTMLElement;
  private ruler: HTMLElement;
  private playhead: HTMLElement;
  private controls: VideoControls;
  private unsub: (() => void) | null = null;
  private draggingKfId: string | null = null;
  private lastKnownDuration = 0;

  constructor(container: HTMLElement, controls: VideoControls) {
    this.controls = controls;

    container.innerHTML = `
      <div class="timeline">

        <div class="timeline-ruler" id="timeline-ruler">
          <div class="timeline-playhead" id="timeline-playhead"></div>
        </div>

        <div class="timeline-controls">

          <!-- Mode toggle -->
          <div class="mode-toggle" id="mode-toggle">
            <button class="mode-btn" id="btn-mode-animate" title="Edit keyframes">✏ Animate</button>
            <button class="mode-btn" id="btn-mode-preview" title="Preview animation">▶ Preview</button>
          </div>

          <div class="ctrl-divider"></div>

          <!-- Playback -->
          <div class="ctrl-group">
            <button class="btn-ctrl" id="btn-to-start"  title="Go to start (Home)">⏮</button>
            <button class="btn-ctrl" id="btn-prev-kf"   title="Previous keyframe">◀ KF</button>
            <button class="btn-ctrl btn-ctrl--play" id="btn-play" title="Play / Pause (Space)">▶</button>
            <button class="btn-ctrl" id="btn-next-kf"   title="Next keyframe">KF ▶</button>
            <button class="btn-ctrl" id="btn-to-end"    title="Go to end (End)">⏭</button>
            <button class="btn-ctrl" id="btn-loop"      title="Toggle loop">↺ Loop</button>
          </div>

          <!-- Time display -->
          <span class="tl-time" id="tl-time">0:00.0 / 0:00.0</span>

          <div class="ctrl-spacer"></div>

          <!-- Keyframe controls (hidden in preview mode) -->
          <div class="ctrl-group" id="kf-controls">
            <button class="btn-ctrl" id="btn-undo"       title="Undo (Ctrl+Z)"               disabled>↩ Undo</button>
            <button class="btn-ctrl btn-ctrl--accent" id="btn-add-kf"    title="Add keyframe at current time">+ KF</button>
            <button class="btn-ctrl" id="btn-dupe-kf"   title="Duplicate selected keyframe to current time" disabled>⧉ KF</button>
            <button class="btn-ctrl btn-ctrl--danger" id="btn-delete-kf" title="Delete selected keyframe"   disabled>✕ KF</button>
          </div>

        </div>
      </div>
    `;

    this.el        = container;
    this.ruler     = container.querySelector('#timeline-ruler')!;
    this.playhead  = container.querySelector('#timeline-playhead')!;

    this.attachListeners();
    this.unsub = store.subscribe(() => this.renderState());
    this.renderState();
  }

  /** Called from PreviewCanvas RAF loop on every frame. */
  syncPlayhead(t: number): void {
    const dur = this.controls.getDuration();

    // Re-render tick marks the first time a valid duration arrives (e.g. after
    // loadedmetadata fires, or after WebM effectiveDuration grows past zero).
    if (dur > 0 && Math.abs(dur - this.lastKnownDuration) > 0.5) {
      this.lastKnownDuration = dur;
      this.renderMarkers();
    }

    if (dur > 0) this.playhead.style.left = `${(t / dur) * 100}%`;

    // Time display
    const timeEl = this.el.querySelector('#tl-time') as HTMLElement | null;
    if (timeEl) timeEl.textContent = `${fmtTime(t)} / ${fmtTime(dur)}`;

    // Play button label
    const playBtn = this.el.querySelector('#btn-play') as HTMLButtonElement | null;
    if (playBtn) playBtn.textContent = this.controls.isPlaying() ? '⏸' : '▶';

    // Loop button active state
    const loopBtn = this.el.querySelector('#btn-loop') as HTMLButtonElement | null;
    if (loopBtn) loopBtn.classList.toggle('btn-ctrl--active', this.controls.isLooping());

    // Undo button
    const undoBtn = this.el.querySelector('#btn-undo') as HTMLButtonElement | null;
    if (undoBtn) undoBtn.disabled = !canUndoKeyframe();
  }

  destroy(): void {
    this.unsub?.();
    document.removeEventListener('mousemove', this.onDocMouseMove);
    document.removeEventListener('mouseup',   this.onDocMouseUp);
  }

  // ─── State-driven render ──────────────────────────────────────────────────────

  private renderState(): void {
    this.renderMarkers();
    this.renderModeButtons();
  }

  private renderModeButtons(): void {
    const { editorMode } = store.get();

    const animBtn = this.el.querySelector('#btn-mode-animate') as HTMLButtonElement | null;
    const prevBtn = this.el.querySelector('#btn-mode-preview') as HTMLButtonElement | null;
    const kfCtrls = this.el.querySelector('#kf-controls')     as HTMLElement | null;

    if (animBtn) animBtn.classList.toggle('mode-btn--active', editorMode === 'animate');
    if (prevBtn) prevBtn.classList.toggle('mode-btn--active', editorMode === 'preview');
    if (kfCtrls) kfCtrls.style.display = editorMode === 'animate' ? 'flex' : 'none';
  }

  private renderMarkers(): void {
    this.ruler.querySelectorAll('.kf-marker, .tl-tick').forEach((el) => el.remove());

    const state = store.get();
    const dur   = this.controls.getDuration();

    if (dur > 0) {
      const maxTicks = Math.min(Math.floor(dur), 120);
      for (let i = 1; i <= maxTicks; i++) {
        const tick = document.createElement('div');
        tick.className = 'tl-tick';
        tick.style.left = `${(i / dur) * 100}%`;
        if (i % 5 === 0) {
          tick.classList.add('tl-tick--major');
          const label = document.createElement('span');
          label.className = 'tl-tick-label';
          label.textContent = fmtTime(i);
          tick.appendChild(label);
        }
        this.ruler.appendChild(tick);
      }

      state.keyframes.forEach((kf) => {
        const marker = document.createElement('div');
        marker.className = 'kf-marker';
        if (kf.id === state.selectedKeyframeId) marker.classList.add('kf-marker--selected');
        marker.style.left = `${(kf.time / dur) * 100}%`;
        marker.dataset.id  = kf.id;
        this.ruler.appendChild(marker);
      });
    }

    const deleteBtn = this.el.querySelector('#btn-delete-kf') as HTMLButtonElement | null;
    if (deleteBtn) deleteBtn.disabled = state.selectedKeyframeId === null;

    const dupeBtn = this.el.querySelector('#btn-dupe-kf') as HTMLButtonElement | null;
    if (dupeBtn) dupeBtn.disabled = state.selectedKeyframeId === null;
  }

  // ─── KF navigation ───────────────────────────────────────────────────────────

  private prevKeyframe(): void {
    const t      = this.controls.getCurrentTime();
    const sorted = [...store.get().keyframes].sort((a, b) => a.time - b.time);
    const prev   = [...sorted].reverse().find((k) => k.time < t - 0.05);
    this.controls.seekTo(prev ? prev.time : 0);
  }

  private nextKeyframe(): void {
    const t      = this.controls.getCurrentTime();
    const sorted = [...store.get().keyframes].sort((a, b) => a.time - b.time);
    const next   = sorted.find((k) => k.time > t + 0.05);
    if (next) this.controls.seekTo(next.time);
  }

  // ─── Listeners ───────────────────────────────────────────────────────────────

  private onDocMouseMove = (e: MouseEvent): void => {
    if (!this.draggingKfId) return;
    const rect = this.ruler.getBoundingClientRect();
    const dur  = this.controls.getDuration();
    if (dur <= 0) return;
    const t = Math.max(0, Math.min(dur, ((e.clientX - rect.left) / rect.width) * dur));
    updateKeyframe(this.draggingKfId, { time: t });
  };

  private onDocMouseUp = (): void => { this.draggingKfId = null; };

  private attachListeners(): void {
    document.addEventListener('mousemove', this.onDocMouseMove);
    document.addEventListener('mouseup',   this.onDocMouseUp);

    // Ruler click / KF drag
    this.ruler.addEventListener('mousedown', (e) => {
      const { editorMode } = store.get();
      const marker = (e.target as HTMLElement).closest('.kf-marker') as HTMLElement | null;

      if (marker && marker.dataset.id) {
        if (editorMode === 'animate') {
          // select KF and start drag
          selectKeyframe(marker.dataset.id);
          this.draggingKfId = marker.dataset.id;
          e.stopPropagation();
          e.preventDefault();
          return;
        }
        // preview mode: clicking a marker just seeks to it
        const kf = store.get().keyframes.find((k) => k.id === marker.dataset.id);
        if (kf) this.controls.seekTo(kf.time);
        e.stopPropagation();
        return;
      }

      // Click on empty ruler → seek + deselect (animate mode only deselects)
      const rect = this.ruler.getBoundingClientRect();
      const dur  = this.controls.getDuration();
      if (dur > 0) {
        const t = Math.max(0, Math.min(dur, ((e.clientX - rect.left) / rect.width) * dur));
        this.controls.seekTo(t);
      }
      if (editorMode === 'animate') selectKeyframe(null);
    });

    // Mode toggle
    this.el.querySelector('#btn-mode-animate')!.addEventListener('click', () => {
      setEditorMode('animate');
    });

    this.el.querySelector('#btn-mode-preview')!.addEventListener('click', () => {
      setEditorMode('preview');
      // Auto-play so the user immediately sees the result
      if (!this.controls.isPlaying()) this.controls.togglePlay();
    });

    // Playback
    this.el.querySelector('#btn-play')!     .addEventListener('click', () => this.controls.togglePlay());
    this.el.querySelector('#btn-to-start')! .addEventListener('click', () => this.controls.goToStart());
    this.el.querySelector('#btn-to-end')!   .addEventListener('click', () => this.controls.goToEnd());
    this.el.querySelector('#btn-prev-kf')!  .addEventListener('click', () => this.prevKeyframe());
    this.el.querySelector('#btn-next-kf')!  .addEventListener('click', () => this.nextKeyframe());
    this.el.querySelector('#btn-loop')!     .addEventListener('click', () => this.controls.toggleLoop());

    // KF management
    this.el.querySelector('#btn-add-kf')!.addEventListener('click', () => {
      addKeyframe(this.controls.getCurrentTime());
    });

    this.el.querySelector('#btn-dupe-kf')!.addEventListener('click', () => {
      const { selectedKeyframeId } = store.get();
      if (selectedKeyframeId) duplicateKeyframe(selectedKeyframeId, this.controls.getCurrentTime());
    });

    this.el.querySelector('#btn-delete-kf')!.addEventListener('click', () => {
      const { selectedKeyframeId } = store.get();
      if (selectedKeyframeId) deleteKeyframe(selectedKeyframeId);
    });

    this.el.querySelector('#btn-undo')!.addEventListener('click', () => undoKeyframe());
  }
}
