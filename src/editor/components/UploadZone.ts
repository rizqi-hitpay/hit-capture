/**
 * UploadZone component
 * Handles drag-and-drop and file input for video + session JSON.
 */
import { setVideoFile, setSession } from '../state/editorStore';
import type { CaptureSession } from '../../types';

export class UploadZone {
  private el: HTMLElement;

  constructor(container: HTMLElement) {
    this.el = container;
    this.render();
    this.attachListeners();
  }

  private render(): void {
    this.el.innerHTML = `
      <div class="upload-zone" id="upload-drop-zone">
        <div class="upload-icon">🎬</div>
        <h2 class="upload-title">Drop your files here</h2>
        <p class="upload-subtitle">Screen recording + cursor session JSON</p>
        <div class="upload-buttons">
          <label class="upload-btn" for="file-video">
            📹 Add Recording
            <input type="file" id="file-video" accept="video/mp4,video/webm,video/quicktime,.mov" hidden />
          </label>
          <label class="upload-btn upload-btn--secondary" for="file-json">
            📊 Add Session JSON
            <input type="file" id="file-json" accept="application/json,.json" hidden />
          </label>
        </div>
        <p class="upload-hint">
          Accepts MP4 · MOV · WebM · JSON<br />
          Files stay on your device — nothing is uploaded
        </p>
        <div class="upload-status" id="upload-status"></div>
      </div>
    `;
  }

  private attachListeners(): void {
    const zone = this.el.querySelector('#upload-drop-zone') as HTMLDivElement;
    const videoInput = this.el.querySelector('#file-video') as HTMLInputElement;
    const jsonInput = this.el.querySelector('#file-json') as HTMLInputElement;

    // Drag-and-drop
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer?.files ?? []);
      this.handleFiles(files);
    });

    // File inputs
    videoInput.addEventListener('change', () => {
      if (videoInput.files?.[0]) this.handleVideoFile(videoInput.files[0]);
    });
    jsonInput.addEventListener('change', () => {
      if (jsonInput.files?.[0]) this.handleJsonFile(jsonInput.files[0]);
    });
  }

  private handleFiles(files: File[]): void {
    for (const file of files) {
      if (file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
        this.handleVideoFile(file);
      } else if (file.type === 'application/json' || file.name.endsWith('.json')) {
        this.handleJsonFile(file);
      }
    }
  }

  private handleVideoFile(file: File): void {
    this.setStatus(`✅ Video: ${file.name}`);
    setVideoFile(file);
  }

  private async handleJsonFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const session = JSON.parse(text) as CaptureSession;
      if (session.version !== 1 || !Array.isArray(session.events)) {
        throw new Error('Invalid session file format');
      }
      this.setStatus(`✅ Session: ${session.events.length} events, ${(session.durationMs / 1000).toFixed(1)}s`);
      setSession(session);
    } catch (err) {
      this.setStatus(`❌ ${err instanceof Error ? err.message : 'Invalid JSON file'}`);
    }
  }

  private setStatus(text: string): void {
    const el = this.el.querySelector('#upload-status') as HTMLElement;
    if (el) el.textContent = text;
  }
}
