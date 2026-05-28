import { parseCommands } from '../commands/parser';
import type { SwMessage } from '../types';

// ─── Elements ─────────────────────────────────────────────────────────────────

const panelCommand = document.getElementById('panel-command') as HTMLDivElement;
const panelRunning = document.getElementById('panel-running') as HTMLDivElement;
const panelDone    = document.getElementById('panel-done')    as HTMLDivElement;
const panelError   = document.getElementById('panel-error')   as HTMLDivElement;

const historyRow    = document.getElementById('history-row')    as HTMLDivElement;
const historySelect = document.getElementById('history-select') as HTMLSelectElement;
const cmdInput      = document.getElementById('cmd-input')      as HTMLTextAreaElement;
const parseErrors   = document.getElementById('parse-errors')   as HTMLDivElement;
const btnDry        = document.getElementById('btn-dry')        as HTMLButtonElement;
const btnRun        = document.getElementById('btn-run')        as HTMLButtonElement;

const statusDot    = document.getElementById('status-dot')    as HTMLSpanElement;
const statusLabel  = document.getElementById('status-label')  as HTMLSpanElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressText = document.getElementById('progress-text') as HTMLSpanElement;
const stepDesc     = document.getElementById('step-desc')     as HTMLDivElement;
const dryChecklist = document.getElementById('dry-checklist') as HTMLUListElement;
const btnCancel    = document.getElementById('btn-cancel')    as HTMLButtonElement;

const errorMsg = document.getElementById('error-msg') as HTMLDivElement;
const btnBack  = document.getElementById('btn-back')  as HTMLButtonElement;
const btnEditor = document.getElementById('btn-editor') as HTMLButtonElement;

// ─── Command history ──────────────────────────────────────────────────────────

const HISTORY_KEY = 'commandHistory';
const HISTORY_MAX = 5;

async function saveHistory(script: string): Promise<void> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  const prev: string[] = result[HISTORY_KEY] ?? [];
  const updated = [script, ...prev.filter((s) => s !== script)].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ [HISTORY_KEY]: updated });
  await renderHistory(updated);
}

async function loadHistory(): Promise<string[]> {
  const result = await chrome.storage.local.get(HISTORY_KEY);
  return result[HISTORY_KEY] ?? [];
}

async function renderHistory(scripts?: string[]): Promise<void> {
  const list = scripts ?? (await loadHistory());
  if (list.length === 0) { historyRow.hidden = true; return; }
  historyRow.hidden = false;
  // Reset options
  historySelect.innerHTML = '<option value="">— load script —</option>';
  list.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = s.split('\n')[0].slice(0, 40) + (s.length > 40 ? '…' : '');
    historySelect.appendChild(opt);
  });
}

historySelect.addEventListener('change', async () => {
  const idx = parseInt(historySelect.value, 10);
  if (isNaN(idx)) return;
  const list = await loadHistory();
  if (list[idx]) {
    cmdInput.value = list[idx];
    validateInput();
  }
  historySelect.value = '';
});

// ─── Panel helpers ────────────────────────────────────────────────────────────

type Panel = 'command' | 'running' | 'done' | 'error';

function showPanel(name: Panel): void {
  panelCommand.hidden = name !== 'command';
  panelRunning.hidden = name !== 'running';
  panelDone.hidden    = name !== 'done';
  panelError.hidden   = name !== 'error';
}

function setRunningMode(mode: 'record' | 'dry'): void {
  statusDot.className = `status-dot ${mode === 'dry' ? 'status-dry' : 'status-recording'}`;
  dryChecklist.innerHTML = '';
  dryChecklist.hidden = mode !== 'dry';
  stepDesc.hidden = mode === 'dry';
}

function setProgress(step: number, total: number, description: string): void {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${step} / ${total}`;
  stepDesc.textContent = description;
  statusLabel.textContent = `Step ${step} of ${total}`;
}

function addDryChecklistItem(description: string, found: boolean | null): void {
  const li = document.createElement('li');
  const icon = document.createElement('span');
  const label = document.createElement('span');
  if (found === null) {
    icon.className = 'dry-skip'; icon.textContent = '·';
  } else if (found) {
    icon.className = 'dry-ok'; icon.textContent = '✓';
  } else {
    icon.className = 'dry-fail'; icon.textContent = '✗';
  }
  label.textContent = description;
  li.appendChild(icon);
  li.appendChild(label);
  dryChecklist.appendChild(li);
  dryChecklist.scrollTop = dryChecklist.scrollHeight;
}

function showError(message: string): void {
  errorMsg.textContent = message;
  showPanel('error');
}

// ─── Input validation ─────────────────────────────────────────────────────────

function validateInput(): void {
  const text = cmdInput.value.trim();
  if (!text) {
    parseErrors.textContent = '';
    btnRun.disabled = true;
    btnDry.disabled = true;
    return;
  }
  const { errors } = parseCommands(text);
  parseErrors.textContent = errors.map((e) => `Line ${e.line}: ${e.reason}`).join('\n');
  const ok = errors.length === 0;
  btnRun.disabled = !ok;
  btnDry.disabled = !ok;
}

cmdInput.addEventListener('input', validateInput);

// ─── Run & Record ─────────────────────────────────────────────────────────────

btnRun.addEventListener('click', async () => {
  const { commands, errors } = parseCommands(cmdInput.value);
  if (errors.length > 0 || commands.length === 0) return;

  await saveHistory(cmdInput.value.trim());

  showPanel('running');
  setRunningMode('record');
  statusLabel.textContent = 'Starting…';
  setProgress(0, commands.length, 'Preparing…');

  await chrome.runtime.sendMessage({ type: 'RUN_COMMANDS', commands } as SwMessage);
});

// ─── Dry Run ──────────────────────────────────────────────────────────────────

btnDry.addEventListener('click', async () => {
  const { commands, errors } = parseCommands(cmdInput.value);
  if (errors.length > 0 || commands.length === 0) return;

  showPanel('running');
  setRunningMode('dry');
  statusLabel.textContent = 'Dry Run';
  setProgress(0, commands.length, 'Scanning elements…');

  await chrome.runtime.sendMessage({ type: 'RUN_DRY_RUN', commands } as SwMessage);
});

// ─── Cancel ───────────────────────────────────────────────────────────────────

btnCancel.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CANCEL_AUTOMATION' } as SwMessage);
  // Reset dry run state too
  await chrome.storage.session.remove(['dryRunState', 'dryRunStep', 'dryRunTotal', 'dryRunDescription', 'dryRunFound']);
  showPanel('command');
});

btnBack.addEventListener('click', () => showPanel('command'));

btnEditor.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/editor.html') });
  window.close();
});

// ─── Storage listener — react to SW state changes ────────────────────────────

chrome.storage.session.onChanged.addListener((changes) => {
  // Automation state changes
  if ('automationState' in changes) {
    const state = changes['automationState'].newValue as string | undefined;
    if (state === 'running') {
      showPanel('running');
      setRunningMode('record');
    } else if (state === 'done') {
      showPanel('done');
    } else if (state === 'error') {
      const desc = changes['automationDesc']?.newValue as string | undefined;
      showError(desc ?? 'Automation failed. Check the console for details.');
    }
  }

  // Automation progress
  if ('automationStep' in changes || 'automationDesc' in changes) {
    chrome.storage.session.get(
      ['automationStep', 'automationTotal', 'automationDesc'],
      (items) => {
        setProgress(
          (items['automationStep']  as number | undefined) ?? 0,
          (items['automationTotal'] as number | undefined) ?? 0,
          (items['automationDesc']  as string | undefined) ?? '',
        );
      },
    );
  }

  // Dry run steps
  if ('dryRunStep' in changes) {
    const step  = changes['dryRunStep'].newValue as number ?? 0;
    const total = changes['dryRunTotal']?.newValue as number ?? 0;
    const desc  = changes['dryRunDescription']?.newValue as string ?? '';
    const found = changes['dryRunFound']?.newValue as boolean ?? false;
    const pct   = total > 0 ? Math.round((step / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    progressText.textContent = `${step} / ${total}`;
    statusLabel.textContent = `Dry Run — ${step} / ${total}`;
    addDryChecklistItem(desc, found);
  }

  if ('dryRunState' in changes) {
    const state = changes['dryRunState'].newValue as string | undefined;
    if (state === 'done') {
      statusLabel.textContent = 'Dry Run complete';
      progressFill.style.width = '100%';
    }
  }
});

// ─── Init — restore UI if popup reopened mid-run ──────────────────────────────

async function init(): Promise<void> {
  await renderHistory();

  const items = await chrome.storage.session.get([
    'automationState', 'automationStep', 'automationTotal', 'automationDesc',
    'dryRunState',
  ]);

  const autoState = items['automationState'] as string | undefined;
  const dryState  = items['dryRunState']  as string | undefined;

  if (autoState === 'running') {
    showPanel('running');
    setRunningMode('record');
    setProgress(
      (items['automationStep']  as number | undefined) ?? 0,
      (items['automationTotal'] as number | undefined) ?? 0,
      (items['automationDesc']  as string | undefined) ?? '',
    );
  } else if (autoState === 'done') {
    showPanel('done');
  } else if (autoState === 'error') {
    showError((items['automationDesc'] as string | undefined) ?? 'Automation failed.');
  } else if (dryState === 'running') {
    showPanel('running');
    setRunningMode('dry');
    statusLabel.textContent = 'Dry Run';
  } else {
    showPanel('command');
    validateInput();
  }
}

init();
