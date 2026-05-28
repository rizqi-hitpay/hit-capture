/**
 * ControlPanel — left sidebar with all adjustment controls.
 */
import { store, updatePipelineParams, updateSceneConfig } from '../state/editorStore';
import type { EditorState, GradientPresetId } from '../../types';
import { GRADIENT_IDS, GRADIENT_PRESETS } from '../../renderer/gradientPresets';

export class ControlPanel {
  private el: HTMLElement;
  private unsub: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = container;
    this.render();
    this.unsub = store.subscribe((state) => this.update(state));
  }

  destroy(): void {
    this.unsub?.();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="panel">

        <section class="panel-section">
          <h3 class="panel-heading">Style Preset</h3>
          <div class="preset-grid" id="preset-grid">
            ${GRADIENT_IDS.map((id) => `
              <button class="preset-swatch" data-preset="${id}" title="${GRADIENT_PRESETS[id].label}">
                <span class="preset-label">${GRADIENT_PRESETS[id].label}</span>
              </button>
            `).join('')}
          </div>
        </section>

        <section class="panel-section">
          <h3 class="panel-heading">Cursor Smoothing</h3>
          <div class="control-row">
            <label class="control-label">Strength</label>
            <span class="control-value" id="smooth-val">65%</span>
          </div>
          <input type="range" id="smooth" class="slider" min="0" max="100" value="65" />
        </section>

        <section class="panel-section">
          <h3 class="panel-heading">Hesitation Trim</h3>
          <div class="control-row">
            <label class="control-label">Threshold</label>
            <span class="control-value" id="hesit-val">800ms</span>
          </div>
          <input type="range" id="hesit" class="slider" min="200" max="2000" step="50" value="800" />
        </section>

        <section class="panel-section">
          <h3 class="panel-heading">Auto Zoom</h3>
          <div class="control-row">
            <label class="control-label">Enabled</label>
            <label class="toggle">
              <input type="checkbox" id="zoom-enabled" checked />
              <span class="toggle-track"></span>
            </label>
          </div>
          <div id="zoom-controls">
            <div class="control-row">
              <label class="control-label">Sensitivity</label>
              <span class="control-value" id="zoom-sens-val">70%</span>
            </div>
            <input type="range" id="zoom-sens" class="slider" min="0" max="100" value="70" />
          </div>
        </section>

        <section class="panel-section">
          <h3 class="panel-heading">Window</h3>
          <div class="control-row">
            <label class="control-label">Padding</label>
            <span class="control-value" id="pad-val">40px</span>
          </div>
          <input type="range" id="padding" class="slider" min="0" max="120" step="4" value="40" />
        </section>

      </div>
    `;

    this.applyPresetStyles();
    this.attachListeners();
  }

  private applyPresetStyles(): void {
    const grid = this.el.querySelector('#preset-grid') as HTMLElement;
    const swatches = grid.querySelectorAll<HTMLButtonElement>('.preset-swatch');
    swatches.forEach((btn) => {
      const id = btn.dataset.preset as GradientPresetId;
      const def = GRADIENT_PRESETS[id];
      const stops = def.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ');
      btn.style.background = `linear-gradient(${def.angleDeg}deg, ${stops})`;
    });
  }

  private attachListeners(): void {
    // Preset picker
    this.el.querySelectorAll<HTMLButtonElement>('.preset-swatch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.preset as GradientPresetId;
        updateSceneConfig({ gradient: id });
      });
    });

    // Smoothing
    const smoothSlider = this.el.querySelector('#smooth') as HTMLInputElement;
    smoothSlider.addEventListener('input', () => {
      const val = parseInt(smoothSlider.value) / 100;
      (this.el.querySelector('#smooth-val') as HTMLElement).textContent = `${smoothSlider.value}%`;
      updatePipelineParams({ smoothingStrength: val });
    });

    // Hesitation
    const hesitSlider = this.el.querySelector('#hesit') as HTMLInputElement;
    hesitSlider.addEventListener('input', () => {
      const val = parseInt(hesitSlider.value);
      (this.el.querySelector('#hesit-val') as HTMLElement).textContent = `${val}ms`;
      updatePipelineParams({ hesitationThresholdMs: val });
    });

    // Zoom enabled toggle
    const zoomCheck = this.el.querySelector('#zoom-enabled') as HTMLInputElement;
    const zoomControls = this.el.querySelector('#zoom-controls') as HTMLElement;
    zoomCheck.addEventListener('change', () => {
      zoomControls.style.opacity = zoomCheck.checked ? '1' : '0.4';
      updateSceneConfig({
        autoZoom: { ...store.get().sceneConfig.autoZoom, enabled: zoomCheck.checked },
      });
    });

    // Zoom sensitivity
    const zoomSens = this.el.querySelector('#zoom-sens') as HTMLInputElement;
    zoomSens.addEventListener('input', () => {
      const val = parseInt(zoomSens.value) / 100;
      (this.el.querySelector('#zoom-sens-val') as HTMLElement).textContent = `${zoomSens.value}%`;
      updateSceneConfig({
        autoZoom: { ...store.get().sceneConfig.autoZoom, sensitivity: val },
      });
    });

    // Padding
    const padSlider = this.el.querySelector('#padding') as HTMLInputElement;
    padSlider.addEventListener('input', () => {
      const val = parseInt(padSlider.value);
      (this.el.querySelector('#pad-val') as HTMLElement).textContent = `${val}px`;
      updateSceneConfig({
        window: { ...store.get().sceneConfig.window, paddingPx: val },
      });
    });
  }

  private update(state: EditorState): void {
    // Highlight active preset
    this.el.querySelectorAll<HTMLButtonElement>('.preset-swatch').forEach((btn) => {
      btn.classList.toggle('preset-swatch--active', btn.dataset.preset === state.sceneConfig.gradient);
    });
  }
}
