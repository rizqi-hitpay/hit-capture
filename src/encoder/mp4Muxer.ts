/**
 * mp4-muxer integration — wraps the Muxer with ArrayBufferTarget.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import type { OutputCodec } from './webcodecs';

export interface MuxerSetup {
  muxer: Muxer<ArrayBufferTarget>;
  target: ArrayBufferTarget;
}

export function createMuxer(
  codec: OutputCodec,
  width: number,
  height: number
): MuxerSetup {
  const target = new ArrayBufferTarget();

  const muxer = new Muxer({
    target,
    video: {
      codec: codec === 'avc' ? 'avc' : 'vp9',
      width,
      height,
    },
    // moov at front — makes the file seekable before full download
    fastStart: 'in-memory',
  });

  return { muxer, target };
}
