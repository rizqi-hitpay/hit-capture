/**
 * Encode Web Worker
 *
 * Two encode modes:
 *  - MP4/MOV input: VideoDecoder (demux via mp4box) → OffscreenCanvas render → VideoEncoder
 *  - WebM input:    Main thread seeks + captures VideoFrame → worker renders + encodes
 */
import type {
  EncodeWorkerIn,
  EncodeWorkerOut,
  SceneConfig,
  CropRect,
  VideoOffset,
} from '../types';
import type { MuxerSetup } from '../encoder/mp4Muxer';
import type { EncoderSetupResult } from '../encoder/webcodecs';
import { demuxMP4 } from '../encoder/frameSource';
import { setupEncoder } from '../encoder/webcodecs';
import { createMuxer } from '../encoder/mp4Muxer';
import { SceneRenderer } from '../renderer/sceneRenderer';
import { DEFAULT_OUTPUT_FRAMERATE, DEFAULT_OUTPUT_BITRATE, ENCODE_MAX_QUEUE_DEPTH } from '../shared/constants';

// ─── WebM streaming encode state ─────────────────────────────────────────────

interface WebmEncodeState {
  sceneConfig: SceneConfig;
  cropRect: CropRect | null;
  zoomLevel: number;
  videoOffset: VideoOffset;
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
  renderer: SceneRenderer;
  muxerSetup: MuxerSetup;
  encoderSetup: EncoderSetupResult;
  frameCount: number;
  estimatedFrames: number;
}

let webmState: WebmEncodeState | null = null;

// ─── Null render frame ────────────────────────────────────────────────────────

function makeFrame(source: VideoFrame | OffscreenCanvas, timestampMs: number) {
  return {
    videoSource: source as unknown as import('../types').RenderFrameData['videoSource'],
    cursorX: 0, cursorY: 0,
    isClick: false, clickProgress: 0,
    camera: { scale: 1, tx: 0, ty: 0 },
    t: timestampMs,
  };
}

// ─── Message dispatch ─────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<EncodeWorkerIn>) => {
  const msg = e.data;

  if (msg.type === 'START_ENCODE') {
    const { videoFile, sceneConfig, cropRect, zoomLevel, videoOffset } = msg;
    try {
      await encode(videoFile, sceneConfig, cropRect, zoomLevel, videoOffset);
    } catch (err) {
      self.postMessage({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) } as EncodeWorkerOut);
    }
    return;
  }

  if (msg.type === 'INIT_WEBM_ENCODE') {
    const { sceneConfig, cropRect, zoomLevel, videoOffset, estimatedFrames } = msg;
    const { outputWidth: W, outputHeight: H } = sceneConfig;
    try {
      const canvas = new OffscreenCanvas(W, H);
      const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
      const renderer = new SceneRenderer();

      let muxerSetup: MuxerSetup | null = null;
      const encoderSetup = await setupEncoder({
        width: W, height: H,
        framerate: DEFAULT_OUTPUT_FRAMERATE,
        bitrate: DEFAULT_OUTPUT_BITRATE,
        onChunk: (chunk, meta) => muxerSetup?.muxer.addVideoChunk(chunk, meta),
        onError: (err) => console.error('[EncodeWorker] WebM encoder error:', err),
      });
      muxerSetup = createMuxer(encoderSetup.codec, W, H);

      webmState = {
        sceneConfig, cropRect, zoomLevel, videoOffset,
        canvas, ctx, renderer,
        muxerSetup, encoderSetup,
        frameCount: 0, estimatedFrames,
      };

      self.postMessage({ type: 'WEBM_INIT_ACK' } as EncodeWorkerOut);
    } catch (err) {
      self.postMessage({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) } as EncodeWorkerOut);
    }
    return;
  }

  if (msg.type === 'WEBM_FRAME') {
    if (!webmState) return;
    const { frame } = msg;
    const { sceneConfig, cropRect, zoomLevel, videoOffset, canvas, ctx, renderer, encoderSetup } = webmState;
    const timestampUs = frame.timestamp;
    const timestampMs = timestampUs / 1000;

    renderer.render(ctx, makeFrame(frame, timestampMs), sceneConfig, cropRect, zoomLevel, videoOffset);

    const outputFrame = new VideoFrame(canvas, {
      timestamp: timestampUs,
      duration: Math.round(1_000_000 / DEFAULT_OUTPUT_FRAMERATE),
    });

    while (encoderSetup.encoder.encodeQueueSize > ENCODE_MAX_QUEUE_DEPTH) {
      await sleep(5);
    }

    const isKeyFrame = webmState.frameCount % (DEFAULT_OUTPUT_FRAMERATE * 2) === 0;
    encoderSetup.encoder.encode(outputFrame, { keyFrame: isKeyFrame });
    frame.close();
    outputFrame.close();

    webmState.frameCount++;
    const progress = Math.round((webmState.frameCount / webmState.estimatedFrames) * 100);
    self.postMessage({ type: 'PROGRESS', percent: Math.min(99, progress) } as EncodeWorkerOut);
    self.postMessage({ type: 'WEBM_FRAME_ACK' } as EncodeWorkerOut);
    return;
  }

  if (msg.type === 'END_WEBM_ENCODE') {
    if (!webmState) return;
    const { encoderSetup, muxerSetup } = webmState;
    try {
      await encoderSetup.encoder.flush();
      muxerSetup.muxer.finalize();
      const { buffer } = muxerSetup.target;
      (self as unknown as Worker).postMessage({ type: 'DONE', buffer } as EncodeWorkerOut, [buffer]);
    } catch (err) {
      self.postMessage({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) } as EncodeWorkerOut);
    } finally {
      webmState = null;
    }
    return;
  }
};

// ─── MP4/MOV encode ───────────────────────────────────────────────────────────

async function encode(
  videoFile: File,
  sceneConfig: SceneConfig,
  cropRect: CropRect | null,
  zoomLevel: number,
  videoOffset: VideoOffset,
): Promise<void> {
  const { outputWidth: W, outputHeight: H } = sceneConfig;

  const fileBuffer = await videoFile.arrayBuffer();

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;
  const renderer = new SceneRenderer();

  let muxerSetup: ReturnType<typeof createMuxer> | null = null;
  let encoderSetup: Awaited<ReturnType<typeof setupEncoder>> | null = null;

  let decodeQueueSize = 0;
  let totalSamples = 0;
  let samplesDecoded = 0;
  let encodeDone = false;
  let resolveEncode: (() => void) | null = null;
  const encodePromise = new Promise<void>((res) => { resolveEncode = res; });

  const pendingFrames: VideoFrame[] = [];
  let processingFrame = false;

  async function processNextFrame(): Promise<void> {
    if (processingFrame || pendingFrames.length === 0) return;
    processingFrame = true;

    const videoFrame = pendingFrames.shift()!;
    const timestampUs = videoFrame.timestamp;
    const timestampMs = timestampUs / 1000;

    try {
      renderer.render(ctx, makeFrame(videoFrame, timestampMs), sceneConfig, cropRect, zoomLevel, videoOffset);

      const outputFrame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: videoFrame.duration ?? undefined,
      });
      videoFrame.close();

      while (encoderSetup && encoderSetup.encoder.encodeQueueSize > ENCODE_MAX_QUEUE_DEPTH) {
        await sleep(5);
      }

      if (encoderSetup) {
        const isKeyFrame = samplesDecoded % (DEFAULT_OUTPUT_FRAMERATE * 2) === 0;
        encoderSetup.encoder.encode(outputFrame, { keyFrame: isKeyFrame });
      }
      outputFrame.close();

      samplesDecoded++;
      self.postMessage({ type: 'PROGRESS', percent: Math.round((samplesDecoded / Math.max(totalSamples, 1)) * 100) } as EncodeWorkerOut);
    } catch (err) {
      videoFrame.close();
      console.error('[EncodeWorker] Frame error:', err);
    }

    processingFrame = false;

    if (pendingFrames.length > 0) {
      await processNextFrame();
    } else if (samplesDecoded >= totalSamples && !encodeDone) {
      encodeDone = true;
      resolveEncode?.();
    }
  }

  encoderSetup = await setupEncoder({
    width: W, height: H,
    framerate: DEFAULT_OUTPUT_FRAMERATE,
    bitrate: DEFAULT_OUTPUT_BITRATE,
    onChunk: (chunk, meta) => { muxerSetup?.muxer.addVideoChunk(chunk, meta); },
    onError: (err) => { console.error('[EncodeWorker] VideoEncoder error:', err); },
  });

  muxerSetup = createMuxer(encoderSetup.codec, W, H);

  const decoder = new VideoDecoder({
    output: (frame) => { decodeQueueSize--; pendingFrames.push(frame); processNextFrame(); },
    error: (err) => { console.error('[EncodeWorker] VideoDecoder error:', err); },
  });

  const { track: videoTrack, description } = await demuxMP4(fileBuffer, {
    onChunk: async (chunk, _idx, total) => {
      totalSamples = total;
      while (decodeQueueSize > ENCODE_MAX_QUEUE_DEPTH * 2) { await sleep(10); }
      if (decoder.state === 'unconfigured') {
        decoder.configure({
          codec: videoTrack.codec,
          codedWidth: videoTrack.video.width,
          codedHeight: videoTrack.video.height,
          description,
        });
      }
      decodeQueueSize++;
      decoder.decode(chunk);
    },
    onDone: () => {},
    onError: (err) => { throw err; },
  });

  await encodePromise;
  await encoderSetup.encoder.flush();
  muxerSetup.muxer.finalize();

  const { buffer } = muxerSetup.target;
  (self as unknown as Worker).postMessage({ type: 'DONE', buffer } as EncodeWorkerOut, [buffer]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
