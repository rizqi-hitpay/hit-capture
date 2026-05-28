import { parseCommands } from '../commands/parser';
import type { SwMessage } from '../types';

// ─── Templates ────────────────────────────────────────────────────────────────

const TEMPLATES: Array<{ label: string; script: string }> = [
  { label: 'Create new item',      script: 'click "+ New"\ntype "Untitled" in "Name"\nclick "Create"' },
  { label: 'Edit & save',          script: 'click "Edit"\ntype "Updated value" in "Name"\nclick "Save"' },
  { label: 'Open settings',        script: 'click "Settings"' },
  { label: 'Delete with confirm',  script: 'click "Delete"\nwait 300ms\nclick "Confirm"' },
  { label: 'Scroll & click',       script: 'scroll down 400\nwait 300ms\nclick "Load more"' },
];

// ─── Elements ─────────────────────────────────────────────────────────────────

const btnSettings  = document.getElementById('btn-settings')     as HTMLButtonElement;
const panelSett    = document.getElementById('panel-settings')   as HTMLDivElement;
const apiKeyInput  = document.getElementById('api-key-input')    as HTMLInputElement;
const btnSaveKey   = document.getElementById('btn-save-key')     as HTMLButtonElement;

const panelCommand = document.getElementById('panel-command')    as HTMLDivElement;
const panelRunning = document.getElementById('panel-running')    as HTMLDivElement;
const panelDone    = document.getElementById('panel-done')       as HTMLDivElement;
const panelError   = document.getElementById('panel-error')      as HTMLDivElement;

const historyRow    = document.getElementById('history-row')     as HTMLDivElement;
const historySelect = document.getElementById('history-select')  as HTMLSelectElement;
const aiRow         = document.getElementById('ai-row')          as HTMLDivElement;
const nlInput       = document.getElementById('nl-input')        as HTMLInputElement;
const btnConvert    = document.getElementById('btn-convert')     as HTMLButtonElement;
const templateSel   = document.getElementById('template-select') as HTMLSelectElement;
const cmdInput      = document.getElementById('cmd-input')       as HTMLTextAreaElement;
const parseErrors   = document.getElementById('parse-errors')    as HTMLDivElement;
const btnDry        = document.getElementById('btn-dry')         as HTMLButtonElement;
const btnRun        = document.getElementById('btn-run')         as HTMLButtonElement;

const statusDot      = document.getElementById('status-dot')       as HTMLSpanElement;
const statusLabel    = document.getElementById('status-label')     as HTMLSpanElement;
const progressFill   = document.getElementById('progress-fill')    as HTMLDivElement;
const progressText   = document.getElementById('progress-text')    as HTMLSpanElement;
const stepDesc       = document.getElementById('step-desc')        as HTMLDivElement;
const screenshotWrap = document.getElementById('screenshot-wrap')  as HTMLDivElement;
const screenshotCvs  = document.getElementById('screenshot-canvas') as HTMLCanvasElement;
const dryChecklist   = document.getElementById('dry-checklist')    as HTMLUListElement;
const btnCancel      = document.getElementById('btn-cancel')       as HTMLButtonElement;

const errorMsg  = document.getElementById('error-msg')  as HTMLDivElement;
const btnBack   = document.getElementById('btn-back')   as HTMLButtonElement;
const btnEditor = document.getElementById('btn-editor') as HTMLButtonElement;

// ─── Settings ─────────────────────────────────────────────────────────────────

const API_KEY_STORE = 'claudeApiKey';

btnSettings.addEventListener('click', () => {
  const open = !panelSett.hidden;
  panelSett.hidden = open;
  btnSettings.classList.toggle('active', !open);
});

btnSaveKey.addEventListener('click', async () => {
  const key = apiKeyInput.value.trim();
  await chrome.storage.local.set({ [API_KEY_STORE]: key });
  aiRow.hidden = !key;
  panelSett.hidden = true;
  btnSettings.classList.remove('active');
});

// ─── Templates ────────────────────────────────────────────────────────────────

TEMPLATES.forEach(({ label, script }) => {
  const opt = document.createElement('option');
  opt.value = script;
  opt.textContent = label;
  templateSel.appendChild(opt);
});

templateSel.addEventListener('change', () => {
  if (!templateSel.value) return;
  cmdInput.value = templateSel.value;
  templateSel.value = '';
  validateInput();
});

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

async function renderHistory(scripts?: string[]): Promise<void> {
  const list = scripts ?? ((await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] ?? []) as string[];
  if (list.length === 0) { historyRow.hidden = true; return; }
  historyRow.hidden = false;
  historySelect.innerHTML = '<option value="">— load script —</option>';
  list.forEach((s, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = s.split('\n')[0].slice(0, 38) + (s.length > 38 ? '…' : '');
    historySelect.appendChild(opt);
  });
}

historySelect.addEventListener('change', async () => {
  const idx = parseInt(historySelect.value, 10);
  if (isNaN(idx)) return;
  const list = ((await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] ?? []) as string[];
  if (list[idx]) { cmdInput.value = list[idx]; validateInput(); }
  historySelect.value = '';
});

// ─── AI conversion ────────────────────────────────────────────────────────────

btnConvert.addEventListener('click', async () => {
  const text = nlInput.value.trim();
  if (!text) return;
  btnConvert.disabled = true;
  btnConvert.textContent = '…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'NL_TO_COMMANDS', text } as SwMessage) as
      | { type: 'OK'; commands: string }
      | { type: 'ERROR'; message: string };
    if (response.type === 'OK') {
      cmdInput.value = response.commands;
      nlInput.value = '';
      validateInput();
    } else {
      parseErrors.textContent = response.message;
    }
  } catch (err) {
    parseErrors.textContent = err instanceof Error ? err.message : String(err);
  } finally {
    btnConvert.disabled = false;
    btnConvert.textContent = '✨';
  }
});

nlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); btnConvert.click(); }
});

// ─── Panel helpers ────────────────────────────────────────────────────────────

type Panel = 'command' | 'running' | 'done' | 'error';

function showPanel(name: Panel): void {
  panelCommand.hidden = name !== 'command';
  panelRunning.hidden = name !== 'running';
  panelDone.hidden    = name !== 'done';
  panelError.hidden   = name !== 'error';
  if (name !== 'running') screenshotWrap.hidden = true;
}

function setRunningMode(mode: 'record' | 'dry'): void {
  statusDot.className = `status-dot ${mode === 'dry' ? 'status-dry' : 'status-recording'}`;
  dryChecklist.innerHTML = '';
  dryChecklist.hidden    = mode !== 'dry';
  stepDesc.hidden        = mode === 'dry';
  screenshotWrap.hidden  = true;
}

function setProgress(step: number, total: number, description: string): void {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${step} / ${total}`;
  stepDesc.textContent = description;
  statusLabel.textContent = `Step ${step} of ${total}`;
}

function addDryItem(description: string, found: boolean | null): void {
  const li = document.createElement('li');
  const icon = document.createElement('span');
  const label = document.createElement('span');
  icon.className = found === null ? 'dry-skip' : found ? 'dry-ok' : 'dry-fail';
  icon.textContent = found === null ? '·' : found ? '✓' : '✗';
  label.textContent = description;
  li.appendChild(icon);
  li.appendChild(label);
  dryChecklist.appendChild(li);
  dryChecklist.scrollTop = dryChecklist.scrollHeight;
}

// ─── Phase 3: screenshot rendering ───────────────────────────────────────────

interface ScreenshotPayload {
  dataUrl: string;
  rect: { x: number; y: number; w: number; h: number; dpr: number };
}

async function renderScreenshot(payload: ScreenshotPayload): Promise<void> {
  const { dataUrl, rect } = payload;
  const img = new Image();
  img.src = dataUrl;
  await new Promise<void>((res) => { img.onload = () => res(); });

  const MARGIN = 24;
  const PREVIEW_W = 272;
  const dpr = rect.dpr || 1;

  // Source region in physical pixels (screenshot is captured at device pixel ratio)
  const srcX = Math.max(0, (rect.x - MARGIN) * dpr);
  const srcY = Math.max(0, (rect.y - MARGIN) * dpr);
  const srcW = (rect.w + MARGIN * 2) * dpr;
  const srcH = (rect.h + MARGIN * 2) * dpr;

  const scale = PREVIEW_W / srcW;
  const PREVIEW_H = Math.round(srcH * scale);

  screenshotCvs.width  = PREVIEW_W;
  screenshotCvs.height = PREVIEW_H;

  const ctx = screenshotCvs.getContext('2d')!;
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, PREVIEW_W, PREVIEW_H);

  // Draw element highlight rect
  ctx.strokeStyle = '#f6ad55';
  ctx.lineWidth = 2;
  ctx.strokeRect(MARGIN * scale, MARGIN * scale, rect.w * dpr * scale, rect.h * dpr * scale);

  screenshotWrap.hidden = false;
}

// ─── Input validation ─────────────────────────────────────────────────────────

function validateInput(): void {
  const text = cmdInput.value.trim();
  if (!text) { parseErrors.textContent = ''; btnRun.disabled = true; btnDry.disabled = true; return; }
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
  await chrome.storage.session.remove(['dryRunState', 'dryRunStep', 'dryRunTotal', 'dryRunDescription', 'dryRunFound', 'dryRunScreenshotReady']);
  showPanel('command');
});

btnBack.addEventListener('click', () => showPanel('command'));

btnEditor.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/editor/editor.html') });
  window.close();
});

// ─── Storage listener ─────────────────────────────────────────────────────────

chrome.storage.session.onChanged.addListener((changes) => {
  if ('automationState' in changes) {
    const state = changes['automationState'].newValue as string | undefined;
    if (state === 'running') { showPanel('running'); setRunningMode('record'); }
    else if (state === 'done') { showPanel('done'); }
    else if (state === 'error') {
      showPanel('error');
      errorMsg.textContent = (changes['automationDesc']?.newValue as string | undefined) ?? 'Automation failed.';
    }
  }

  if ('automationStep' in changes || 'automationDesc' in changes) {
    chrome.storage.session.get(['automationStep', 'automationTotal', 'automationDesc'], (items) => {
      setProgress(
        (items['automationStep']  as number | undefined) ?? 0,
        (items['automationTotal'] as number | undefined) ?? 0,
        (items['automationDesc']  as string | undefined) ?? '',
      );
    });
  }

  if ('dryRunStep' in changes) {
    const step  = changes['dryRunStep'].newValue as number ?? 0;
    const total = changes['dryRunTotal']?.newValue as number ?? 0;
    const desc  = changes['dryRunDescription']?.newValue as string ?? '';
    const found = changes['dryRunFound']?.newValue as boolean ?? false;
    progressFill.style.width = `${total > 0 ? Math.round((step / total) * 100) : 0}%`;
    progressText.textContent = `${step} / ${total}`;
    statusLabel.textContent  = `Dry Run — ${step} / ${total}`;
    addDryItem(desc, found);
  }

  if ('dryRunState' in changes && changes['dryRunState'].newValue === 'done') {
    statusLabel.textContent = 'Dry Run complete';
    progressFill.style.width = '100%';
  }

  // Phase 3: screenshot ready
  if ('dryRunScreenshotReady' in changes) {
    chrome.runtime.sendMessage({ type: 'GET_DRY_RUN_SCREENSHOT' } as SwMessage)
      .then((payload) => { if (payload) renderScreenshot(payload as ScreenshotPayload); })
      .catch(() => {});
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init(): Promise<void> {
  // Restore API key + show AI row if configured
  const local = await chrome.storage.local.get([API_KEY_STORE, 'commandHistory']);
  const apiKey = local[API_KEY_STORE] as string | undefined;
  if (apiKey) { apiKeyInput.value = apiKey; aiRow.hidden = false; }
  await renderHistory(local['commandHistory'] ?? []);

  // Populate templates
  const items = await chrome.storage.session.get([
    'automationState', 'automationStep', 'automationTotal', 'automationDesc',
    'dryRunState',
  ]);

  const autoState = items['automationState'] as string | undefined;
  const dryState  = items['dryRunState']     as string | undefined;

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
    showPanel('error');
    errorMsg.textContent = (items['automationDesc'] as string | undefined) ?? 'Automation failed.';
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
