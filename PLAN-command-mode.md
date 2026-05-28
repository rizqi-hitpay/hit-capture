# Plan: Command Mode — Synthetic Cursor from Action List

**Status:** Planning
**Branch:** main (cursor-capture branch = backup of v1)
**Date:** 2026-05-28

---

## Problem with v1 (Cursor Capture)

v1 requires the user to run a live recording session: they must open the tab,
start the extension, perform the demo, stop, then bring the video + JSON into
the editor. The quality of the output depends entirely on how well the real
demo went — if they hesitate, mis-click, or the cursor drifts, those artifacts
stay in the session data.

## New Direction

The user provides only a screen recording. In the editor, they annotate a list
of **commands** (click targets with timestamps) directly on top of the video.
The system **generates** a synthetic cursor track from those commands, runs it
through the existing 7-stage polish pipeline, and composites the polished cursor
onto the video.

Result: cursor movement that is completely intentional, always smooth, always
hits its target — without the user ever having to move a real cursor on screen.

---

## What Stays the Same

| Component | Status |
|---|---|
| 7-stage polish pipeline (`src/pipeline/`) | Unchanged — takes `RawEvent[]`, doesn't care where they come from |
| Scene renderer (`src/renderer/`) | Unchanged |
| Encoder / export (`src/encoder/`, `src/workers/encode.worker.ts`) | Unchanged |
| Editor shell (header, upload zone, control panel, preview canvas, export button) | Mostly unchanged |
| `editorStore.ts` atom + phase machine | Extended, not replaced |

## What Changes / Is New

| Component | Change |
|---|---|
| `UploadZone` | JSON upload removed — only video file needed |
| `CaptureSession` / session JSON | Replaced by `CommandSession` (new type) |
| New: `CommandEditor` component | Timeline + click-to-target UI |
| New: `pathGenerator.ts` | Generates synthetic `RawEvent[]` from command list |
| New: `commandStore.ts` | Reactive state for the command list |
| `editorStore.ts` | Wired to `commandStore` instead of session JSON |

---

## New User Flow

```
1. User uploads screen recording (.mp4 / .webm)
2. Editor loads, shows the video in the preview canvas (no cursor yet)
3. User scrubs to the moment of an action → clicks "Add Command"
4. User clicks directly on the video frame to set the target (X, Y)
5. User labels it: "Click Payment Link"
6. Repeat for each action in the demo
7. User clicks "Generate" → pathGenerator creates RawEvents → pipeline runs
8. Preview shows polished cursor animated between all targets
9. Adjust smoothing / timing sliders → live re-generate
10. Export MP4
```

---

## Architecture

### New Types (`src/types/index.ts`)

```typescript
export type CommandType = 'click' | 'move' | 'scroll-down' | 'scroll-up';

export interface Command {
  id: string;
  type: CommandType;
  /** Target position in VIDEO pixel space (same coords as polishedTrack) */
  x: number;
  y: number;
  /** When this action happens, in ms from video start */
  videoTimestampMs: number;
  /** Optional display label */
  label?: string;
}

export interface CommandSession {
  version: 2;
  commands: Command[];
  /** Video dimensions — needed to compute coordTransform */
  videoWidth: number;
  videoHeight: number;
}
```

### Path Generator (`src/pipeline/pathGenerator.ts`)

Converts a `CommandSession` into `RawEvent[]` that the existing pipeline can consume.

```
For each command[i]:
  - Fill time between command[i-1] and command[i] with move events
    (linear or gentle arc, at 250 Hz to match CAPTURE_HZ)
  - At command[i].videoTimestampMs: emit pointerdown + pointerup at (x, y)

Edge cases:
  - Before first command: hold cursor at first command position
  - After last command: hold cursor at last position until video end
```

The generated `RawEvent[]` is fed into `runPipeline()` exactly as before.
The pipeline smooths the straight-line moves into natural Catmull-Rom curves,
detects dwells, choreographs click overshoots, etc.

### CommandEditor component (`src/editor/components/CommandEditor.ts`)

- Rendered in the left sidebar (replaces or extends `ControlPanel`)
- Shows a scrollable list of commands with timestamp, label, and (x, y)
- **"Add" button**: pauses the video, enters "pick" mode
  - User clicks on the preview canvas to set the target point
  - A crosshair overlay indicates pick mode
  - On click: command is added at the current video timestamp
- Each command row has: timestamp pill, label input, delete button
- "Generate" button triggers `pathGenerator` → `schedulePipeline()`
- Commands are sorted by `videoTimestampMs` automatically

### State Flow

```
CommandEditor                 commandStore                 editorStore
-----------                   ------------                 -----------
User adds command ──────────► setCommands([...]) ────────► (debounced)
User edits timestamp ────────► updateCommand(id, patch)      │
User clicks "Generate" ──────►                         schedulePipeline()
                                                              │
                                                        pathGenerator(commands)
                                                        → RawEvent[]
                                                              │
                                                        pipeline worker
                                                        → PolishedTrack
                                                              │
                                                        phase = 'ready'
                                                        → canvas renders
```

---

## Todo List

### Phase 1 — Core (MVP)

#### Types & Data
- [ ] Add `Command`, `CommandSession` to `src/types/index.ts`
- [ ] Remove `CaptureSession` dependency from the editor flow (keep type for possible future re-import)

#### Path Generator
- [ ] Create `src/pipeline/pathGenerator.ts`
  - [ ] `generateRawEvents(commands, videoWidth, videoHeight): RawEvent[]`
  - [ ] Linear interpolation between command targets at 250 Hz
  - [ ] Inject `pointerdown` + `pointerup` at each command timestamp
  - [ ] Handle edge cases: empty commands, single command, out-of-order (sort first)
- [ ] Unit test path generator with a 3-command sequence

#### Command State
- [ ] Create `src/editor/state/commandStore.ts`
  - [ ] `commands: Command[]` atom
  - [ ] `addCommand(cmd)`, `updateCommand(id, patch)`, `removeCommand(id)`, `clearCommands()`
  - [ ] Auto-sort by `videoTimestampMs` on every mutation
- [ ] Wire `commandStore` changes into `editorStore.schedulePipeline()`
  - [ ] Pass `viewport: { w: videoWidth, h: videoHeight, dpr: 1 }` from `CommandSession`

#### Editor Integration
- [ ] Update `editorStore.tryProcessFiles()`:
  - [ ] Remove session JSON requirement — process on video upload alone
  - [ ] Derive `viewport` from `video.videoWidth / videoHeight` directly
  - [ ] Replace `runPipeline(session.events, ...)` with `runPipeline(generateRawEvents(commands), ...)`
- [ ] Update `UploadZone`: remove JSON upload button / hint

#### CommandEditor Component
- [ ] Create `src/editor/components/CommandEditor.ts`
  - [ ] Renders in sidebar
  - [ ] "Add Command" button → enters pick mode (sets a flag in store)
  - [ ] Click-to-pick overlay on the preview canvas (shows crosshair cursor)
  - [ ] On canvas click: read canvas coordinates → convert to video pixel space → create `Command`
  - [ ] Command list: each row shows timestamp (editable), label (editable), type selector, delete button
  - [ ] "Generate" button → triggers re-run of pipeline
- [ ] Mount `CommandEditor` in `editor.ts` (replace or extend ControlPanel sidebar)

#### Coordinate Mapping
- [ ] When user clicks the preview canvas in pick mode:
  - [ ] Canvas is at `PREVIEW_SCALE` (0.5) of video resolution
  - [ ] Map canvas click `(cx, cy)` → video pixel `(cx / PREVIEW_SCALE, cy / PREVIEW_SCALE)`
  - [ ] Store as `Command.x`, `Command.y`

---

### Phase 2 — Polish & UX

- [ ] **Visual feedback**: Draw the synthetic cursor path on the preview canvas as a dotted line connecting all command targets (so user can see the planned route before generating)
- [ ] **Timestamp sync**: "Use current time" button next to each command → sets `videoTimestampMs` to `video.currentTime * 1000`
- [ ] **Command templates**: pre-built command types (Hover, Scroll Down 300px, Type text)
- [ ] **Timeline view**: horizontal timeline below the scrubber showing command markers at their timestamps — drag to reposition
- [ ] **Import/export**: save the command list as `commands.json` so demos can be re-edited later
- [ ] **Undo/redo**: command history stack
- [ ] **Before/after**: toggle between "no cursor" and "polished cursor" (already exists, keep it)

---

### Phase 3 — Stretch

- [ ] **Smart path**: instead of straight-line interpolation, use a natural arc (offset the midpoint perpendicular to the direction of travel) for more human-like paths
- [ ] **Scroll animation**: render a scroll indicator overlay (not just a cursor move) for scroll commands
- [ ] **Click label overlays**: optionally render the command label as a callout bubble on the video at the moment of the click
- [ ] **OCR-assisted target picking**: user types "Payment Link" and the editor finds the text in the current video frame and suggests coordinates (requires a small OCR library or cloud call)

---

## Open Questions

1. Should we keep the v1 cursor-capture extension as an _alternative_ input mode (upload recording + JSON session) alongside command mode? Or deprecate it entirely?
2. For scroll commands — should the cursor move to a scroll zone and the video content scroll naturally (since the video is pre-recorded), or should we add a scroll indicator overlay?
3. Command label callouts (Phase 3) — HTML overlay on the canvas, or baked into the MP4 export?
