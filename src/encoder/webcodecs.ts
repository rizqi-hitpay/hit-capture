/**
 * VideoEncoder wrapper with automatic codec detection and fallback.
 * Prefers H.264 (avc1), falls back to VP9 (vp09) which outputs WebM.
 */

export type OutputCodec = 'avc' | 'vp9';

export interface EncoderSetupResult {
  encoder: VideoEncoder;
  codec: OutputCodec;
  mimeType: string;
}

export interface EncoderOptions {
  width: number;
  height: number;
  framerate: number;
  bitrate: number;
  onChunk: (chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata | undefined) => void;
  onError: (e: DOMException) => void;
}

const H264_CODEC = 'avc1.4d0028'; // High Profile Level 4.0
const VP9_CODEC = 'vp09.00.10.08.03';

export async function setupEncoder(opts: EncoderOptions): Promise<EncoderSetupResult> {
  const { width, height, framerate, bitrate } = opts;

  const baseConfig = { width, height, framerate, bitrate, latencyMode: 'quality' } as const;

  // Try H.264 first
  const h264Config: VideoEncoderConfig = { ...baseConfig, codec: H264_CODEC };
  const h264Support = await VideoEncoder.isConfigSupported(h264Config);

  if (h264Support.supported) {
    const encoder = new VideoEncoder({ output: opts.onChunk, error: opts.onError });
    encoder.configure(h264Config);
    return { encoder, codec: 'avc', mimeType: 'video/mp4' };
  }

  // Fallback to VP9
  const vp9Config: VideoEncoderConfig = { ...baseConfig, codec: VP9_CODEC };
  const vp9Support = await VideoEncoder.isConfigSupported(vp9Config);

  if (vp9Support.supported) {
    const encoder = new VideoEncoder({ output: opts.onChunk, error: opts.onError });
    encoder.configure(vp9Config);
    return { encoder, codec: 'vp9', mimeType: 'video/webm' };
  }

  throw new Error(
    'No supported video encoder found (tried H.264 and VP9). ' +
      'Make sure you\'re on Chrome 121+.'
  );
}
