import { setVideoFile } from '../state/editorStore';

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
        <h2 class="upload-title">Drop your recording here</h2>
        <p class="upload-subtitle">WebM · MP4 · MOV</p>
        <label class="upload-btn" for="file-video">
          📹 Choose File
          <input type="file" id="file-video" accept="video/mp4,video/webm,video/quicktime,.mov" hidden />
        </label>
        <p class="upload-hint">Files stay on your device — nothing is uploaded</p>
        <div class="upload-status" id="upload-status"></div>
      </div>
    `;
  }

  private attachListeners(): void {
    const zone = this.el.querySelector('#upload-drop-zone') as HTMLDivElement;
    const videoInput = this.el.querySelector('#file-video') as HTMLInputElement;

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = Array.from(e.dataTransfer?.files ?? [])
        .find((f) => f.type.startsWith('video/') || /\.(mp4|webm|mov|m4v)$/i.test(f.name));
      if (file) this.handleVideoFile(file);
    });

    videoInput.addEventListener('change', () => {
      if (videoInput.files?.[0]) this.handleVideoFile(videoInput.files[0]);
    });
  }

  private handleVideoFile(file: File): void {
    const el = this.el.querySelector('#upload-status') as HTMLElement;
    if (el) el.textContent = `✅ ${file.name}`;
    setVideoFile(file);
  }
}
