/**
 * Utilities for demuxing an MP4 file in a Web Worker using mp4box.js.
 * Produces EncodedVideoChunk objects suitable for VideoDecoder.
 */
import MP4Box from 'mp4box';
import type { MP4Sample, MP4VideoTrack } from 'mp4box';

export interface DemuxResult {
  /** Decoded track info */
  track: MP4VideoTrack;
  /** AVCDecoderConfigurationRecord (for H.264 description) */
  description: Uint8Array | undefined;
  /** Total number of samples */
  sampleCount: number;
}

export interface DemuxCallbacks {
  onChunk: (chunk: EncodedVideoChunk, sampleIndex: number, total: number) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

/**
 * Demux an MP4 ArrayBuffer, emitting EncodedVideoChunk for each sample.
 * Returns a Promise that resolves with the track info once ready.
 */
export function demuxMP4(
  buffer: ArrayBuffer,
  callbacks: DemuxCallbacks
): Promise<DemuxResult> {
  return new Promise((resolve, reject) => {
    const file = MP4Box.createFile();
    let videoTrack: MP4VideoTrack | null = null;
    let description: Uint8Array | undefined;
    let sampleCount = 0;
    let samplesProcessed = 0;

    file.onReady = (info) => {
      videoTrack = info.videoTracks[0];
      if (!videoTrack) {
        reject(new Error('No video track found in MP4 file'));
        return;
      }

      sampleCount = videoTrack.nb_samples;
      description = extractH264Description(file, videoTrack.id);

      file.setExtractionOptions(videoTrack.id, null, { nbSamples: 100 });
      file.start();

      resolve({
        track: videoTrack,
        description,
        sampleCount,
      });
    };

    file.onSamples = (_id: number, _user: unknown, samples: MP4Sample[]) => {
      for (const sample of samples) {
        const timescale = sample.timescale;
        const timestampUs = (sample.cts / timescale) * 1_000_000;
        const durationUs = (sample.duration / timescale) * 1_000_000;

        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: timestampUs,
          duration: durationUs,
          data: sample.data,
        });

        samplesProcessed++;
        callbacks.onChunk(chunk, samplesProcessed, sampleCount);
      }

      // Release memory after processing
      if (videoTrack) {
        file.releaseUsedSamples(videoTrack.id, samplesProcessed);
      }

      if (samplesProcessed >= sampleCount) {
        callbacks.onDone();
      }
    };

    file.onError = (e: string) => {
      callbacks.onError(new Error(`mp4box error: ${e}`));
      reject(new Error(`mp4box error: ${e}`));
    };

    // Feed the buffer
    const typedBuffer = buffer as ArrayBuffer & { fileStart: number };
    typedBuffer.fileStart = 0;
    file.appendBuffer(typedBuffer);
    file.flush();
  });
}

// ─── H.264 description extraction ────────────────────────────────────────────

function extractH264Description(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  file: any,
  trackId: number
): Uint8Array | undefined {
  try {
    const trak = file.getTrackById(trackId);
    const avcC =
      trak?.mdia?.minf?.stbl?.stsd?.entries?.[0]?.avcC;
    if (!avcC) return undefined;

    return buildAVCDecoderConfigRecord(avcC);
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildAVCDecoderConfigRecord(avcC: any): Uint8Array {
  const spsList: Array<{ nalu: Uint8Array }> = avcC.SPS ?? [];
  const ppsList: Array<{ nalu: Uint8Array }> = avcC.PPS ?? [];

  let size = 7;
  for (const sps of spsList) size += 2 + sps.nalu.length;
  for (const pps of ppsList) size += 2 + pps.nalu.length;

  const buf = new Uint8Array(size);
  const view = new DataView(buf.buffer);
  let off = 0;

  buf[off++] = 1; // configurationVersion
  buf[off++] = avcC.AVCProfileIndication ?? 0x4d;
  buf[off++] = avcC.profile_compatibility ?? 0x40;
  buf[off++] = avcC.AVCLevelIndication ?? 0x28;
  buf[off++] = 0xff; // lengthSizeMinusOne = 3
  buf[off++] = 0xe0 | (spsList.length & 0x1f);

  for (const sps of spsList) {
    view.setUint16(off, sps.nalu.length);
    off += 2;
    buf.set(sps.nalu, off);
    off += sps.nalu.length;
  }

  buf[off++] = ppsList.length & 0xff;
  for (const pps of ppsList) {
    view.setUint16(off, pps.nalu.length);
    off += 2;
    buf.set(pps.nalu, off);
    off += pps.nalu.length;
  }

  return buf;
}
