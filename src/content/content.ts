/**
 * Content script — cursor/pointer/scroll capture only.
 * Video recording has moved to the Offscreen Document (extension page context)
 * because getUserMedia with chromeMediaSource:'tab' is blocked by Permissions
 * Policy in content script (web page) context.
 */
import type { RawEvent, CaptureSession } from '../types';
import { MOVE_INTERVAL_MS } from '../shared/constants';

// ─── Double-injection guard ───────────────────────────────────────────────────

const WIN = window as Window & { __cursorCaptureInit?: boolean };
if (!WIN.__cursorCaptureInit) {
  WIN.__cursorCaptureInit = true;
  init();
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init(): void {
  let recording = false;
  let startedAt = '';
  let recordingStartTime = 0;
  let rawEvents: RawEvent[] = [];
  let lastMoveAt = 0;

  // ── Indicator ─────────────────────────────────────────────────────────────

  let indicatorHost: HTMLElement | null = null;

  function showIndicator(): void {
    if (indicatorHost) return;
    indicatorHost = document.createElement('div');
    indicatorHost.id = '__cursor-capture-host__';
    indicatorHost.style.cssText =
      'position:fixed;top:16px;right:16px;z-index:2147483647;pointer-events:none;';

    const shadow = indicatorHost.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        .badge {
          display:flex;align-items:center;gap:6px;
          background:rgba(0,0,0,.8);color:#fff;
          font:600 11px/1 system-ui,sans-serif;
          padding:5px 10px;border-radius:20px;
          backdrop-filter:blur(6px);
        }
        .dot {
          width:8px;height:8px;border-radius:50%;background:#e53e3e;
          animation:pulse 1.2s ease-in-out infinite;
        }
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
      </style>
      <div class="badge"><div class="dot"></div>🎬 REC</div>
    `;
    document.documentElement.appendChild(indicatorHost);
  }

  function hideIndicator(): void {
    indicatorHost?.remove();
    indicatorHost = null;
  }

  // ── Cursor capture ─────────────────────────────────────────────────────────

  function onPointerMove(e: PointerEvent): void {
    if (!recording) return;
    const now = performance.now();
    if (now - lastMoveAt < MOVE_INTERVAL_MS) return;
    lastMoveAt = now;
    rawEvents.push({ k: 'move', t: now - recordingStartTime, x: e.clientX, y: e.clientY });
  }

  function onPointerDown(e: PointerEvent): void {
    if (!recording) return;
    rawEvents.push({ k: 'down', t: performance.now() - recordingStartTime, x: e.clientX, y: e.clientY, b: e.button });
  }

  function onPointerUp(e: PointerEvent): void {
    if (!recording) return;
    rawEvents.push({ k: 'up', t: performance.now() - recordingStartTime, x: e.clientX, y: e.clientY, b: e.button });
  }

  function onScroll(): void {
    if (!recording) return;
    rawEvents.push({ k: 'scroll', t: performance.now() - recordingStartTime, x: window.scrollX, y: window.scrollY });
  }

  function attachListeners(): void {
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    document.addEventListener('pointerup', onPointerUp, { passive: true });
    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
  }

  function detachListeners(): void {
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('scroll', onScroll, true);
  }

  function buildSession(durationMs: number): CaptureSession {
    return {
      version: 1,
      startedAt,
      durationMs,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      events: [...rawEvents],
    };
  }

  // ── Message handler ────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (r: unknown) => void) => {
      const msg = message as { type: string; startedAt?: string };

      if (msg.type === 'PING') {
        sendResponse({ type: 'PONG' });
        return;
      }

      if (msg.type === 'START_RECORDING') {
        if (recording) { sendResponse({ type: 'ERROR', message: 'Already recording' }); return; }
        recording = true;
        startedAt = msg.startedAt ?? new Date().toISOString();
        recordingStartTime = performance.now();
        rawEvents = [];
        lastMoveAt = 0;
        attachListeners();
        showIndicator();
        sendResponse({ type: 'ACK' });
        return;
      }

      if (msg.type === 'STOP_RECORDING') {
        if (!recording) { sendResponse({ type: 'ERROR', message: 'Not recording' }); return; }
        recording = false;
        detachListeners();
        hideIndicator();
        const durationMs = performance.now() - recordingStartTime;
        sendResponse({ type: 'SESSION_DATA', session: buildSession(durationMs) });
      }
    }
  );
}
