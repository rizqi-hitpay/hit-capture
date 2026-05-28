import type { ParsedCommand } from '../commands/parser';
import { runCommands } from '../commands/runner';
import type { RawEvent } from '../types';

/**
 * Executes a parsed command list in the content script context.
 * Synthetic cursor events are fed directly into `onEvent` (the content
 * script's rawEvents array). Real clicks are dispatched to the DOM.
 * Progress and completion are signalled back to the service worker via
 * chrome.runtime.sendMessage.
 */
export async function runAutomation(
  commands: ParsedCommand[],
  startMs: number,
  onEvent: (event: RawEvent) => void,
): Promise<void> {
  const result = await runCommands(commands, startMs, {
    onProgress(step, total, description) {
      chrome.runtime.sendMessage({
        type: 'AUTOMATION_PROGRESS',
        step,
        total,
        description,
      }).catch(() => { /* popup may be closed */ });
    },
    onEvent,
  });

  if (result.success) {
    chrome.runtime.sendMessage({ type: 'AUTOMATION_DONE' }).catch(() => {});
  } else {
    chrome.runtime.sendMessage({ type: 'AUTOMATION_ERROR', message: result.error }).catch(() => {});
  }
}
