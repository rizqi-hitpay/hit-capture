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

### 2.2 Update SceneRenderer for crop + zoom ✓
- [x] `render()` accepts `cropRect: CropRect | null` and `zoomLevel: number` (both optional, default null/1.0)
- [x] When `cropRect` set: use x/y/w/h × natW/natH as source rect, stretched to fill window
- [x] When no crop: existing cover-crop algorithm unchanged
- [x] `zoomLevel` scales floating window around center (`winW = baseW * zoomLevel`, centered)
- [x] Cursor draw calls removed (no cursor data in Phase 2)

### 2.3 Rebuild ControlPanel ✓
- [x] **Background** section: gradient preset swatches + padding slider + corner radius slider
- [x] **Crop** section: "Draw crop region" toggle (sets `cropMode`); active crop shows x/y/w/h% + Clear button
- [x] **Zoom** section: range slider 0.5×–3× step 0.05 → `zoomLevel`
- [x] Added `cropMode: boolean` to `EditorState` + `setCropMode` store action
- [x] All controls wired to `editorStore`; `update()` keeps sliders in sync with store

### 2.4 Crop overlay in PreviewCanvas ✓
- [x] Remove all cursor/polishedTrack/ZoomController code; loop starts when `phase === 'ready'`
- [x] Pass `cropRect` and `zoomLevel` from store to `renderer.render()` every frame
- [x] `cropMode` true → canvas cursor `crosshair`; mousedown/move/up drag to draw selection rect
- [x] Drag overlay: dark vignette + clear selection window + orange border + rule-of-thirds guides
- [x] On mouseup: normalise drag to `CropRect` (0–1 fractions of window) → `setCropRect()`; cancels `cropMode`
- [x] When `cropRect` set (no drag): dashed orange border drawn over the live preview
- [x] mouseleave cancels an in-progress drag without committing

### 2.5 Update encode worker ✓
- [x] `START_ENCODE` and `INIT_WEBM_ENCODE` now accept `cropRect` and `zoomLevel` (no track/session/coordTransform)
- [x] Both MP4 and WebM paths call `renderer.render(ctx, frame, sceneConfig, cropRect, zoomLevel)`
- [x] Removed ZoomController, cursor interpolation, transformPoint, getCursorAtTime, pipeline import
- [x] `editorStore` postMessage calls updated; `startMp4Export`/`startWebmExport` simplified to no-arg video

### 2.6 Update EncodeWorkerIn type ✓
- [x] `EncodeWorkerIn` updated: `cropRect: CropRect | null` and `zoomLevel: number` replace `track`, `session`, `coordTransform`

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
