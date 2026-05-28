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
import { PIPELINE_DEBOUNCE_MS } from '../../shared/constants';

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

  // Terminate previous worker if any
  encodeWorker?.terminate();
  encodeWorker = new Worker(
    new URL('../../workers/encode.worker.ts', import.meta.url),
    { type: 'module' }
  );

  encodeWorker.onmessage = async (e) => {
    const msg = e.data;
    if (msg.type === 'PROGRESS') {
      store.set((prev) => ({ ...prev, exportProgress: msg.percent }));
    } else if (msg.type === 'DONE') {
      store.set((prev) => ({ ...prev, phase: 'ready', exportProgress: 100 }));
      // Trigger download
      const blob = new Blob([msg.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      try {
        await chrome.downloads.download({
          url,
          filename: 'polished-demo.mp4',
          saveAs: true,
        });
      } finally {
        URL.revokeObjectURL(url);
      }
    } else if (msg.type === 'ERROR') {
      store.set((prev) => ({ ...prev, phase: 'ready', error: msg.message }));
    }
  };

  encodeWorker.postMessage({
    type: 'START_ENCODE',
    videoFile: state.videoFile,
    track: state.polishedTrack,
    sceneConfig: state.sceneConfig,
    session: state.session,
    coordTransform: state.coordTransform,
  });
}

export function cancelExport(): void {
  encodeWorker?.terminate();
  encodeWorker = null;
  store.set((prev) => ({ ...prev, phase: 'ready', exportProgress: 0 }));
}

export function clearError(): void {
  store.set((prev) => ({ ...prev, error: null }));
}
