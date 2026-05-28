/**
 * Pipeline Web Worker
 * Runs the full 7-stage polish pipeline off the main thread.
 */
import { runPipeline } from '../pipeline/index';
import type { PipelineWorkerIn, PipelineWorkerOut } from '../types';

self.onmessage = (e: MessageEvent<PipelineWorkerIn>) => {
  const msg = e.data;
  if (msg.type !== 'RUN_PIPELINE') return;

  try {
    const track = runPipeline(msg.events, msg.params, msg.viewport);
    const out: PipelineWorkerOut = { type: 'DONE', track };
    self.postMessage(out);
  } catch (err) {
    const out: PipelineWorkerOut = {
      type: 'ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(out);
  }
};
