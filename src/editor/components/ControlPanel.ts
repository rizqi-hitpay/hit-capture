import {
  store,
  updateSceneConfig,
  setEditContainerMode,
} from '../state/editorStore';
import type { EditorState, GradientPresetId } from '../../types';
import { GRADIENT_IDS, GRADIENT_PRESETS } from '../../renderer/gradientPresets';

export class ControlPanel {
  private el: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = container;
    this.render();
    this.unsub = store.subscribe((state) => this.update(state));
    this.update(store.get());
  }

  destroy(): void {
    this.unsub?.();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="panel">

        <!-- Background -->
        <section class="panel-section">
          <h3 class="panel-heading">Background</h3>
          <div class="preset-grid" id="preset-grid">
            ${GRADIENT_IDS.map((id) => `
              <button class="preset-swatch" data-preset="${id}" title="${GRADIENT_PRESETS[id].label}">
                <span class="preset-label">${GRADIENT_PRESETS[id].label}</span>
              </button>
            `).join('')}
          </div>
          <div class="control-row" style="margin-top:8px">
            <label class="control-label">Corner radius</label>
            <span class="control-value" id="radius-val">12px</span>
          </div>
          <input type="range" id="corner-radius" class="slider" min="0" max="48" step="2" value="12" />
        </section>

        <!-- Container -->
        <section class="panel-section">
          <h3 class="panel-heading">Container</h3>
          <button class="btn-edit-container" id="btn-edit-container">Edit Container</button>
          <p class="panel-hint" id="container-hint">Drag container to reposition on canvas</p>
        </section>

      </div>
    `;

    this.applyPresetStyles();
    this.attachListeners();
  }

  private applyPresetStyles(): void {
    this.el.querySelectorAll<HTMLButtonElement>('.preset-swatch').forEach((btn) => {
      const id = btn.dataset.preset as GradientPresetId;
      const def = GRADIENT_PRESETS[id];
      const stops = def.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ');
      btn.style.background = `linear-gradient(${def.angleDeg}deg, ${stops})`;
    });
  }

  private attachListeners(): void {
    // Gradient preset picker
    this.el.querySelectorAll<HTMLButtonElement>('.preset-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        updateSceneConfig({ gradient: btn.dataset.preset as GradientPresetId });
      });
    });

    // Corner radius
    const radiusSlider = this.el.querySelector('#corner-radius') as HTMLInputElement;
    radiusSlider.addEventListener('input', () => {
      const val = parseInt(radiusSlider.value);
      (this.el.querySelector('#radius-val') as HTMLElement).textContent = `${val}px`;
      updateSceneConfig({ window: { ...store.get().sceneConfig.window, cornerRadiusPx: val } });
    });

    // Edit container mode toggle
    const btnEdit = this.el.querySelector('#btn-edit-container') as HTMLButtonElement;
    btnEdit.addEventListener('click', () => {
      setEditContainerMode(!store.get().editContainerMode);
    });
  }

  private update(state: EditorState): void {
    // Highlight active preset
    this.el.querySelectorAll<HTMLButtonElement>('.preset-swatch').forEach((btn) => {
      btn.classList.toggle('preset-swatch--active', btn.dataset.preset === state.sceneConfig.gradient);
    });

    // Sync corner radius slider
    const radiusSlider = this.el.querySelector('#corner-radius') as HTMLInputElement | null;
    if (radiusSlider) {
      radiusSlider.value = String(state.sceneConfig.window.cornerRadiusPx);
      (this.el.querySelector('#radius-val') as HTMLElement).textContent =
        `${state.sceneConfig.window.cornerRadiusPx}px`;
    }

    // Edit container mode button
    const btnEdit = this.el.querySelector('#btn-edit-container') as HTMLButtonElement | null;
    const hint = this.el.querySelector('#container-hint') as HTMLElement | null;
    if (btnEdit) {
      btnEdit.classList.toggle('btn-edit-container--active', state.editContainerMode);
      btnEdit.textContent = state.editContainerMode ? 'Done Editing' : 'Edit Container';
    }
    if (hint) {
      hint.textContent = state.editContainerMode
        ? 'Drag container to reveal different parts of the video'
        : 'Drag container to reposition on canvas';
    }
  }
}
