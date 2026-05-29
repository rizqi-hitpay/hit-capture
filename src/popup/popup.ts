import type { RecordingState, SwMessage } from '../types';

const btnRecord   = document.getElementById('btn-record')   as HTMLButtonElement;
const statusRow   = document.getElementById('status-row')   as HTMLDivElement;
const statusDot   = document.getElementById('status-dot')   as HTMLSpanElement;
const statusTimer = document.getElementById('status-timer') as HTMLSpanElement;
const btnEditor   = document.getElementById('btn-editor')   as HTMLButtonElement;

let timerInterval: ReturnType<typeof setInterval> | null = null;
let recordingStartMs = 0;

// ─── Timer ────────────────────────────────────────────────────────────────────

function startTimer(): void {
  recordingStartMs = Date.now();
  statusRow.hidden = false;
  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - recordingStartMs) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    statusTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
  }, 1000);
}

function stopTimer(): void {
  if (timerInterval !== null) { clearInterval(timerInterval); timerInterval = null; }
  statusRow.hidden = true;
  statusTimer.textContent = '0:00';
}

// ─── UI state ─────────────────────────────────────────────────────────────────

function applyState(state: RecordingState): void {
  if (state === 'recording') {
    btnRecord.textContent = '■ Stop Recording';
    btnRecord.className = 'btn-record btn-stop';
    btnRecord.disabled = false;
    statusDot.className = 'status-dot recording';
    if (timerInterval === null) startTimer();
  } else if (state === 'starting' || state === 'stopping') {
    btnRecord.textContent = '…';
    btnRecord.className = 'btn-record btn-busy';
    btnRecord.disabled = true;
    statusRow.hidden = false;
    statusDot.className = 'status-dot busy';
  } else {
    btnRecord.textContent = '▶ Start Recording';
    btnRecord.className = 'btn-record btn-start';
    btnRecord.disabled = false;
    stopTimer();
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

btnRecord.addEventListener('click', async () => {
  btnRecord.disabled = true;
  await chrome.runtime.sendMessage({ type: 'TOGGLE_RECORDING' } as SwMessage);
});

btnEditor.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/editor.html') });
  window.close();
});

chrome.storage.session.onChanged.addListener((changes) => {
  if ('recordingState' in changes) {
    applyState((changes['recordingState'].newValue as RecordingState | undefined) ?? 'idle');
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const response = await chrome.runtime.sendMessage({ type: 'GET_STATE' } as SwMessage) as
    { type: 'STATE'; recordingState: RecordingState };
  applyState(response.recordingState);
}

init();
