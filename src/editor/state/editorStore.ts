/**
 * Lightweight reactive store for editor state.
 * No framework dependency — plain pub/sub atom.
 */
import type {
  EditorState,
  PipelineParams,
  SceneConfig,
  CaptureSession,
  PolishedTrack,
} from '../../types';
import { DEFAULT_PIPELINE_PARAMS, DEFAULT_SCENE_CONFIG } from './defaults';
import { identityTransform, computeTransform } from '../../shared/coords';
import { PIPELINE_DEBOUNCE_MS, DEFAULT_OUTPUT_FRAMERATE } from '../../shared/constants';

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
};

export const store = new Atom<EditorState>(INITIAL);

// ─── Worker instances (long-lived) ────────────────────────────────────────────

let pipelineWorker: Worker | null = null;
let encodeWorker: Worker | null = null;

// ─── WebM export helpers ──────────────────────────────────────────────────────

// Shared ACK resolver: main thread awaits this before sending the next
// WEBM_FRAME (or after INIT_WEBM_ENCODE). Resolved by the worker's ACK message.
let webmAckResolve: (() => void) | null = null;

// Hidden video element used for seek-based WebM frame extraction.
let webmExportVideo: HTMLVideoElement | null = null;

function resolveWebmAck(): void {
  webmAckResolve?.();
  webmAckResolve = null;
}

function waitForWebmAck(): Promise<void> {
  return new Promise<void>((res) => { webmAckResolve = res; });
}

function getPipelineWorker(): Worker {
  if (!pipelineWorker || pipelineWorker.onmessage === null) {
    pipelineWorker?.terminate();
    pipelineWorker = new Worker(
      new URL('../../workers/pipeline.worker.ts', import.meta.url),
      { type: 'module' }
    );
  }
  return pipelineWorker;
}

// ─── Debounce ─────────────────────────────────────────────────────────────────

let pipelineDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Actions ─────────────────────────────────────────────────────────────────

export function setVideoFile(file: File): void {
  store.set((prev) => ({ ...prev, videoFile: file, phase: 'uploading', error: null }));
  tryProcessFiles();
}

export function setSession(session: CaptureSession): void {
  store.set((prev) => ({ ...prev, session, error: null }));
  tryProcessFiles();
}

function tryProcessFiles(): void {
  const { videoFile, session } = store.get();
  if (!videoFile || !session) return;

  // Once both files are loaded, probe video dimensions and compute transform
  const video = document.createElement('video');
  video.src = URL.createObjectURL(videoFile);
  video.onloadedmetadata = () => {
    const { transform, autoAligned } = computeTransform(
      session,
      video.videoWidth,
      video.videoHeight
    );
    store.set((prev) => ({
      ...prev,
      sceneConfig: {
        ...prev.sceneConfig,
        outputWidth: video.videoWidth,
        outputHeight: video.videoHeight,
      },
      coordTransform: transform,
      autoAligned,
      phase: 'processing',
    }));
    schedulePipeline();
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
  debouncePipeline();
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

function debouncePipeline(): void {
  if (pipelineDebounceTimer) clearTimeout(pipelineDebounceTimer);
  pipelineDebounceTimer = setTimeout(schedulePipeline, PIPELINE_DEBOUNCE_MS);
}

function schedulePipeline(): void {
  const { session, pipelineParams } = store.get();
  if (!session) return;

  store.set((prev) => ({ ...prev, phase: 'processing' }));

  const worker = getPipelineWorker();
  worker.onmessage = (e) => {
    const { type } = e.data;
    if (type === 'DONE') {
      const track = e.data.track as PolishedTrack;
      store.set((prev) => ({ ...prev, polishedTrack: track, phase: 'ready' }));
    } else if (type === 'ERROR') {
      store.set((prev) => ({ ...prev, error: e.data.message, phase: 'ready' }));
    }
  };

  worker.postMessage({
    type: 'RUN_PIPELINE',
    events: session.events,
    params: pipelineParams,
    viewport: session.viewport,
  });
}

export async function startExport(): Promise<void> {
  const state = store.get();
  if (!state.videoFile || !state.polishedTrack || !state.session) return;

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
      await startWebmExport(state.videoFile, state.polishedTrack, state.sceneConfig, state.session, state.coordTransform);
    } catch (err) {
      store.set((prev) => ({
        ...prev,
        phase: 'ready',
        error: err instanceof Error ? err.message : 'WebM export failed',
      }));
    }
  } else {
    startMp4Export(state.videoFile, state.polishedTrack, state.sceneConfig, state.session, state.coordTransform);
  }
}

function startMp4Export(
  videoFile: File,
  track: import('../../types').PolishedTrack,
  sceneConfig: import('../../types').SceneConfig,
  session: import('../../types').CaptureSession,
  coordTransform: import('../../types').CoordTransform,
): void {
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

  encodeWorker.postMessage({ type: 'START_ENCODE', videoFile, track, sceneConfig, session, coordTransform });
}

async function startWebmExport(
  videoFile: File,
  track: import('../../types').PolishedTrack,
  sceneConfig: import('../../types').SceneConfig,
  session: import('../../types').CaptureSession,
  coordTransform: import('../../types').CoordTransform,
): Promise<void> {
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
      resolveWebmAck(); // unblock any pending wait
      store.set((prev) => ({ ...prev, phase: 'ready', error: msg.message }));
    }
  };

  const estimatedFrames = Math.ceil((track.totalDurationMs / 1000) * DEFAULT_OUTPUT_FRAMERATE);

  // Init the worker (async — we wait for WEBM_INIT_ACK before sending frames)
  worker.postMessage({ type: 'INIT_WEBM_ENCODE', track, sceneConfig, session, coordTransform, estimatedFrames });
  await waitForWebmAck();

  if (encodeWorker === null) return; // Cancelled during init

  // Set up a hidden video element for seek-based frame capture
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
  const totalDurationSec = track.totalDurationMs / 1000;

  for (let i = 0; i < estimatedFrames; i++) {
    if (encodeWorker === null) break; // Cancelled

    const targetSec = i * frameIntervalSec;
    if (targetSec >= totalDurationSec) break;

    video.currentTime = targetSec;
    await new Promise<void>((res) => {
      const onSeeked = () => { video.removeEventListener('seeked', onSeeked); res(); };
      video.addEventListener('seeked', onSeeked);
    });

    if (encodeWorker === null) break; // Cancelled during seek

    const frame = new VideoFrame(video, {
      timestamp: Math.round(video.currentTime * 1_000_000),
    });

    worker.postMessage({ type: 'WEBM_FRAME', frame }, [frame]);
    await waitForWebmAck();
  }

  // Clean up video element
  URL.revokeObjectURL(video.src);
  video.src = '';
  video.remove();
  webmExportVideo = null;

  if (encodeWorker !== null) {
    worker.postMessage({ type: 'END_WEBM_ENCODE' });
  }
}

export function cancelExport(): void {
  // Unblock any pending WebM ACK wait so the async loop can exit
  resolveWebmAck();

  // Clean up WebM export video element if present
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
