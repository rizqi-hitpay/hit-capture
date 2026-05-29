import {
  store,
  updateSceneConfig,
  setCropRect,
  setZoomLevel,
  setCropMode,
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
          <div class="control-row" style="margin-top:12px">
            <label class="control-label">Padding</label>
            <span class="control-value" id="pad-val">40px</span>
          </div>
          <input type="range" id="padding" class="slider" min="0" max="120" step="4" value="40" />
          <div class="control-row" style="margin-top:8px">
            <label class="control-label">Corner radius</label>
            <span class="control-value" id="radius-val">12px</span>
          </div>
          <input type="range" id="corner-radius" class="slider" min="0" max="48" step="2" value="12" />
        </section>

        <!-- Crop -->
        <section class="panel-section">
          <h3 class="panel-heading">Crop</h3>
          <button class="btn-crop-draw" id="btn-crop-draw">Draw crop region</button>
          <div id="crop-active-row" class="crop-active-row" style="display:none">
            <span class="crop-active-label" id="crop-active-label"></span>
            <button class="btn-crop-clear" id="btn-crop-clear">Clear</button>
          </div>
        </section>

        <!-- Zoom -->
        <section class="panel-section">
          <h3 class="panel-heading">Zoom</h3>
          <div class="control-row">
            <label class="control-label">Window size</label>
            <span class="control-value" id="zoom-val">1.0×</span>
          </div>
          <input type="range" id="zoom-level" class="slider" min="0.5" max="3" step="0.05" value="1" />
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

    // Padding
    const padSlider = this.el.querySelector('#padding') as HTMLInputElement;
    padSlider.addEventListener('input', () => {
      const val = parseInt(padSlider.value);
      (this.el.querySelector('#pad-val') as HTMLElement).textContent = `${val}px`;
      updateSceneConfig({ window: { ...store.get().sceneConfig.window, paddingPx: val } });
    });

    // Corner radius
    const radiusSlider = this.el.querySelector('#corner-radius') as HTMLInputElement;
    radiusSlider.addEventListener('input', () => {
      const val = parseInt(radiusSlider.value);
      (this.el.querySelector('#radius-val') as HTMLElement).textContent = `${val}px`;
      updateSceneConfig({ window: { ...store.get().sceneConfig.window, cornerRadiusPx: val } });
    });

    // Crop — draw button
    const btnDraw = this.el.querySelector('#btn-crop-draw') as HTMLButtonElement;
    btnDraw.addEventListener('click', () => {
      const active = !store.get().cropMode;
      setCropMode(active);
    });

    // Crop — clear button
    const btnClear = this.el.querySelector('#btn-crop-clear') as HTMLButtonElement;
    btnClear.addEventListener('click', () => setCropRect(null));

    // Zoom level
    const zoomSlider = this.el.querySelector('#zoom-level') as HTMLInputElement;
    zoomSlider.addEventListener('input', () => {
      const val = parseFloat(zoomSlider.value);
      (this.el.querySelector('#zoom-val') as HTMLElement).textContent = `${val.toFixed(2)}×`;
      setZoomLevel(val);
    });
  }

  private update(state: EditorState): void {
    // Highlight active preset
    this.el.querySelectorAll<HTMLButtonElement>('.preset-swatch').forEach((btn) => {
      btn.classList.toggle('preset-swatch--active', btn.dataset.preset === state.sceneConfig.gradient);
    });

    // Sync padding slider
    const padSlider = this.el.querySelector('#padding') as HTMLInputElement | null;
    if (padSlider) {
      padSlider.value = String(state.sceneConfig.window.paddingPx);
      (this.el.querySelector('#pad-val') as HTMLElement).textContent =
        `${state.sceneConfig.window.paddingPx}px`;
    }

    // Sync corner radius slider
    const radiusSlider = this.el.querySelector('#corner-radius') as HTMLInputElement | null;
    if (radiusSlider) {
      radiusSlider.value = String(state.sceneConfig.window.cornerRadiusPx);
      (this.el.querySelector('#radius-val') as HTMLElement).textContent =
        `${state.sceneConfig.window.cornerRadiusPx}px`;
    }

    // Crop draw button label
    const btnDraw = this.el.querySelector('#btn-crop-draw') as HTMLButtonElement | null;
    if (btnDraw) {
      btnDraw.textContent = state.cropMode ? 'Cancel crop' : 'Draw crop region';
      btnDraw.classList.toggle('btn-crop-draw--active', state.cropMode);
    }

    // Crop active row
    const cropRow = this.el.querySelector('#crop-active-row') as HTMLElement | null;
    const cropLabel = this.el.querySelector('#crop-active-label') as HTMLElement | null;
    if (cropRow && cropLabel) {
      if (state.cropRect) {
        const r = state.cropRect;
        cropLabel.textContent =
          `x:${(r.x * 100).toFixed(0)}% y:${(r.y * 100).toFixed(0)}% ` +
          `${(r.w * 100).toFixed(0)}×${(r.h * 100).toFixed(0)}%`;
        cropRow.style.display = 'flex';
      } else {
        cropRow.style.display = 'none';
      }
    }

    // Sync zoom slider
    const zoomSlider = this.el.querySelector('#zoom-level') as HTMLInputElement | null;
    if (zoomSlider) {
      zoomSlider.value = String(state.zoomLevel);
      (this.el.querySelector('#zoom-val') as HTMLElement).textContent =
        `${state.zoomLevel.toFixed(2)}×`;
    }
  }
}
