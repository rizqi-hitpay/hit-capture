/**
 * ExportButton — triggers encode worker and shows progress.
 */
import { store, startExport, cancelExport } from '../state/editorStore';
import type { EditorState } from '../../types';

export class ExportButton {
  private el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = container;
    this.render();
    store.subscribe((state) => this.update(state));
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="export-wrap">
        <button class="btn-export" id="btn-export" disabled>
          <span id="export-label">Export MP4</span>
        </button>
        <div class="export-progress" id="export-progress" hidden>
          <div class="progress-bar">
            <div class="progress-fill" id="progress-fill"></div>
          </div>
          <span class="progress-text" id="progress-text">0%</span>
          <button class="btn-cancel" id="btn-cancel">Cancel</button>
        </div>
      </div>
    `;

    const btn = this.el.querySelector('#btn-export') as HTMLButtonElement;
    const cancelBtn = this.el.querySelector('#btn-cancel') as HTMLButtonElement;

    btn.addEventListener('click', () => {
      const { phase, polishedTrack } = store.get();
      if (phase === 'ready' && polishedTrack) startExport();
    });

    cancelBtn.addEventListener('click', () => cancelExport());
  }

  private update(state: EditorState): void {
    const btn = this.el.querySelector('#btn-export') as HTMLButtonElement;
    const label = this.el.querySelector('#export-label') as HTMLElement;
    const progressWrap = this.el.querySelector('#export-progress') as HTMLElement;
    const fill = this.el.querySelector('#progress-fill') as HTMLElement;
    const text = this.el.querySelector('#progress-text') as HTMLElement;

    if (state.phase === 'exporting') {
      btn.hidden = true;
      progressWrap.hidden = false;
      fill.style.width = `${state.exportProgress}%`;
      text.textContent = `${state.exportProgress}%`;
    } else {
      btn.hidden = false;
      progressWrap.hidden = true;
      btn.disabled = state.phase !== 'ready';
      label.textContent = state.exportProgress === 100 ? '✅ Exported!' : 'Export MP4';
    }
  }
}
