# Plan: Command Mode — Type Commands, Auto-Record Demo

**Status:** Planning
**Branch:** main (cursor-capture branch = backup of v1)
**Date:** 2026-05-28

---

## Vision

The user types a sequence of actions in plain text:

```
click "Payment Links"
click "+ New Payment Link"
type "Summer Sale" in "Link Title"
click "Create"
```

The extension **executes those actions on the live tab**, moves a synthetic
cursor to each target, and **records the screen + cursor path simultaneously**.
The recording goes straight into the polish pipeline and gets exported as a
polished marketing video — no manual cursor work, no after-the-fact annotation.

---

## How It Differs from v1

| | v1 (Cursor Capture) | v2 (Command Mode) |
|---|---|---|
| Cursor data source | Real mouse recorded by user | Synthesised by automation engine |
| Screen recording | User records separately (Loom, etc.) | Extension records automatically |
| User effort | Perform demo live, hope it's clean | Type commands once, replay perfectly every time |
| Repeatability | One-shot | Re-run anytime, always identical |

The polish pipeline, renderer, and encoder are **unchanged** — they still take
`RawEvent[]` and produce a polished MP4. The difference is where those events
come from: synthesised from automation rather than recorded from a real mouse.

---

## Flow

```
1. User opens the extension popup on the target tab
2. User types commands in the command input panel
3. User clicks "Run & Record"
4. Extension starts tab capture (same as v1 offscreen recording)
5. Content script executes each command in sequence:
     a. Find target element by text / selector
     b. Generate smooth cursor path from current position to element centre
     c. Dispatch pointermove events along the path (recorded by content script)
     d. Dwell briefly at the target
     e. Dispatch real click event → page responds naturally
     f. Wait for navigation / animation to settle
6. Recording stops automatically after the last command
7. Editor opens with the video + generated cursor session
8. User adjusts style (gradient, zoom sensitivity) → Export MP4
```

---

## Architecture

### New: Command Parser (`src/commands/parser.ts`)

Parses a plain-text command script into a structured list:

```typescript
interface ParsedCommand {
  type: 'click' | 'type' | 'scroll' | 'wait' | 'hover';
  target?: string;   // text to find on screen, e.g. "Payment Links"
  value?: string;    // for 'type' commands
  ms?: number;       // for 'wait' commands
}
```

Simple line-by-line parser. Supports:
- `click "label"` — find element containing text, click it
- `type "value" in "label"` — find input by label/placeholder, type into it
- `scroll down [N]` / `scroll up [N]` — scroll the page
- `wait [N]ms` — pause between actions
- `hover "label"` — move cursor to element without clicking

### New: Automation Engine (`src/content/automation.ts`)

Injected into the active tab alongside the existing content script.
Receives a `ParsedCommand[]` from the service worker and executes them:

```
For each command:
  1. Find element  →  getElementByText(target)
  2. Get position  →  element.getBoundingClientRect() → centre (x, y)
  3. Generate path →  bezierPath(currentPos, targetPos, durationMs)
  4. Emit moves    →  dispatchPointermove() at 250 Hz along path (recorded by content.ts)
  5. Dwell         →  pause ~200ms at target (triggers dwell detection in pipeline)
  6. Execute       →  element.dispatchEvent(new PointerEvent('pointerdown')) + click()
  7. Wait          →  wait for DOM settle or explicit wait duration
  8. Loop
```

The path between commands is a **cubic Bézier** with a randomised control
point offset — gives a natural arc instead of a mechanical straight line.

### Updated: Content Script (`src/content/content.ts`)

Minor update only: expose a `startAutomation(commands)` message handler that
launches `automation.ts`. The pointer event recording is already in place — no
changes needed to the capture logic.

### Updated: Service Worker (`src/background/service-worker.ts`)

New message type: `RUN_COMMANDS { commands: ParsedCommand[] }`:
1. Calls `getTabCaptureStreamId` and starts offscreen recording (same as v1)
2. Sends `RUN_AUTOMATION` to the content script with the parsed commands
3. Listens for `AUTOMATION_DONE` → calls `STOP_VIDEO` on offscreen
4. Downloads video + session JSON (same as v1)

### Updated: Popup (`src/popup/`)

Replaces the simple Start/Stop button with a command input UI:
- Multi-line `<textarea>` for the command script
- "Run & Record" button
- Status display (idle → running → step N of M → done)
- Command history (last 5 scripts)

### Pipeline & Editor (Unchanged)

The `RawEvent[]` produced by the automation engine feed directly into
`runPipeline()`. The editor, renderer, encoder, and export flow are identical
to v1 — the pipeline doesn't know or care that the events were synthetic.

---

## Component Breakdown

```
src/
  commands/
    parser.ts          Parse plain-text script → ParsedCommand[]
    runner.ts          Execute ParsedCommand[] in the content script context
    elementFinder.ts   Find DOM elements by visible text / role / placeholder
    pathGenerator.ts   Generate Bezier cursor path between two points at 250 Hz
  content/
    content.ts         (updated) add RUN_AUTOMATION message handler
    automation.ts      (new) drives runner.ts, dispatches pointer events
  popup/
    popup.html         (updated) command textarea + Run button
    popup.ts           (updated) parse → send to SW
  background/
    service-worker.ts  (updated) RUN_COMMANDS handler
  pipeline/            (unchanged)
  renderer/            (unchanged)
  encoder/             (unchanged)
  editor/              (unchanged)
```

---

## Todo List

### Phase 1 — Core Pipeline

#### Command Parser
- [ ] `src/commands/parser.ts` — parse `click "X"`, `type "V" in "X"`, `wait Nms`, `scroll down/up`
- [ ] Unit tests for parser edge cases (quoted strings, case insensitivity, blank lines)

#### Element Finder
- [ ] `src/commands/elementFinder.ts`
  - [ ] `findByText(text)` — search visible text in buttons, links, inputs, roles
  - [ ] `findByPlaceholder(text)` — for type commands targeting inputs
  - [ ] Ranking: prefer exact match > partial match; prefer interactive elements
  - [ ] Return `{ element, x, y }` where x/y is the element's visible centre

#### Path Generator
- [ ] `src/commands/pathGenerator.ts`
  - [ ] `cubicBezierPath(from, to, durationMs, hz): RawEvent[]`
  - [ ] Random arc offset for natural-looking curves (not perfectly straight)
  - [ ] Inject dwell events (no movement) at destination before click

#### Automation Runner
- [ ] `src/commands/runner.ts` — async loop over `ParsedCommand[]`
  - [ ] For each `click`: find element → generate path → dispatch pointermoves → dispatch click
  - [ ] For each `type`: find input → click it → dispatch keydown/input/keyup per character
  - [ ] For each `scroll`: dispatch wheel events, emit scroll RawEvents
  - [ ] For each `wait`: setTimeout(ms)
  - [ ] Post `AUTOMATION_PROGRESS { step, total }` back to SW after each command
  - [ ] Post `AUTOMATION_DONE` when finished

#### Content Script Integration
- [ ] Add `RUN_AUTOMATION` message handler to `content.ts`
- [ ] Import and call `runner.ts` from content context
- [ ] Ensure pointer events dispatched by automation are captured by existing recorder

#### Service Worker Integration
- [ ] Add `RUN_COMMANDS` message handler
- [ ] Sequence: start tab capture → send `RUN_AUTOMATION` to content → await `AUTOMATION_DONE` → stop recording
- [ ] Handle errors: element not found → report back, stop recording cleanly

#### Popup UI
- [ ] `popup.html` — replace Start/Stop with command textarea + "Run & Record" button
- [ ] `popup.ts` — on click: parse commands → send `RUN_COMMANDS` to SW
- [ ] Status display: "Step 2/4: clicking '+ New Payment Link'…"
- [ ] Disable button while running; show Cancel option

---

### Phase 2 — Robustness & UX

- [ ] **Wait for navigation**: after a click that triggers page load, wait for `document.readyState === 'complete'` before next step
- [ ] **Wait for element**: if element not found immediately, retry for up to 3 seconds (handles lazy-loaded UI)
- [ ] **Error reporting**: show which command failed and why in the popup
- [ ] **Command history**: save last 5 scripts in `chrome.storage.local`; load from dropdown
- [ ] **Dry run mode**: highlight elements on the page one by one without clicking — lets user verify targets before recording
- [ ] **Scroll tracking**: record scroll position changes in `RawEvent[]` so the pipeline can reflect them in the cursor choreography

---

### Phase 3 — Intelligence

- [ ] **Natural language commands** via Claude API: `"go to the payment links page and create a new one called Summer Sale"` → parsed to structured steps automatically
- [ ] **Auto-wait heuristics**: detect when page is animating (MutationObserver) and wait for DOM to settle between steps
- [ ] **Element screenshot preview**: in popup, show a thumbnail of the found element before running, so user can confirm it's the right one
- [ ] **Script templates**: pre-built scripts for common SaaS flows (create item, edit item, delete item, navigate to settings)

---

## Open Questions

1. **Element finding accuracy**: text-based element search can be ambiguous (two buttons with similar labels). Do we add a `#selector` syntax as a fallback? e.g. `click #new-payment-link-btn`
2. **Scrolling**: when the target element is off-screen, should automation scroll to it first, or fail with a helpful error?
3. **iframes**: HitPay's frontend likely has no cross-origin iframes, but should we document the limitation?
4. **Typing speed**: should `type` commands type at a human-like speed (with delays between keys, visible in the recording), or instantly?
