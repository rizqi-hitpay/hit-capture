/**
 * Background service worker (MV3)
 *
 * Recording state machine:
 *   idle → starting → recording → stopping → idle
 *
 * Video is recorded in an Offscreen Document (extension page context) so that
 * getUserMedia with chromeMediaSource:'tab' is not blocked by Permissions Policy.
 */
import type { RecordingState } from '../types';

const KEY_STATE     = 'recordingState';
const KEY_TAB       = 'recordingTabId';
const KEY_HAS_VIDEO = 'recordingHasVideo';

// ─── State helpers ────────────────────────────────────────────────────────────

async function getState(): Promise<RecordingState> {
  const result = await chrome.storage.session.get(KEY_STATE);
  return (result[KEY_STATE] as RecordingState | undefined) ?? 'idle';
}

async function setState(state: RecordingState): Promise<void> {
  await chrome.storage.session.set({ [KEY_STATE]: state });
  updateBadge(state);
}

async function getTabId(): Promise<number | null> {
  const result = await chrome.storage.session.get(KEY_TAB);
  return (result[KEY_TAB] as number | undefined) ?? null;
}

async function setTabId(id: number | null): Promise<void> {
  if (id === null) await chrome.storage.session.remove(KEY_TAB);
  else             await chrome.storage.session.set({ [KEY_TAB]: id });
}

async function getHasVideo(): Promise<boolean> {
  const result = await chrome.storage.session.get(KEY_HAS_VIDEO);
  return (result[KEY_HAS_VIDEO] as boolean | undefined) ?? false;
}

async function setHasVideo(v: boolean): Promise<void> {
  if (!v) await chrome.storage.session.remove(KEY_HAS_VIDEO);
  else    await chrome.storage.session.set({ [KEY_HAS_VIDEO]: true });
}

// ─── Badge ────────────────────────────────────────────────────────────────────

function updateBadge(state: RecordingState): void {
  if (state === 'recording') {
    chrome.action.setBadgeText({ text: 'REC' });
    chrome.action.setBadgeBackgroundColor({ color: '#e53e3e' });
  } else if (state === 'starting' || state === 'stopping') {
    chrome.action.setBadgeText({ text: '…' });
    chrome.action.setBadgeBackgroundColor({ color: '#dd6b20' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

function timestamp(): string {
  const d = new Date();
  return (
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}` +
    `${String(d.getDate()).padStart(2, '0')}-` +
    `${String(d.getHours()).padStart(2, '0')}` +
    `${String(d.getMinutes()).padStart(2, '0')}`
  );
}

// ─── Offscreen document ───────────────────────────────────────────────────────

const OFFSCREEN_URL = chrome.runtime.getURL('src/offscreen/offscreen.html');

async function ensureOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
      justification: 'Tab video capture via MediaRecorder',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('single offscreen document')) throw err;
  }
}

async function closeOffscreenDocument(): Promise<void> {
  try { await chrome.offscreen.closeDocument(); } catch { /* already gone */ }
}

async function sendToOffscreen(msg: object): Promise<unknown> {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch (err) {
    console.warn('[SW] Offscreen message failed:', err);
    return null;
  }
}

// ─── Tab capture stream ID ────────────────────────────────────────────────────

async function getTabCaptureStreamId(tabId: number): Promise<string | null> {
  try {
    return await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(streamId);
      });
    });
  } catch (err) {
    console.warn('[SW] tabCapture unavailable:', err);
    return null;
  }
}

// ─── Core recording logic ─────────────────────────────────────────────────────

async function startRecording(tabId: number): Promise<void> {
  await setState('starting');
  await setTabId(tabId);
  await setHasVideo(false);

  const streamId = await getTabCaptureStreamId(tabId);
  if (!streamId) {
    console.warn('[SW] No stream ID — cannot record this tab');
    await setState('idle');
    await setTabId(null);
    return;
  }

  await ensureOffscreenDocument();
  const resp = await sendToOffscreen({ type: 'START_VIDEO', streamId });
  if (resp && (resp as { ok?: boolean }).ok) {
    await setHasVideo(true);
    await setState('recording');
  } else {
    console.error('[SW] Offscreen START_VIDEO failed');
    await closeOffscreenDocument();
    await setState('idle');
    await setTabId(null);
  }
}

async function stopRecording(): Promise<void> {
  const tabId = await getTabId();
  if (tabId === null) { await setState('idle'); return; }

  await setState('stopping');
  const stamp = timestamp();

  const hasVideo = await getHasVideo();
  if (hasVideo) {
    const resp = await sendToOffscreen({ type: 'STOP_VIDEO', filename: `screen-recording-${stamp}` }) as
      | { ok: boolean; dataUrl?: string; filename?: string; error?: string }
      | null;

    if (resp?.ok && resp.dataUrl) {
      try {
        const mimeMatch = resp.dataUrl.match(/^data:([^;,]+)/);
        const mime = mimeMatch?.[1] ?? 'video/webm';
        const ext = mime.includes('mp4') || mime.includes('quicktime') ? 'mp4' : 'webm';
        await chrome.downloads.download({
          url: resp.dataUrl,
          filename: `screen-recording-${stamp}.${ext}`,
          saveAs: false,
        });
      } catch (err) {
        console.error('[SW] Video download failed:', err);
      }
    } else if (resp && !resp.ok) {
      console.error('[SW] Offscreen STOP_VIDEO error:', resp.error);
    }
  }

  await closeOffscreenDocument();
  await setHasVideo(false);
  await setState('idle');
  await setTabId(null);
}

async function toggleRecording(): Promise<void> {
  const state = await getState();
  if (state === 'idle') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) await startRecording(tab.id);
  } else if (state === 'recording') {
    await stopRecording();
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-capture') await toggleRecording();
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as { type: string };

  if (msg.type === 'TOGGLE_RECORDING') {
    toggleRecording().then(() => sendResponse({ type: 'OK' }));
    return true;
  }
  if (msg.type === 'GET_STATE') {
    getState().then((recordingState) => sendResponse({ type: 'STATE', recordingState }));
    return true;
  }
});

// Restore badge on SW restart
getState().then(updateBadge);

// Ensure stale recording state is cleared on install/update
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.remove([KEY_STATE, KEY_TAB, KEY_HAS_VIDEO]);
});
