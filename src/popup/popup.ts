import { parseCommands } from '../commands/parser';
import type { SwMessage } from '../types';

// ─── Elements ─────────────────────────────────────────────────────────────────

const panelCommand = document.getElementById('panel-command') as HTMLDivElement;
const panelRunning = document.getElementById('panel-running') as HTMLDivElement;
const panelDone    = document.getElementById('panel-done')    as HTMLDivElement;

const cmdInput    = document.getElementById('cmd-input')     as HTMLTextAreaElement;
const parseErrors = document.getElementById('parse-errors')  as HTMLDivElement;
const btnRun      = document.getElementById('btn-run')       as HTMLButtonElement;

const statusDot   = document.getElementById('status-dot')    as HTMLSpanElement;
const statusLabel = document.getElementById('status-label')  as HTMLSpanElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressText = document.getElementById('progress-text') as HTMLSpanElement;
const stepDesc    = document.getElementById('step-desc')     as HTMLDivElement;
const btnCancel   = document.getElementById('btn-cancel')    as HTMLButtonElement;
const btnEditor   = document.getElementById('btn-editor')    as HTMLButtonElement;

// ─── UI helpers ───────────────────────────────────────────────────────────────

function showPanel(name: 'command' | 'running' | 'done'): void {
  panelCommand.hidden = name !== 'command';
  panelRunning.hidden = name !== 'running';
  panelDone.hidden    = name !== 'done';
}

function setProgress(step: number, total: number, description: string): void {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${step} / ${total}`;
  stepDesc.textContent = description;
  statusLabel.textContent = `Step ${step} of ${total}`;
}

// ─── Live parse feedback ───────────────────────────────────────────────────────

cmdInput.addEventListener('input', () => {
  const { errors } = parseCommands(cmdInput.value);
  if (errors.length === 0) {
    parseErrors.textContent = '';
  } else {
    parseErrors.textContent = errors
      .map((e) => `Line ${e.line}: ${e.reason}`)
      .join('\n');
  }
  btnRun.disabled = errors.length > 0 || cmdInput.value.trim() === '';
});

// ─── Run & Record ─────────────────────────────────────────────────────────────

btnRun.addEventListener('click', async () => {
  const { commands, errors } = parseCommands(cmdInput.value);
  if (errors.length > 0 || commands.length === 0) return;

  showPanel('running');
  statusLabel.textContent = 'Starting…';
  setProgress(0, commands.length, 'Preparing…');

  const msg: SwMessage = { type: 'RUN_COMMANDS', commands };
  await chrome.runtime.sendMessage(msg);
});

// ─── Cancel ───────────────────────────────────────────────────────────────────

btnCancel.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CANCEL_AUTOMATION' } as SwMessage);
  showPanel('command');
});

// ─── Open Editor ──────────────────────────────────────────────────────────────

btnEditor.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/editor.html') });
  window.close();
});

// ─── Session storage listener — react to SW state changes ─────────────────────

chrome.storage.session.onChanged.addListener((changes) => {
  if ('automationState' in changes) {
    const state = changes['automationState'].newValue as string | undefined;
    if (state === 'running') {
      showPanel('running');
    } else if (state === 'done') {
      showPanel('done');
    } else if (state === 'error') {
      showPanel('command');
      const desc = changes['automationDesc']?.newValue as string | undefined;
      parseErrors.textContent = desc ?? 'Automation failed.';
    }
  }

  if ('automationStep' in changes || 'automationTotal' in changes || 'automationDesc' in changes) {
    chrome.storage.session.get(
      ['automationStep', 'automationTotal', 'automationDesc'],
      (items) => {
        const step  = (items['automationStep']  as number | undefined) ?? 0;
        const total = (items['automationTotal'] as number | undefined) ?? 0;
        const desc  = (items['automationDesc']  as string | undefined) ?? '';
        setProgress(step, total, desc);
      }
    );
  }
});

// ─── Init — restore state if popup reopened while running ─────────────────────

async function init(): Promise<void> {
  const items = await chrome.storage.session.get([
    'automationState', 'automationStep', 'automationTotal', 'automationDesc',
  ]);
  const state = items['automationState'] as string | undefined;
  if (state === 'running') {
    showPanel('running');
    setProgress(
      (items['automationStep']  as number | undefined) ?? 0,
      (items['automationTotal'] as number | undefined) ?? 0,
      (items['automationDesc']  as string | undefined) ?? '',
    );
  } else if (state === 'done') {
    showPanel('done');
  } else {
    showPanel('command');
    btnRun.disabled = cmdInput.value.trim() === '';
  }
}

init();
