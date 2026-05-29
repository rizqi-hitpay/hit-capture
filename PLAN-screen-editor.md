# PLAN — Screen Recorder + Video Editor

**Status:** Planning  
**Date:** 2026-05-29

---

## Reuse Analysis

### Keep (no change needed)
- `src/offscreen/offscreen.ts + offscreen.html` — MediaRecorder tab capture already works
- `src/renderer/sceneRenderer.ts` — gradient + floating window compositor
- `src/renderer/gradientPresets.ts` — 5 gradient presets
- `src/renderer/cursorSprite.ts` — reuse canvas drawing helpers (or exclude cursor draw calls)
- `src/encoder/webcodecs.ts` — VideoEncoder/VideoDecoder wrappers
- `src/encoder/mp4Muxer.ts` — mp4-muxer wrapper
- `src/workers/encode.worker.ts` — full encode pipeline (strip cursor overlay calls)
- `src/types/index.ts` — keep most types; remove command-mode types
- `src/shared/constants.ts`, `src/shared/coords.ts`

### Remove / Gut
- `src/content/content.ts` — delete all event capture; keep only an empty stub (required by manifest until we remove it entirely in Phase 2)
- `src/commands/` — entire directory, not needed
- `src/background/claude.ts` — not needed
- `src/pipeline/` — cursor smoothing pipeline not needed
- `src/workers/pipeline.worker.ts` — not needed
- All command-mode popup code, templates, history, AI row

### Simplify
- `src/background/service-worker.ts` — reduce to: toggle recording, badge, session state
- `src/popup/popup.ts + popup.html + popup.css` — single button + status timer
- `src/editor/` — rebuild around crop + zoom + background, no cursor pipeline

---

## Architecture (Target)

```
manifest.json
src/
  background/
    service-worker.ts     Minimal: toggle → getTabCaptureStreamId → offscreen
  offscreen/
    offscreen.ts          MediaRecorder (unchanged)
    offscreen.html
  popup/
    popup.ts              Start/Stop button, live timer, Open Editor link
    popup.html
    popup.css
  editor/
    editor.html
    editor.css
    editor.ts             Mounts components, wires phase transitions
    components/
      UploadZone.ts       Video file drop/pick
      ControlPanel.ts     Background, crop, zoom controls
      PreviewCanvas.ts    RAF loop — SceneRenderer + crop overlay
      ExportButton.ts     Triggers encode worker
    state/
      editorStore.ts      Atom<EditorState> pub/sub
      defaults.ts
  renderer/
    sceneRenderer.ts      (reused, cursor draw calls removed or skipped)
    gradientPresets.ts    (reused)
    cursorSprite.ts       (optional — remove if not drawing cursor)
  encoder/
    webcodecs.ts          (reused)
    mp4Muxer.ts           (reused)
    frameSource.ts        (reused)
  workers/
    encode.worker.ts      Strip cursor + pipeline calls; add crop transform
  shared/
    constants.ts
    coords.ts
  types/
    index.ts              Remove command-mode types; add CropRect
```

---

## Phase 1 Todo List — Clean Recorder

### 1.1 Strip content script artefacts ✓
- [x] Open `src/content/content.ts`
- [x] Remove the REC badge injection (`__badge` element, all badge styles, `showBadge` / `hideBadge` calls)
- [x] Remove all pointer/scroll event listeners and `rawEvents` array
- [x] Keep the file but leave it as a no-op stub (manifest still references it; remove entirely later)

### 1.2 Simplify service worker ✓
- [x] Open `src/background/service-worker.ts`
- [x] Remove: command mode handlers (`RUN_COMMANDS`, `RUN_DRY_RUN`, `CANCEL_AUTOMATION`, `NL_TO_COMMANDS`, `GET_DRY_RUN_SCREENSHOT`)
- [x] Remove: automation state keys, `screenshotCache`, `runCommandMode`, `runDryRunMode`, `setAutomationState`
- [x] Remove: import of `convertNaturalLanguage` / `claude.ts`
- [x] Keep: `TOGGLE_RECORDING`, `GET_STATE`, recording state machine, badge update, offscreen document lifecycle
- [x] Keep: `STOP_RECORDING` → `SESSION_DATA` handler (we'll download WebM but skip the JSON session download)
- [x] Update stop flow: download WebM only (no JSON session file)

### 1.3 Rebuild popup ✓
- [x] Replace `src/popup/popup.html` with minimal layout:
  - Header: logo + title + settings gear
  - Single large **Start Recording** / **Stop Recording** button
  - Status row: red dot + live timer (counts up while recording)
  - "Open Editor →" footer button
- [x] Replace `src/popup/popup.ts`:
  - On load: `GET_STATE` → set button text/state
  - Button click: `TOGGLE_RECORDING`
  - Live timer: `setInterval` updating a `<span>` every second while `recordingState === 'recording'`
  - Listen to `chrome.storage.session` changes for `KEY_STATE` to sync UI
  - "Open Editor" → `chrome.tabs.create` to editor page
- [x] Replace `src/popup/popup.css` with clean minimal styles (no command-mode panels)

### 1.4 Remove unused code ✓
- [x] Delete `src/commands/` directory
- [x] Delete `src/background/claude.ts`
- [x] Delete `src/pipeline/` directory
- [x] Delete `src/workers/pipeline.worker.ts`
- [x] Remove pipeline worker entry from `vite.config.ts` and any rollupOptions input
- [x] Remove pipeline worker reference from `editorStore.ts` (also removed `setSession`, simplified `UploadZone` to video-only)

### 1.5 Verify build + manual test ✓
- [x] `npm run typecheck` — zero errors
- [x] `npm run build` — 26 modules, no pipeline worker in output
- [ ] Load `dist/` in Chrome → start recording → stop → verify WebM downloaded with no in-page badge

---

## Phase 2 Todo List — Video Editor

### 2.1 Add CropRect type ✓
- [x] In `src/types/index.ts` add `CropRect` interface (x, y, w, h as 0–1 fractions)
- [x] Add `cropRect: CropRect | null` and `zoomLevel: number` to `EditorState`
- [x] Add `DEFAULT_CROP_RECT = null` and `DEFAULT_ZOOM_LEVEL = 1.0` to `defaults.ts`
- [x] Wire into `editorStore` initial state; export `setCropRect` and `setZoomLevel` actions

### 2.2 Update SceneRenderer for crop + zoom
- [ ] Open `src/renderer/sceneRenderer.ts`
- [ ] Accept `cropRect: CropRect | null` and `zoomLevel: number` in `drawFrame()`
- [ ] When `cropRect` is set, use it as the `sx, sy, sw, sh` source region in `drawImage`
- [ ] Apply `zoomLevel` by scaling the floating window rect before drawing
- [ ] Remove cursor draw calls (or make them conditional on a flag)

### 2.3 Rebuild ControlPanel
- [ ] Replace `src/editor/components/ControlPanel.ts` with three sections:
  - **Background**: gradient preset swatches + padding slider + corner radius slider
  - **Crop**: "Draw crop region" toggle button (activates overlay mode on canvas)
  - **Zoom**: single `<input type="range" min="0.5" max="3" step="0.05">` → `zoomLevel`
- [ ] Wire all controls to `editorStore`

### 2.4 Crop overlay in PreviewCanvas
- [ ] Open `src/editor/components/PreviewCanvas.ts`
- [ ] Add `cropMode: boolean` state
- [ ] When `cropMode` is true: overlay a semi-transparent dark layer on the canvas; let user drag to define a rectangle; on mouse-up commit `CropRect` (normalized 0–1) to `editorStore`
- [ ] Draw dashed orange border showing current `cropRect` during normal preview
- [ ] "Clear crop" button sets `cropRect: null`

### 2.5 Update encode worker
- [ ] Open `src/workers/encode.worker.ts`
- [ ] Accept `cropRect` and `zoomLevel` in `INIT_WEBM_ENCODE` / `START_ENCODE` message
- [ ] Pass them through to `SceneRenderer.drawFrame()` so every exported frame honours the crop/zoom
- [ ] Remove cursor / polishedTrack rendering (replace with simple video-only render)
- [ ] Remove pipeline import

### 2.6 Update EncodeWorkerIn type
- [ ] In `src/types/index.ts`, update `EncodeWorkerIn` to include `cropRect: CropRect | null` and `zoomLevel: number`
- [ ] Remove `track: PolishedTrack` (no cursor track needed)

### 2.7 Simplify editor entry + upload zone
- [ ] `src/editor/editor.ts`: remove pipeline worker launch, remove `polishedTrack` handling
- [ ] `src/editor/components/UploadZone.ts`: accept video only (no JSON session file required)
- [ ] Phase transitions: `empty → uploading → ready → exporting → ready`

### 2.8 Verify build + manual test
- [ ] `npm run typecheck` — zero errors
- [ ] `npm run build`
- [ ] Load video in editor → change gradient → draw crop region → adjust zoom → export → verify MP4 plays with correct crop/zoom/background

---

## Open Questions

- **Audio**: Keep audio track from recorded WebM in export? (currently silent export — revisit if users request)
- **Content script**: Remove from manifest entirely in Phase 2 once we confirm no other feature needs it
- **Output resolution**: Currently hardcoded 1920×1080 in `SceneConfig`. Should the editor expose an output size picker? (defer to later)
