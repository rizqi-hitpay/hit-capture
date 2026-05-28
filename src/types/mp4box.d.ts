/**
 * Minimal type declarations for mp4box npm package.
 * The library doesn't ship complete TS types for all APIs we use.
 */
declare module 'mp4box' {
  export interface MP4MediaTrack {
    id: number;
    created: Date;
    modified: Date;
    movie_duration: number;
    movie_timescale: number;
    layer: number;
    alternate_group: number;
    volume: number;
    track_width: number;
    track_height: number;
    timescale: number;
    duration: number;
    bitrate: number;
    codec: string;
    language: string;
    nb_samples: number;
  }

  export interface MP4VideoData {
    width: number;
    height: number;
  }

  export interface MP4VideoTrack extends MP4MediaTrack {
    video: MP4VideoData;
  }

  export interface MP4AudioData {
    sample_rate: number;
    channel_count: number;
    sample_size: number;
  }

  export interface MP4AudioTrack extends MP4MediaTrack {
    audio: MP4AudioData;
  }

  export type MP4Track = MP4VideoTrack | MP4AudioTrack;

  export interface MP4Info {
    duration: number;
    timescale: number;
    isProgressive: boolean;
    isFragmented: boolean;
    tracks: MP4Track[];
    mime: string;
    videoTracks: MP4VideoTrack[];
    audioTracks: MP4AudioTrack[];
  }

  export interface MP4Sample {
    track_id: number;
    description: {
      avcC?: {
        AVCProfileIndication: number;
        profile_compatibility: number;
        AVCLevelIndication: number;
        lengthSizeMinusOne: number;
        SPS: Array<{ length: number; nalu: Uint8Array }>;
        PPS: Array<{ length: number; nalu: Uint8Array }>;
      };
      hvcC?: unknown;
    };
    is_sync: boolean;
    timescale: number;
    /** decode timestamp (timescale units) */
    dts: number;
    /** composition timestamp (timescale units) */
    cts: number;
    duration: number;
    data: Uint8Array;
    size: number;
    number: number;
  }

  export interface ExtractionOptions {
    nbSamples?: number;
  }

  export interface MP4File {
    onReady: ((info: MP4Info) => void) | null;
    onError: ((e: string) => void) | null;
    onSamples: ((id: number, user: unknown, samples: MP4Sample[]) => void) | null;

    appendBuffer(buffer: ArrayBuffer & { fileStart: number }): number;
    flush(): void;
    start(): void;
    stop(): void;
    setExtractionOptions(
      id: number,
      user?: unknown,
      options?: ExtractionOptions
    ): void;
    getTrackById(id: number): unknown;
    releaseUsedSamples(id: number, sampleNumber: number): void;
  }

  const MP4Box: {
    createFile(): MP4File;
    Log: {
      setLogLevel(level: unknown): void;
    };
  };

  export default MP4Box;
}
