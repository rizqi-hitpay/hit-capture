import { store, clearError } from './state/editorStore';
import { UploadZone } from './components/UploadZone';
import { ControlPanel } from './components/ControlPanel';
import { PreviewCanvas } from './components/PreviewCanvas';
import { ExportButton } from './components/ExportButton';
import { Timeline } from './components/Timeline';
import type { EditorState } from '../types';

// ─── Mount ────────────────────────────────────────────────────────────────────

const uploadSection    = document.getElementById('upload-section')!;
const editorLayout     = document.getElementById('editor-layout')!;
const controlPanelEl   = document.getElementById('control-panel')!;
const previewEl        = document.getElementById('preview-container')!;
const timelineEl       = document.getElementById('timeline-container')!;
const exportEl         = document.getElementById('export-container')!;
const errorBanner      = document.getElementById('error-banner')!;
const errorMsg         = document.getElementById('error-msg')!;
const errorClose       = document.getElementById('error-close')!;

new UploadZone(uploadSection);
new ControlPanel(controlPanelEl);
const previewCanvas = new PreviewCanvas(previewEl);
const timeline = new Timeline(timelineEl, previewCanvas);
previewCanvas.setTimeline(timeline);
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
  const target = e.target as Element;
  if (target.closest('input, textarea, select')) return;

  if (e.code === 'Space') {
    e.preventDefault();
    document.getElementById('btn-play')?.click();
  } else if (e.code === 'Home') {
    e.preventDefault();
    document.getElementById('btn-to-start')?.click();
  } else if (e.code === 'End') {
    e.preventDefault();
    document.getElementById('btn-to-end')?.click();
  } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
    e.preventDefault();
    const btn = document.getElementById('btn-undo') as HTMLButtonElement | null;
    if (btn && !btn.disabled) btn.click();
  }
});
