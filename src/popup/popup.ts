import type { RecordingState, SwMessage, SwResponse } from '../types';

const btnRecord = document.getElementById('btn-record') as HTMLButtonElement;
const btnEditor = document.getElementById('btn-editor') as HTMLButtonElement;
const statusDot = document.getElementById('status-dot') as HTMLSpanElement;
const statusLabel = document.getElementById('status-label') as HTMLSpanElement;
const btnLabel = document.getElementById('btn-label') as HTMLSpanElement;

// ─── State rendering ──────────────────────────────────────────────────────────

function render(state: RecordingState): void {
  statusDot.className = `status-dot status-${state}`;
  switch (state) {
    case 'idle':
      statusLabel.textContent = 'Ready';
      btnLabel.textContent = 'Start Recording';
      btnRecord.disabled = false;
      btnRecord.className = 'btn-record btn-start';
      break;
    case 'starting':
      statusLabel.textContent = 'Starting…';
      btnLabel.textContent = 'Starting…';
      btnRecord.disabled = true;
      break;
    case 'recording':
      statusLabel.textContent = 'Recording';
      btnLabel.textContent = 'Stop Recording';
      btnRecord.disabled = false;
      btnRecord.className = 'btn-record btn-stop';
      break;
    case 'stopping':
      statusLabel.textContent = 'Saving…';
      btnLabel.textContent = 'Saving…';
      btnRecord.disabled = true;
      break;
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  const msg: SwMessage = { type: 'GET_STATE' };
  const response = (await chrome.runtime.sendMessage(msg)) as SwResponse;
  if (response.type === 'STATE') render(response.recordingState);

  // Keep UI in sync while popup is open
  chrome.storage.session.onChanged.addListener((changes) => {
    if ('recordingState' in changes) {
      render(changes['recordingState'].newValue as RecordingState);
    }
  });
}

// ─── Button handlers ──────────────────────────────────────────────────────────

btnRecord.addEventListener('click', async () => {
  const msg: SwMessage = { type: 'TOGGLE_RECORDING' };
  await chrome.runtime.sendMessage(msg);
});

btnEditor.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/editor.html') });
  window.close();
});

init();
