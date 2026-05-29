import { store, clearError } from './state/editorStore';
import { UploadZone } from './components/UploadZone';
import { ControlPanel } from './components/ControlPanel';
import { PreviewCanvas } from './components/PreviewCanvas';
import { ExportButton } from './components/ExportButton';
import type { EditorState } from '../types';

// ─── Mount ────────────────────────────────────────────────────────────────────

const uploadSection  = document.getElementById('upload-section')!;
const editorLayout   = document.getElementById('editor-layout')!;
const controlPanelEl = document.getElementById('control-panel')!;
const previewEl      = document.getElementById('preview-container')!;
const exportEl       = document.getElementById('export-container')!;
const errorBanner    = document.getElementById('error-banner')!;
const errorMsg       = document.getElementById('error-msg')!;
const errorClose     = document.getElementById('error-close')!;

new UploadZone(uploadSection);
new ControlPanel(controlPanelEl);
new PreviewCanvas(previewEl);
new ExportButton(exportEl);

// ─── Phase transitions ───────────────────────────────────────────────────────
// Flow: empty → uploading → ready → exporting → ready

store.subscribe((state: EditorState) => {
  const isEmpty = state.phase === 'empty' || state.phase === 'uploading';
  uploadSection.style.display = isEmpty ? 'flex' : 'none';
  editorLayout.style.display  = isEmpty ? 'none'  : 'flex';

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
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    (document.getElementById('btn-play') as HTMLButtonElement | null)?.click();
  }
});
