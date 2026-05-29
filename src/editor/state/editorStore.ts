/**
 * Lightweight reactive store for editor state.
 * No framework dependency — plain pub/sub atom.
 */
import type {
  EditorState,
  PipelineParams,
  SceneConfig,
  CropRect,
} from '../../types';
import { DEFAULT_PIPELINE_PARAMS, DEFAULT_SCENE_CONFIG, DEFAULT_CROP_RECT, DEFAULT_ZOOM_LEVEL } from './defaults';
import { identityTransform } from '../../shared/coords';
import { DEFAULT_OUTPUT_FRAMERATE } from '../../shared/constants';

// ─── Store atom ───────────────────────────────────────────────────────────────

type Listener<T> = (value: T) => void;

class Atom<T> {
  private value: T;
  private listeners = new Set<Listener<T>>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T { return this.value; }

  set(updater: T | ((prev: T) => T)): void {
    this.value =
      typeof updater === 'function'
        ? (updater as (prev: T) => T)(this.value)
        : updater;
    this.listeners.forEach((l) => l(this.value));
  }

  subscribe(fn: Listener<T>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

// ─── Initial state ────────────────────────────────────────────────────────────

const INITIAL: EditorState = {
  phase: 'empty',
  videoFile: null,
  session: null,
  pipelineParams: DEFAULT_PIPELINE_PARAMS,
  sceneConfig: DEFAULT_SCENE_CONFIG,
  polishedTrack: null,
  coordTransform: identityTransform(),
  autoAligned: false,
  showRawCursor: false,
  exportProgress: 0,
  error: null,
  cropRect: DEFAULT_CROP_RECT,
  zoomLevel: DEFAULT_ZOOM_LEVEL,
  cropMode: false,
};

export const store = new Atom<EditorState>(INITIAL);

// ─── Worker instances (long-lived) ────────────────────────────────────────────

let encodeWorker: Worker | null = null;

// ─── WebM export helpers ──────────────────────────────────────────────────────

let webmAckResolve: (() => void) | null = null;
let webmExportVideo: HTMLVideoElement | null = null;

function resolveWebmAck(): void {
  webmAckResolve?.();
  webmAckResolve = null;
}

function waitForWebmAck(): Promise<void> {
  return new Promise<void>((res) => { webmAckResolve = res; });
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export function setVideoFile(file: File): void {
  store.set((prev) => ({ ...prev, videoFile: file, phase: 'uploading', error: null }));
  probeVideoDimensions(file);
}

function probeVideoDimensions(file: File): void {
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.onloadedmetadata = () => {
    store.set((prev) => ({
      ...prev,
      sceneConfig: {
        ...prev.sceneConfig,
        outputWidth: video.videoWidth,
        outputHeight: video.videoHeight,
      },
      phase: 'ready',
    }));
    URL.revokeObjectURL(video.src);
  };
  video.onerror = () => {
    store.set((prev) => ({
      ...prev,
      error: 'Could not read video file. Expected a WebM, MP4, or MOV recording from Cursor Capture.',
      phase: 'empty',
    }));
  };
}

export function updatePipelineParams(partial: Partial<PipelineParams>): void {
  store.set((prev) => ({
    ...prev,
    pipelineParams: { ...prev.pipelineParams, ...partial },
  }));
}

export function updateSceneConfig(partial: Partial<SceneConfig>): void {
  store.set((prev) => ({
    ...prev,
    sceneConfig: { ...prev.sceneConfig, ...partial },
  }));
}

export function setShowRawCursor(show: boolean): void {
  store.set((prev) => ({ ...prev, showRawCursor: show }));
}

export function setCropRect(rect: CropRect | null): void {
  store.set((prev) => ({ ...prev, cropRect: rect, cropMode: false }));
}

export function setZoomLevel(level: number): void {
  store.set((prev) => ({ ...prev, zoomLevel: level }));
}

export function setCropMode(active: boolean): void {
  store.set((prev) => ({ ...prev, cropMode: active }));
}

export async function startExport(): Promise<void> {
  const state = store.get();
  if (!state.videoFile) return;

  store.set((prev) => ({ ...prev, phase: 'exporting', exportProgress: 0 }));

  encodeWorker?.terminate();
  encodeWorker = new Worker(
    new URL('../../workers/encode.worker.ts', import.meta.url),
    { type: 'module' }
  );

  const isWebM =
    state.videoFile.type.includes('webm') ||
    state.videoFile.name.toLowerCase().endsWith('.webm');

  if (isWebM) {
    try {
      await startWebmExport(state.videoFile);
    } catch (err) {
      store.set((prev) => ({
        ...prev,
        phase: 'ready',
        error: err instanceof Error ? err.message : 'WebM export failed',
      }));
    }
  } else {
    startMp4Export(state.videoFile);
  }
}

function startMp4Export(videoFile: File): void {
  const { sceneConfig, cropRect, zoomLevel } = store.get();
  if (!encodeWorker) return;

  encodeWorker.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === 'PROGRESS') {
      store.set((prev) => ({ ...prev, exportProgress: msg.percent }));
    } else if (msg.type === 'DONE') {
      store.set((prev) => ({ ...prev, phase: 'ready', exportProgress: 100 }));
      const blob = new Blob([msg.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      try {
        await chrome.downloads.download({ url, filename: 'polished-demo.mp4', saveAs: true });
      } finally {
        URL.revokeObjectURL(url);
      }
    } else if (msg.type === 'ERROR') {
      store.set((prev) => ({ ...prev, phase: 'ready', error: msg.message }));
    }
  };

  encodeWorker.postMessage({ type: 'START_ENCODE', videoFile, sceneConfig, cropRect, zoomLevel });
}

async function startWebmExport(videoFile: File): Promise<void> {
  const { sceneConfig, cropRect, zoomLevel } = store.get();
  if (!encodeWorker) return;
  const worker = encodeWorker;

  worker.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === 'WEBM_INIT_ACK' || msg.type === 'WEBM_FRAME_ACK') {
      resolveWebmAck();
    } else if (msg.type === 'PROGRESS') {
      store.set((prev) => ({ ...prev, exportProgress: msg.percent }));
    } else if (msg.type === 'DONE') {
      store.set((prev) => ({ ...prev, phase: 'ready', exportProgress: 100 }));
      const blob = new Blob([msg.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      try {
        await chrome.downloads.download({ url, filename: 'polished-demo.mp4', saveAs: true });
      } finally {
        URL.revokeObjectURL(url);
      }
    } else if (msg.type === 'ERROR') {
      resolveWebmAck();
      store.set((prev) => ({ ...prev, phase: 'ready', error: msg.message }));
    }
  };

  // Duration is known only after loadedmetadata; use a generous estimate for now.
  // The loop breaks early once targetSec >= actual duration anyway.
  const estimatedFrames = Math.ceil((videoFile.size / 50_000) * DEFAULT_OUTPUT_FRAMERATE);

  worker.postMessage({ type: 'INIT_WEBM_ENCODE', sceneConfig, cropRect, zoomLevel, estimatedFrames });
  await waitForWebmAck();

  if (encodeWorker === null) return;

  const video = document.createElement('video');
  webmExportVideo = video;
  video.src = URL.createObjectURL(videoFile);
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  document.body.appendChild(video);

  await new Promise<void>((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error('Failed to load video for encoding'));
  });

  const frameIntervalSec = 1 / DEFAULT_OUTPUT_FRAMERATE;
  const totalDurationSec = isFinite(video.duration) ? video.duration : Infinity;

  for (let i = 0; i < estimatedFrames; i++) {
    if (encodeWorker === null) break;

    const targetSec = i * frameIntervalSec;
    if (targetSec >= totalDurationSec) break;

    video.currentTime = targetSec;
    await new Promise<void>((res) => {
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); res(); };
      video.addEventListener('seeked', onSeeked);
    });

    if (encodeWorker === null) break;

    const frame = new VideoFrame(video, {
      timestamp: Math.round(video.currentTime * 1_000_000),
    });

    worker.postMessage({ type: 'WEBM_FRAME', frame }, [frame]);
    await waitForWebmAck();
  }

  URL.revokeObjectURL(video.src);
  video.src = '';
  video.remove();
  webmExportVideo = null;

  if (encodeWorker !== null) {
    worker.postMessage({ type: 'END_WEBM_ENCODE' });
  }
}

export function cancelExport(): void {
  resolveWebmAck();

  if (webmExportVideo) {
    URL.revokeObjectURL(webmExportVideo.src);
    webmExportVideo.src = '';
    webmExportVideo.remove();
    webmExportVideo = null;
  }

  encodeWorker?.terminate();
  encodeWorker = null;
  store.set((prev) => ({ ...prev, phase: 'ready', exportProgress: 0 }));
}

export function clearError(): void {
  store.set((prev) => ({ ...prev, error: null }));
}
