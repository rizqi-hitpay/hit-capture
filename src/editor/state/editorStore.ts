/**
 * Lightweight reactive store for editor state.
 * No framework dependency — plain pub/sub atom.
 */
import type {
  EditorState,
  EditorMode,
  PipelineParams,
  SceneConfig,
  CropRect,
  VideoCenter,
  Keyframe,
} from '../../types';
import { DEFAULT_PIPELINE_PARAMS, DEFAULT_SCENE_CONFIG, DEFAULT_CONTAINER_RECT, DEFAULT_ZOOM_LEVEL, DEFAULT_VIDEO_CENTER, DEFAULT_KEYFRAMES, DEFAULT_SELECTED_KEYFRAME_ID, DEFAULT_EDITOR_MODE } from './defaults';
import { getStateAtTime } from '../utils/keyframeInterpolation';
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
  cropRect: DEFAULT_CONTAINER_RECT,
  zoomLevel: DEFAULT_ZOOM_LEVEL,
  videoCenter: DEFAULT_VIDEO_CENTER,
  editContainerMode: false,
  keyframes: DEFAULT_KEYFRAMES,
  selectedKeyframeId: DEFAULT_SELECTED_KEYFRAME_ID,
  editorMode: DEFAULT_EDITOR_MODE,
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
      cropRect: DEFAULT_CONTAINER_RECT,
      videoCenter: DEFAULT_VIDEO_CENTER,
      editContainerMode: false,
      keyframes: DEFAULT_KEYFRAMES,
      selectedKeyframeId: DEFAULT_SELECTED_KEYFRAME_ID,
      editorMode: DEFAULT_EDITOR_MODE,
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
  store.set((prev) => ({ ...prev, cropRect: rect }));
}

export function setZoomLevel(level: number): void {
  store.set((prev) => ({ ...prev, zoomLevel: level }));
}

export function setVideoCenter(center: VideoCenter): void {
  store.set((prev) => ({ ...prev, videoCenter: center }));
}

export function setEditContainerMode(active: boolean): void {
  store.set((prev) => ({ ...prev, editContainerMode: active }));
}

export function setEditorMode(mode: EditorMode): void {
  store.set((prev) => ({
    ...prev,
    editorMode: mode,
    // entering preview clears KF selection so interpolation takes over immediately
    selectedKeyframeId: mode === 'preview' ? null : prev.selectedKeyframeId,
  }));
}

// ─── Undo history ─────────────────────────────────────────────────────────────

interface HistoryEntry {
  keyframes: Keyframe[];
  selectedKeyframeId: string | null;
}

const kfHistory: HistoryEntry[] = [];
const MAX_HISTORY = 50;

function pushHistory(): void {
  const { keyframes, selectedKeyframeId } = store.get();
  kfHistory.push({ keyframes: keyframes.map((kf) => ({ ...kf })), selectedKeyframeId });
  if (kfHistory.length > MAX_HISTORY) kfHistory.shift();
}

export function undoKeyframe(): void {
  const entry = kfHistory.pop();
  if (entry) {
    store.set((prev) => ({ ...prev, keyframes: entry.keyframes, selectedKeyframeId: entry.selectedKeyframeId }));
  }
}

export function canUndoKeyframe(): boolean {
  return kfHistory.length > 0;
}

// ─── Keyframe actions ─────────────────────────────────────────────────────────

export function addKeyframe(time: number): void {
  const state = store.get();
  const { keyframes, cropRect, videoCenter, zoomLevel, selectedKeyframeId } = state;

  let containerRect = cropRect ?? DEFAULT_CONTAINER_RECT;
  let vc = videoCenter;
  let zoom = zoomLevel;

  if (keyframes.length > 0 && selectedKeyframeId === null) {
    const interp = getStateAtTime(keyframes, time);
    if (interp) {
      containerRect = interp.containerRect;
      vc = interp.videoCenter;
      zoom = interp.zoom;
    }
  }

  pushHistory();
  const id = crypto.randomUUID();
  const newKf: Keyframe = { id, time, containerRect, videoCenter: vc, zoom };
  const sorted = [...keyframes, newKf].sort((a, b) => a.time - b.time);

  store.set((prev) => ({
    ...prev,
    keyframes: sorted,
    selectedKeyframeId: id,
    cropRect: containerRect,
    videoCenter: vc,
    zoomLevel: zoom,
  }));
}

export function duplicateKeyframe(id: string, time: number): void {
  const src = store.get().keyframes.find((k) => k.id === id);
  if (!src) return;
  pushHistory();
  const newId = crypto.randomUUID();
  const newKf: Keyframe = { ...src, id: newId, time };
  const sorted = [...store.get().keyframes, newKf].sort((a, b) => a.time - b.time);
  store.set((prev) => ({
    ...prev,
    keyframes: sorted,
    selectedKeyframeId: newId,
    cropRect: src.containerRect,
    videoCenter: src.videoCenter,
    zoomLevel: src.zoom,
  }));
}

export function updateKeyframe(id: string, partial: Partial<Omit<Keyframe, 'id'>>): void {
  if (partial.time !== undefined) pushHistory();
  store.set((prev) => ({
    ...prev,
    keyframes: prev.keyframes
      .map((kf) => kf.id === id ? { ...kf, ...partial } : kf)
      .sort((a, b) => a.time - b.time),
  }));
}

export function deleteKeyframe(id: string): void {
  pushHistory();
  store.set((prev) => ({
    ...prev,
    keyframes: prev.keyframes.filter((kf) => kf.id !== id),
    selectedKeyframeId: prev.selectedKeyframeId === id ? null : prev.selectedKeyframeId,
  }));
}

export function selectKeyframe(id: string | null): void {
  if (id === null) {
    store.set((prev) => ({ ...prev, selectedKeyframeId: null }));
    return;
  }
  const kf = store.get().keyframes.find((k) => k.id === id);
  if (!kf) return;
  store.set((prev) => ({
    ...prev,
    selectedKeyframeId: id,
    cropRect: kf.containerRect,
    videoCenter: kf.videoCenter,
    zoomLevel: kf.zoom,
  }));
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
  const { sceneConfig, cropRect, zoomLevel, videoCenter, keyframes } = store.get();
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

  encodeWorker.postMessage({ type: 'START_ENCODE', videoFile, sceneConfig, cropRect, zoomLevel, videoCenter, keyframes });
}

async function startWebmExport(videoFile: File): Promise<void> {
  const { sceneConfig, cropRect, zoomLevel, videoCenter, keyframes } = store.get();
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

  worker.postMessage({ type: 'INIT_WEBM_ENCODE', sceneConfig, cropRect, zoomLevel, videoCenter, estimatedFrames, keyframes });
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
