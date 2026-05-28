import type { RawEvent } from '../types';
import type { ParsedCommand } from './parser';
import { findByText, findByPlaceholder } from './elementFinder';
import { bezierPath, dwellEvents } from './pathGenerator';
import type { Point } from './pathGenerator';

export interface RunnerCallbacks {
  onProgress(step: number, total: number, description: string): void;
  onEvent(event: RawEvent): void;
}

export interface RunnerResult {
  success: boolean;
  error?: string;
}

const CURSOR_SPEED_PX_MS = 1.2;   // px per ms → 1200 px/s
const MIN_MOVE_MS = 300;
const DWELL_MS = 280;
const POST_CLICK_WAIT_MS = 500;
const POST_TYPE_WAIT_MS = 200;
const TYPE_CHAR_MS = 45;

export async function runCommands(
  commands: ParsedCommand[],
  startMs: number,
  callbacks: RunnerCallbacks,
): Promise<RunnerResult> {
  const { onProgress, onEvent } = callbacks;
  let cursor: Point = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
  let t = startMs; // running time offset from recording start

  function emit(events: RawEvent[]): void {
    for (const e of events) onEvent(e);
    if (events.length) t = events[events.length - 1].t + 1;
  }

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    onProgress(i + 1, commands.length, describe(cmd));

    try {
      if (cmd.type === 'wait') {
        await sleep(cmd.ms ?? 500);
        t += cmd.ms ?? 500;
        continue;
      }

      if (cmd.type === 'scroll') {
        const amount = cmd.amount ?? 300;
        const deltaY = cmd.direction === 'down' ? amount : -amount;
        window.scrollBy({ top: deltaY, behavior: 'smooth' });
        onEvent({ k: 'scroll', t, x: window.scrollX, y: window.scrollY + deltaY });
        t += 500;
        await sleep(500);
        continue;
      }

      if (cmd.type === 'click' || cmd.type === 'hover') {
        const found = findByText(cmd.target!);
        if (!found) throw new Error(`Cannot find element matching "${cmd.target}"`);

        // Scroll into view if needed, then re-measure centre
        found.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        await sleep(80);
        const rect = found.element.getBoundingClientRect();
        const target: Point = {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };

        // Move cursor to element
        const dist = Math.hypot(target.x - cursor.x, target.y - cursor.y);
        const moveDuration = Math.max(MIN_MOVE_MS, dist / CURSOR_SPEED_PX_MS);
        emit(bezierPath(cursor, target, moveDuration, t));
        cursor = target;
        await sleep(moveDuration);

        // Dwell
        emit(dwellEvents(cursor, DWELL_MS, t));
        await sleep(DWELL_MS);

        if (cmd.type === 'click') {
          onEvent({ k: 'down', t, x: cursor.x, y: cursor.y, b: 0 });
          t += 50;
          found.element.click();
          await sleep(50);
          onEvent({ k: 'up', t, x: cursor.x, y: cursor.y, b: 0 });
          t += POST_CLICK_WAIT_MS;
          await sleep(POST_CLICK_WAIT_MS);
        }
        continue;
      }

      if (cmd.type === 'type') {
        const found = findByText(cmd.target!) ?? findByPlaceholder(cmd.target!);
        if (!found) throw new Error(`Cannot find input matching "${cmd.target}"`);

        found.element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        await sleep(80);
        const rect = found.element.getBoundingClientRect();
        const target: Point = {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };

        const dist = Math.hypot(target.x - cursor.x, target.y - cursor.y);
        const moveDuration = Math.max(MIN_MOVE_MS, dist / CURSOR_SPEED_PX_MS);
        emit(bezierPath(cursor, target, moveDuration, t));
        cursor = target;
        await sleep(moveDuration);

        emit(dwellEvents(cursor, DWELL_MS, t));
        await sleep(DWELL_MS);

        // Click to focus
        onEvent({ k: 'down', t, x: cursor.x, y: cursor.y, b: 0 });
        t += 50;
        found.element.click();
        found.element.focus();
        await sleep(50);
        onEvent({ k: 'up', t, x: cursor.x, y: cursor.y, b: 0 });
        t += 150;
        await sleep(150);

        // Type characters
        const inp = found.element as HTMLInputElement | HTMLTextAreaElement;
        const value = cmd.value ?? '';
        for (const char of value) {
          inp.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
          inp.value += char;
          inp.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: char }));
          inp.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
          t += TYPE_CHAR_MS;
          await sleep(TYPE_CHAR_MS);
        }

        t += POST_TYPE_WAIT_MS;
        await sleep(POST_TYPE_WAIT_MS);
        continue;
      }
    } catch (err) {
      return {
        success: false,
        error: `Step ${i + 1} — ${describe(cmd)}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { success: true };
}

function describe(cmd: ParsedCommand): string {
  switch (cmd.type) {
    case 'click':  return `Clicking "${cmd.target}"`;
    case 'hover':  return `Hovering "${cmd.target}"`;
    case 'type':   return `Typing "${cmd.value}" into "${cmd.target}"`;
    case 'scroll': return `Scrolling ${cmd.direction}`;
    case 'wait':   return `Waiting ${cmd.ms}ms`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
