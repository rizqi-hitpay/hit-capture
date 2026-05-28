import type { RawEvent } from '../types';
import type { ParsedCommand } from './parser';
import { findByText, findByPlaceholder } from './elementFinder';
import type { FoundElement } from './elementFinder';
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
const FIND_RETRY_MS = 3000;       // Phase 2: retry element lookup for up to 3 s
const URL_SETTLE_MS = 1500;       // Phase 2: wait after SPA navigation

export async function runCommands(
  commands: ParsedCommand[],
  startMs: number,
  callbacks: RunnerCallbacks,
): Promise<RunnerResult> {
  const { onProgress, onEvent } = callbacks;
  let cursor: Point = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
  let t = startMs;

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
        const deltaY = cmd.direction === 'down' ? (cmd.amount ?? 300) : -(cmd.amount ?? 300);
        window.scrollBy({ top: deltaY, behavior: 'smooth' });
        // Scroll events are captured by the content script's DOM scroll listener —
        // no manual push needed here (would cause duplicates).
        t += 600;
        await sleep(600);
        continue;
      }

      if (cmd.type === 'click' || cmd.type === 'hover') {
        const found = await findWithRetry(cmd.target!, FIND_RETRY_MS);
        if (!found) throw new Error(`Element not found after ${FIND_RETRY_MS / 1000}s: "${cmd.target}"`);

        const target = centreOf(found);
        const dist = Math.hypot(target.x - cursor.x, target.y - cursor.y);
        const moveDuration = Math.max(MIN_MOVE_MS, dist / CURSOR_SPEED_PX_MS);

        emit(bezierPath(cursor, target, moveDuration, t));
        cursor = target;
        await sleep(moveDuration);

        emit(dwellEvents(cursor, DWELL_MS, t));
        await sleep(DWELL_MS);

        if (cmd.type === 'click') {
          onEvent({ k: 'down', t, x: cursor.x, y: cursor.y, b: 0 });
          t += 50;
          const prevUrl = location.href;
          found.element.click();
          await sleep(50);
          onEvent({ k: 'up', t, x: cursor.x, y: cursor.y, b: 0 });
          t += POST_CLICK_WAIT_MS;
          // Phase 2: if SPA navigation happened, wait for new view to settle
          await waitForUrlSettle(prevUrl, URL_SETTLE_MS);
          await sleep(POST_CLICK_WAIT_MS);
        }
        continue;
      }

      if (cmd.type === 'type') {
        const found = await findWithRetry(cmd.target!, FIND_RETRY_MS, true);
        if (!found) throw new Error(`Input not found after ${FIND_RETRY_MS / 1000}s: "${cmd.target}"`);

        const target = centreOf(found);
        const dist = Math.hypot(target.x - cursor.x, target.y - cursor.y);
        const moveDuration = Math.max(MIN_MOVE_MS, dist / CURSOR_SPEED_PX_MS);

        emit(bezierPath(cursor, target, moveDuration, t));
        cursor = target;
        await sleep(moveDuration);

        emit(dwellEvents(cursor, DWELL_MS, t));
        await sleep(DWELL_MS);

        onEvent({ k: 'down', t, x: cursor.x, y: cursor.y, b: 0 });
        t += 50;
        found.element.click();
        found.element.focus();
        await sleep(50);
        onEvent({ k: 'up', t, x: cursor.x, y: cursor.y, b: 0 });
        t += 150;
        await sleep(150);

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

// ─── Phase 2: Dry-run — find each target, report found/not-found ──────────────

export interface DryRunStepResult {
  step: number;
  description: string;
  found: boolean;
  x?: number;
  y?: number;
}

export async function dryRunCommands(
  commands: ParsedCommand[],
  onStep: (result: DryRunStepResult) => void,
): Promise<void> {
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const desc = describe(cmd);

    if (cmd.type === 'wait' || cmd.type === 'scroll') {
      onStep({ step: i + 1, description: desc, found: true });
      await sleep(50);
      continue;
    }

    const preferInput = cmd.type === 'type';
    const found = preferInput
      ? (findByText(cmd.target!) ?? findByPlaceholder(cmd.target!))
      : findByText(cmd.target!);

    if (found) {
      const rect = found.element.getBoundingClientRect();
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      showHighlight(found.element);
      onStep({ step: i + 1, description: desc, found: true, x, y });
      await sleep(900);
      removeHighlight();
    } else {
      onStep({ step: i + 1, description: desc, found: false });
      await sleep(150);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function findWithRetry(
  text: string,
  timeoutMs: number,
  preferInput = false,
): Promise<FoundElement | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const found = preferInput
      ? (findByText(text) ?? findByPlaceholder(text))
      : findByText(text);
    if (found) return found;
    await sleep(250);
  } while (Date.now() < deadline);
  return null;
}

async function waitForUrlSettle(prevUrl: string, timeoutMs: number): Promise<void> {
  await sleep(150);
  if (location.href === prevUrl) return;
  // URL changed — wait for the new view to render
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (document.readyState === 'complete') {
      await sleep(400); // give async frameworks time to render
      return;
    }
    await sleep(100);
  }
}

function centreOf(found: FoundElement): Point {
  // Re-measure after any scroll
  const rect = found.element.getBoundingClientRect();
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
}

let highlightEl: HTMLElement | null = null;

function showHighlight(target: HTMLElement): void {
  removeHighlight();
  const rect = target.getBoundingClientRect();
  const el = document.createElement('div');
  el.id = '__cc-dry-run-highlight__';
  el.style.cssText = [
    'position:fixed',
    `top:${rect.top - 4}px`,
    `left:${rect.left - 4}px`,
    `width:${rect.width + 8}px`,
    `height:${rect.height + 8}px`,
    'border:2px solid #f6ad55',
    'border-radius:4px',
    'background:rgba(246,173,85,0.15)',
    'pointer-events:none',
    'z-index:2147483646',
    'transition:opacity 0.15s',
  ].join(';');
  document.documentElement.appendChild(el);
  highlightEl = el;
}

function removeHighlight(): void {
  highlightEl?.remove();
  highlightEl = null;
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
