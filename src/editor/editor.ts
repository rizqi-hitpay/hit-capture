/**
 * Editor page entry point.
 * Mounts all components and wires up store subscriptions.
 */
import { store, clearError } from './state/editorStore';
import { UploadZone } from './components/UploadZone';
import { ControlPanel } from './components/ControlPanel';
import { PreviewCanvas } from './components/PreviewCanvas';
import { ExportButton } from './components/ExportButton';
import { BeforeAfterToggle } from './components/BeforeAfterToggle';
import type { EditorState } from '../types';

// ─── Mount ────────────────────────────────────────────────────────────────────

const uploadSection = document.getElementById('upload-section')!;
const editorLayout = document.getElementById('editor-layout')!;
const controlPanelEl = document.getElementById('control-panel')!;
const previewEl = document.getElementById('preview-container')!;
const exportEl = document.getElementById('export-container')!;
const beforeAfterEl = document.getElementById('before-after-container')!;
const errorBanner = document.getElementById('error-banner')!;
const errorMsg = document.getElementById('error-msg')!;
const errorClose = document.getElementById('error-close')!;
const processingOverlay = document.getElementById('processing-overlay')!;

// Instantiate components
new UploadZone(uploadSection);
const controlPanel = new ControlPanel(controlPanelEl);
const previewCanvas = new PreviewCanvas(previewEl);
new ExportButton(exportEl);
new BeforeAfterToggle(beforeAfterEl);

void controlPanel; // prevent unused warning
void previewCanvas;

// ─── Phase transitions ────────────────────────────────────────────────────────

store.subscribe((state: EditorState) => {
  const isEmpty = state.phase === 'empty' || state.phase === 'uploading';

  uploadSection.style.display = isEmpty ? 'flex' : 'none';
  editorLayout.style.display = isEmpty ? 'none' : 'flex';

  // Processing overlay (while pipeline runs)
  processingOverlay.style.display = state.phase === 'processing' ? 'flex' : 'none';

  // Error banner
  if (state.error) {
    errorMsg.textContent = state.error;
    errorBanner.style.display = 'flex';
  } else {
    errorBanner.style.display = 'none';
  }
});

errorClose.addEventListener('click', () => clearError());

// ─── Keyboard shortcuts ───────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  // Space = play/pause
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    const playBtn = document.getElementById('btn-play') as HTMLButtonElement | null;
    playBtn?.click();
  }
});
