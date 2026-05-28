import type { ParsedCommand } from '../commands/parser';
import { runCommands, dryRunCommands } from '../commands/runner';
import type { RawEvent } from '../types';

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
      }).catch(() => {});
    },
    onEvent,
  });

  if (result.success) {
    chrome.runtime.sendMessage({ type: 'AUTOMATION_DONE' }).catch(() => {});
  } else {
    chrome.runtime.sendMessage({ type: 'AUTOMATION_ERROR', message: result.error }).catch(() => {});
  }
}

/** Dry-run: find & highlight each target without recording or clicking. */
export async function runDryRun(commands: ParsedCommand[]): Promise<void> {
  await dryRunCommands(commands, (result) => {
    chrome.runtime.sendMessage({
      type: 'DRY_RUN_STEP',
      step: result.step,
      total: commands.length,
      description: result.description,
      found: result.found,
    }).catch(() => {});
  });
  chrome.runtime.sendMessage({ type: 'DRY_RUN_DONE' }).catch(() => {});
}
