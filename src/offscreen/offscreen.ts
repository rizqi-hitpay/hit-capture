/**
 * Offscreen Document — runs in a hidden extension page context.
 *
 * Extension pages are NOT subject to the web Permissions Policy restrictions
 * that block content scripts from calling getUserMedia with tab capture IDs.
 *
 * NOTE: chrome.downloads is NOT available in offscreen documents.
 * Instead, stopRecording() returns the video as a data: URL in its response
 * so the service worker (which has chrome.downloads access) can trigger the
 * actual download.
 *
 * Handles:
 *   START_VIDEO { streamId }  → start MediaRecorder on the tab stream
 *   STOP_VIDEO  { filename }  → stop, encode blob, return { ok, dataUrl, filename }
 */

let mediaRecorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let captureStream: MediaStream | null = null;
let mimeType = 'video/webm';

chrome.runtime.onMessage.addListener(
  (
    msg: { type: string; streamId?: string; filename?: string },
    _sender,
    sendResponse: (r: object) => void,
  ) => {
    if (msg.type === 'START_VIDEO') {
      startRecording(msg.streamId!)
        .then(() => sendResponse({ ok: true }))
        .catch((err) => {
          console.error('[Offscreen] START_VIDEO failed:', err);
          sendResponse({ ok: false, error: String(err) });
        });
      return true; // async
    }

    if (msg.type === 'STOP_VIDEO') {
      stopRecording(msg.filename ?? 'screen-recording.mp4')
        .then((dataUrl) => {
          sendResponse({ ok: true, dataUrl, filename: msg.filename });
        })
        .catch((err) => {
          console.error('[Offscreen] STOP_VIDEO failed:', err);
          sendResponse({ ok: false, error: String(err) });
        });
      return true; // async
    }
  },
);

async function startRecording(streamId: string): Promise<void> {
  console.log('[Offscreen] startRecording, streamId:', streamId);
  try {
    captureStream = await (
      navigator.mediaDevices.getUserMedia as (c: object) => Promise<MediaStream>
    )({
      video: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId,
          maxWidth: 1920,
          maxHeight: 1080,
          maxFrameRate: 30,
        },
      },
      audio: false,
    });

    // Prefer WebM/VP9 — most reliable with MediaRecorder in Chrome
    mimeType = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ].find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';

    console.log('[Offscreen] Using mimeType:', mimeType);

    chunks = [];

    mediaRecorder = new MediaRecorder(captureStream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunks.push(e.data);
        console.log('[Offscreen] chunk received, size:', e.data.size);
      }
    };

    mediaRecorder.onerror = (e) => {
      console.error('[Offscreen] MediaRecorder error:', e);
    };

    mediaRecorder.start(500); // flush every 500 ms
    console.log('[Offscreen] Recording started, codec:', mimeType);
  } catch (err) {
    console.error('[Offscreen] Failed to start recording:', err);
    throw err;
  }
}

/**
 * Stop the MediaRecorder and return the video as a data: URL.
 * The caller (service worker) is responsible for triggering the download.
 */
async function stopRecording(filename: string): Promise<string> {
  console.log('[Offscreen] stopRecording, filename:', filename);
  console.log('[Offscreen] mediaRecorder state:', mediaRecorder?.state);
  console.log('[Offscreen] chunks so far:', chunks.length);

  return new Promise((resolve, reject) => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      console.warn('[Offscreen] MediaRecorder inactive or null — nothing to save');
      captureStream?.getTracks().forEach((t) => t.stop());
      captureStream = null;
      reject(new Error('MediaRecorder was not active'));
      return;
    }

    mediaRecorder.onstop = () => {
      (async () => {
        try {
          console.log('[Offscreen] onstop fired, total chunks:', chunks.length);
          const blob = new Blob(chunks, { type: mimeType });
          console.log('[Offscreen] Blob size:', blob.size, 'bytes');

          if (blob.size === 0) {
            throw new Error('Recorded blob is empty — no video data captured');
          }

          // Convert to data URL so the SW can pass it to chrome.downloads
          const dataUrl = await blobToDataUrl(blob);
          console.log('[Offscreen] Data URL ready, length:', dataUrl.length);
          resolve(dataUrl);
        } catch (err) {
          reject(err);
        } finally {
          captureStream?.getTracks().forEach((t) => t.stop());
          captureStream = null;
          mediaRecorder = null;
          chunks = [];
        }
      })();
    };

    mediaRecorder.stop();
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(blob);
  });
}
