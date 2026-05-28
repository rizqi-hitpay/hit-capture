/**
 * Encode Web Worker
 *
 * Full encode pipeline:
 *   VideoDecoder (demux via mp4box) → OffscreenCanvas render → VideoEncoder → mp4-muxer
 *
 * All processing stays in this worker; no DOM access required.
 */
import type {
  EncodeWorkerIn,
  EncodeWorkerOut,
  PolishedPoint,
  PolishedTrack,
  SceneConfig,
  CaptureSession,
  CoordTransform,
  RenderFrameData,
} from '../types';
import { demuxMP4 } from '../encoder/frameSource';
import { setupEncoder } from '../encoder/webcodecs';
import { createMuxer } from '../encoder/mp4Muxer';
import { ZoomController } from '../renderer/zoomController';
import { SceneRenderer } from '../renderer/sceneRenderer';
import { DEFAULT_OUTPUT_FRAMERATE, DEFAULT_OUTPUT_BITRATE, ENCODE_MAX_QUEUE_DEPTH } from '../shared/constants';
import { transformPoint } from '../shared/coords';

self.onmessage = async (e: MessageEvent<EncodeWorkerIn>) => {
  if (e.data.type !== 'START_ENCODE') return;
  const { videoFile, track, sceneConfig, session, coordTransform } = e.data;

  try {
    await encode(videoFile, track, sceneConfig, session, coordTransform);
  } catch (err) {
    const out: EncodeWorkerOut = {
      type: 'ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(out);
  }
};

// ─── Main encode function ─────────────────────────────────────────────────────

async function encode(
  videoFile: File,
  track: PolishedTrack,
  sceneConfig: SceneConfig,
  session: CaptureSession,
  coordTransform: CoordTransform
): Promise<void> {
  const { outputWidth: W, outputHeight: H } = sceneConfig;

  // Read the full file into memory (needed for mp4box)
  const fileBuffer = await videoFile.arrayBuffer();

  // Set up the OffscreenCanvas
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D;

  // Scene renderer + zoom controller
  const renderer = new SceneRenderer();
  const zoom = new ZoomController(sceneConfig.autoZoom);
  zoom.build(track, session.viewport.w, session.viewport.h);

  // Muxer setup (codec determined after encoder setup)
  let muxerSetup: ReturnType<typeof createMuxer> | null = null;
  let encoderSetup: Awaited<ReturnType<typeof setupEncoder>> | null = null;

  // Decode queue for backpressure
  let decodeQueueSize = 0;
  let totalSamples = 0;
  let samplesDecoded = 0;
  let encodeDone = false;
  let resolveEncode: (() => void) | null = null;
  const encodePromise = new Promise<void>((res) => { resolveEncode = res; });

  // Pending decoded frames (we process them in order)
  const pendingFrames: VideoFrame[] = [];
  let processingFrame = false;

  async function processNextFrame(): Promise<void> {
    if (processingFrame || pendingFrames.length === 0) return;
    processingFrame = true;

    const videoFrame = pendingFrames.shift()!;
    const timestampUs = videoFrame.timestamp;
    const timestampMs = timestampUs / 1000;

    try {
      // Get cursor position at this timestamp
      const { x: rawCursorX, y: rawCursorY } = getCursorAtTime(track.points, timestampMs);
      const { x: vidCursorX, y: vidCursorY } = transformPoint(rawCursorX, rawCursorY, coordTransform);

      // Scale cursor to output canvas space
      const cursorX = (vidCursorX / session.viewport.w) * W;
      const cursorY = (vidCursorY / session.viewport.h) * H;

      // Is this a click frame?
      const isClick = track.clicks.some((c) => Math.abs(c.t - timestampMs) < 50);
      const clickProgress = isClick
        ? (timestampMs - (track.clicks.find((c) => Math.abs(c.t - timestampMs) < 50)?.t ?? 0)) / 400
        : 0;

      // Camera state
      const camera = zoom.getCamera(timestampMs);

      const frameData: RenderFrameData = {
        videoSource: videoFrame,
        cursorX,
        cursorY,
        isClick,
        clickProgress,
        camera,
        t: timestampMs,
      };

      renderer.render(ctx, frameData, sceneConfig);

      // Create output VideoFrame from canvas
      const outputFrame = new VideoFrame(canvas, {
        timestamp: timestampUs,
        duration: videoFrame.duration ?? undefined,
      });

      videoFrame.close();

      // Encode with backpressure
      while (
        encoderSetup &&
        encoderSetup.encoder.encodeQueueSize > ENCODE_MAX_QUEUE_DEPTH
      ) {
        await sleep(5);
      }

      if (encoderSetup) {
        const isKeyFrame = samplesDecoded % (DEFAULT_OUTPUT_FRAMERATE * 2) === 0;
        encoderSetup.encoder.encode(outputFrame, { keyFrame: isKeyFrame });
      }
      outputFrame.close();

      samplesDecoded++;
      const progress = Math.round((samplesDecoded / Math.max(totalSamples, 1)) * 100);
      const out: EncodeWorkerOut = { type: 'PROGRESS', percent: progress };
      self.postMessage(out);
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

  // Set up encoder (needs width/height upfront)
  encoderSetup = await setupEncoder({
    width: W,
    height: H,
    framerate: DEFAULT_OUTPUT_FRAMERATE,
    bitrate: DEFAULT_OUTPUT_BITRATE,
    onChunk: (chunk, meta) => {
      muxerSetup?.muxer.addVideoChunk(chunk, meta);
    },
    onError: (err) => {
      console.error('[EncodeWorker] VideoEncoder error:', err);
    },
  });

  muxerSetup = createMuxer(encoderSetup.codec, W, H);

  // Set up VideoDecoder
  const decoder = new VideoDecoder({
    output: (frame) => {
      decodeQueueSize--;
      pendingFrames.push(frame);
      processNextFrame();
    },
    error: (err) => {
      console.error('[EncodeWorker] VideoDecoder error:', err);
    },
  });

  // Demux and decode
  const { track: videoTrack, description } = await demuxMP4(fileBuffer, {
    onChunk: async (chunk, _idx, total) => {
      totalSamples = total;

      // Backpressure — pause if decode queue is full
      while (decodeQueueSize > ENCODE_MAX_QUEUE_DEPTH * 2) {
        await sleep(10);
      }

      // Configure decoder on first chunk (once we have description)
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
    onDone: () => {
      // Decoder will flush remaining frames via output callback
    },
    onError: (err) => {
      throw err;
    },
  });

  // Wait for all frames to be encoded
  await encodePromise;

  // Flush encoder and finalize muxer
  await encoderSetup.encoder.flush();
  muxerSetup.muxer.finalize();

  const { buffer } = muxerSetup.target;
  const doneMsg: EncodeWorkerOut = { type: 'DONE', buffer };
  (self as unknown as Worker).postMessage(doneMsg, [buffer]);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getCursorAtTime(points: PolishedPoint[], timeMs: number): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 };
  if (timeMs <= points[0].t) return { x: points[0].x, y: points[0].y };
  if (timeMs >= points[points.length - 1].t) {
    const last = points[points.length - 1];
    return { x: last.x, y: last.y };
  }

  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= timeMs) lo = mid;
    else hi = mid;
  }

  const prev = points[lo];
  const next = points[hi];
  const span = next.t - prev.t;
  const alpha = span > 0 ? (timeMs - prev.t) / span : 0;
  return {
    x: prev.x + (next.x - prev.x) * alpha,
    y: prev.y + (next.y - prev.y) * alpha,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
