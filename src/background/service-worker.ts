/**
 * Background service worker (MV3)
 *
 * Recording state machine:
 *   idle → starting → recording → stopping → idle
 *
 * Video is recorded in an Offscreen Document (extension page context) so that
 * getUserMedia with chromeMediaSource:'tab' is not blocked by Permissions Policy.
 * Cursor events are captured by the content script as before.
 */
import type {
  RecordingState,
  AutomationState,
  ContentMessage,
  ContentResponse,
  SwMessage,
  ParsedCommand,
} from '../types';

const KEY_STATE        = 'recordingState';
const KEY_TAB          = 'recordingTabId';
const KEY_HAS_VIDEO    = 'recordingHasVideo';
const KEY_AUTO_STATE   = 'automationState';
const KEY_AUTO_STEP    = 'automationStep';
const KEY_AUTO_TOTAL   = 'automationTotal';
const KEY_AUTO_DESC    = 'automationDesc';

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

async function setAutomationState(
  state: AutomationState,
  step = 0,
  total = 0,
  description = '',
): Promise<void> {
  await chrome.storage.session.set({
    [KEY_AUTO_STATE]: state,
    [KEY_AUTO_STEP]: step,
    [KEY_AUTO_TOTAL]: total,
    [KEY_AUTO_DESC]: description,
  });
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

// ─── Content script injection ─────────────────────────────────────────────────

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return;
  } catch { /* not loaded yet */ }

  const manifest = chrome.runtime.getManifest();
  const csFiles: string[] = (manifest as chrome.runtime.Manifest & {
    content_scripts?: Array<{ js?: string[] }>;
  }).content_scripts?.[0]?.js ?? [];

  if (csFiles.length === 0) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: csFiles });
    await sleep(350);
  } catch (err) {
    console.warn('[SW] Could not inject content script (restricted page?):', err);
  }
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
    // Chrome throws if a document already exists — that's fine, ignore it
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('single offscreen document')) throw err;
  }
}

async function closeOffscreenDocument(): Promise<void> {
  try { await chrome.offscreen.closeDocument(); } catch { /* already gone */ }
}

/**
 * Send a message to the offscreen document and wait for its response.
 * Returns the response object, or null if the doc isn't reachable.
 */
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

  await ensureContentScript(tabId);

  // Get stream ID — pass to offscreen doc (not content script)
  const streamId = await getTabCaptureStreamId(tabId);
  console.log('[SW] tabCapture streamId:', streamId);

  // If we have a stream ID, spin up the offscreen document and start video
  if (streamId) {
    await ensureOffscreenDocument();
    const resp = await sendToOffscreen({ type: 'START_VIDEO', streamId });
    console.log('[SW] START_VIDEO response:', resp);
    if (resp && (resp as { ok?: boolean }).ok) {
      await setHasVideo(true);
    }
  } else {
    console.warn('[SW] No stream ID — video recording disabled for this tab');
  }

  // Start cursor capture in the content script (cursor-only, no video)
  const startedAt = new Date().toISOString();
  const msg: ContentMessage = { type: 'START_RECORDING', startedAt };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await chrome.tabs.sendMessage(tabId, msg);
      await setState('recording');
      return;
    } catch (err) {
      lastErr = err;
      await sleep(200);
    }
  }

  // Cursor start failed — clean up video too
  if (await getHasVideo()) {
    await sendToOffscreen({ type: 'STOP_VIDEO', filename: 'screen-recording-aborted.mp4' });
    await closeOffscreenDocument();
    await setHasVideo(false);
  }
  console.error('[SW] Failed to start recording:', lastErr);
  await setState('idle');
  await setTabId(null);
}

async function stopRecording(): Promise<void> {
  const tabId = await getTabId();
  if (tabId === null) { await setState('idle'); return; }

  await setState('stopping');
  const stamp = timestamp();

  // Stop cursor capture → get session JSON
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: 'STOP_RECORDING' } as ContentMessage)) as ContentResponse;

    if (response.type === 'SESSION_DATA') {
      const json = JSON.stringify(response.session, null, 2);
      const url = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
      await chrome.downloads.download({ url, filename: `cursor-session-${stamp}.json`, saveAs: false });
    }
  } catch (err) {
    console.error('[SW] Failed to stop cursor capture:', err);
  }

  // Stop video recording — wait for offscreen doc to finish the download
  // before closing the document (closing it would abort the download).
  const hasVideo = await getHasVideo();
  console.log('[SW] hasVideo:', hasVideo);

  if (hasVideo) {
    // Pass a placeholder filename — we'll override with the correct extension
    // once we know what MIME type the offscreen doc actually recorded.
    const resp = await sendToOffscreen({ type: 'STOP_VIDEO', filename: `screen-recording-${stamp}` }) as
      | { ok: boolean; dataUrl?: string; filename?: string; error?: string }
      | null;
    console.log('[SW] STOP_VIDEO response ok:', resp?.ok, 'dataUrl length:', resp?.dataUrl?.length);

    // The offscreen doc returns the video as a data URL (chrome.downloads is
    // not available there), so we trigger the download from the SW instead.
    if (resp?.ok && resp.dataUrl) {
      try {
        // Derive the correct file extension from the MIME type in the data URL
        // so the saved file matches its actual container format.
        // e.g. "data:video/webm;codecs=vp9;base64,..." → ".webm"
        //      "data:video/mp4;base64,..."              → ".mp4"
        const mimeMatch = resp.dataUrl.match(/^data:([^;,]+)/);
        const mime = mimeMatch?.[1] ?? 'video/webm';
        const ext = mime.includes('mp4') || mime.includes('quicktime') ? 'mp4' : 'webm';
        const videoFilename = `screen-recording-${stamp}.${ext}`;
        console.log('[SW] Saving video as:', videoFilename, '(mime:', mime, ')');

        await chrome.downloads.download({
          url: resp.dataUrl,
          filename: videoFilename,
          saveAs: false,
        });
        console.log('[SW] Video download triggered:', videoFilename);
      } catch (err) {
        console.error('[SW] Video download failed:', err);
      }
    } else if (resp && !resp.ok) {
      console.error('[SW] Offscreen STOP_VIDEO error:', resp.error);
    }
  }

  // Now it is safe to close the offscreen document
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

// ─── Command mode ─────────────────────────────────────────────────────────────

async function runCommandMode(commands: ParsedCommand[]): Promise<void> {
  const state = await getState();
  if (state !== 'idle') return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  const tabId = tab.id;

  await setState('starting');
  await setTabId(tabId);
  await setHasVideo(false);
  await setAutomationState('idle');

  await ensureContentScript(tabId);

  const streamId = await getTabCaptureStreamId(tabId);
  if (streamId) {
    await ensureOffscreenDocument();
    const resp = await sendToOffscreen({ type: 'START_VIDEO', streamId });
    if (resp && (resp as { ok?: boolean }).ok) await setHasVideo(true);
  }

  const startedAt = new Date().toISOString();
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'START_RECORDING', startedAt } as ContentMessage);
  } catch {
    // clean up on failure
    if (await getHasVideo()) {
      await sendToOffscreen({ type: 'STOP_VIDEO', filename: 'aborted' });
      await closeOffscreenDocument();
      await setHasVideo(false);
    }
    await setState('idle');
    await setTabId(null);
    return;
  }

  await setState('recording');
  await setAutomationState('running', 0, commands.length, 'Starting…');

  // Brief delay so the offscreen recorder captures a couple of frames
  // before we start dispatching pointer events.
  await sleep(400);

  try {
    await chrome.tabs.sendMessage(tabId, { type: 'RUN_AUTOMATION', commands } as ContentMessage);
  } catch (err) {
    console.error('[SW] Failed to start automation:', err);
    await stopRecording();
    await setAutomationState('error');
  }
}

async function handleAutomationDone(): Promise<void> {
  await setAutomationState('done');
  await stopRecording();
}

async function handleAutomationError(message: string): Promise<void> {
  console.error('[SW] Automation error:', message);
  await setAutomationState('error', 0, 0, message);
  await stopRecording();
}

async function runDryRunMode(commands: ParsedCommand[]): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  await ensureContentScript(tab.id);
  await chrome.storage.session.set({ dryRunState: 'running', dryRunStep: 0, dryRunTotal: commands.length });
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'RUN_DRY_RUN', commands } as ContentMessage);
  } catch (err) {
    console.error('[SW] Dry run failed:', err);
    await chrome.storage.session.set({ dryRunState: 'error' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-capture') await toggleRecording();
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const msg = message as { type: string; step?: number; total?: number; description?: string; message?: string; commands?: ParsedCommand[]; found?: boolean };

  // ── Content script → SW (unsolicited, sender.tab is set) ──────────────────
  if (sender.tab) {
    if (msg.type === 'AUTOMATION_PROGRESS') {
      chrome.storage.session.set({
        [KEY_AUTO_STEP]: msg.step ?? 0,
        [KEY_AUTO_TOTAL]: msg.total ?? 0,
        [KEY_AUTO_DESC]: msg.description ?? '',
      });
      return;
    }
    if (msg.type === 'AUTOMATION_DONE') {
      handleAutomationDone();
      return;
    }
    if (msg.type === 'AUTOMATION_ERROR') {
      handleAutomationError(msg.message ?? 'Unknown automation error');
      return;
    }
    if (msg.type === 'DRY_RUN_STEP') {
      chrome.storage.session.set({
        dryRunStep: msg.step ?? 0,
        dryRunTotal: msg.total ?? 0,
        dryRunDescription: msg.description ?? '',
        dryRunFound: msg.found ?? false,
      });
      return;
    }
    if (msg.type === 'DRY_RUN_DONE') {
      chrome.storage.session.set({ dryRunState: 'done' });
      return;
    }
    return;
  }

  // ── Popup → SW ─────────────────────────────────────────────────────────────
  if (msg.type === 'TOGGLE_RECORDING') {
    toggleRecording().then(() => sendResponse({ type: 'OK' }));
    return true;
  }
  if (msg.type === 'GET_STATE') {
    getState().then((recordingState) => sendResponse({ type: 'STATE', recordingState }));
    return true;
  }
  if (msg.type === 'RUN_COMMANDS') {
    runCommandMode(msg.commands ?? []).then(() => sendResponse({ type: 'OK' }));
    return true;
  }
  if (msg.type === 'RUN_DRY_RUN') {
    runDryRunMode(msg.commands ?? []).then(() => sendResponse({ type: 'OK' }));
    return true;
  }
  if (msg.type === 'CANCEL_AUTOMATION') {
    stopRecording().then(() => {
      setAutomationState('idle');
      sendResponse({ type: 'OK' });
    });
    return true;
  }
});

// Restore badge on SW restart
getState().then(updateBadge);
// Clear stale automation state
chrome.storage.session.remove([KEY_AUTO_STATE, KEY_AUTO_STEP, KEY_AUTO_TOTAL, KEY_AUTO_DESC]);
