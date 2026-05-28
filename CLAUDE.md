# Cursor Capture — CLAUDE.md

Chrome Extension (Manifest V3) that records tab activity and exports polished marketing videos.
Built with Vite + `@crxjs/vite-plugin`. TypeScript throughout. No UI framework.

---

## Commands

```bash
npm run build       # production build → dist/
npm run dev         # Vite dev server (HMR, load dist/ into Chrome)
npm run typecheck   # tsc --noEmit (no emit, type errors only)
npm run zip         # scripts/zip.mjs → cursor-capture.zip from dist/
```

**After every code change:**
1. `npm run build`
2. `chrome://extensions` → Cursor Capture → click the reload ↺ icon (or Remove + Load unpacked `dist/`)
3. For service worker changes you must also click "Inspect views: service worker" → close that DevTools → reload again

Do NOT use `npm run dev` for testing extension functionality — always use the production `dist/`.

---

## Architecture

```
manifest.json                  MV3 manifest
src/
  background/
    service-worker.ts          Recording state machine (idle→starting→recording→stopping→idle)
                               chrome.storage.session for state: KEY_STATE, KEY_TAB, KEY_HAS_VIDEO
  content/
    content.ts                 Injected into every tab. Captures pointer/scroll events.
                               Double-injection guard: window.__cursorCaptureInit
  offscreen/
    offscreen.ts               Hidden extension page. getUserMedia + MediaRecorder.
    offscreen.html             Loaded via chrome.offscreen.createDocument()
  popup/
    popup.ts / popup.html      Toolbar popup: Start/Stop button + status display
  editor/
    editor.ts                  Entry point. Mounts all components, wires phase transitions.
    editor.html / editor.css   Single-page editor UI
    components/
      UploadZone.ts            Drag-and-drop / file input for video + JSON
      ControlPanel.ts          Sliders for pipeline params + scene config
      PreviewCanvas.ts         RAF render loop. Video attached to DOM (hidden) for reliable play().
      ExportButton.ts          Triggers encode worker, downloads result
      BeforeAfterToggle.ts     Raw vs polished cursor toggle
    state/
      editorStore.ts           Lightweight pub/sub Atom<EditorState>. Single source of truth.
      defaults.ts              DEFAULT_PIPELINE_PARAMS, DEFAULT_SCENE_CONFIG
  pipeline/                   Pure functions. No DOM, no Chrome APIs.
    index.ts                   Orchestrates 7 stages → PolishedTrack
    resample.ts                Stage 1: raw events → 120 Hz uniform timebase
    oneEuroFilter.ts           Stage 2: jitter removal
    splineSmooth.ts            Stage 3: Catmull-Rom spline
    detectDwells.ts            Stage 4: pause detection
    snapClicks.ts              Stage 5: cursor snaps to click targets
    trimHesitations.ts         Stage 6: compress idle gaps
    choreographClicks.ts       Stage 7: overshoot + settle animation
  renderer/
    sceneRenderer.ts           Canvas compositor: gradient → floating window → cursor
                               drawImage uses COVER semantics (center-crop, no black bars)
    gradientPresets.ts         5 presets: dawn | dusk | ocean | forest | slate
    cursorSprite.ts            macOS arrow cursor + click ripple
    zoomController.ts          Auto-zoom keyframes from clicks/dwells
    cameraEasing.ts            lerpCamera, easeInOutCubic
  encoder/
    frameSource.ts             Iterates video frames for the encode pipeline
    webcodecs.ts               VideoEncoder / VideoDecoder wrappers
    mp4Muxer.ts                mp4-muxer wrapper
  workers/
    pipeline.worker.ts         Runs runPipeline() off main thread
    encode.worker.ts           Full encode loop: VideoDecoder → OffscreenCanvas → VideoEncoder → mp4-muxer
  shared/
    constants.ts               Shared numeric constants (Hz, defaults, PREVIEW_SCALE=0.5)
    coords.ts                  identityTransform, computeTransform, transformPoint
  types/
    index.ts                   All shared TypeScript interfaces
    mp4box.d.ts                Type declarations for mp4box.js
```

---

## Key Constraints & Gotchas

### MV3 / Extension context rules
- **Service worker** (`background/service-worker.ts`): No DOM. Terminates when idle — use `chrome.storage.session` for state, not in-memory variables.
- **Content script** (`content/content.ts`): Runs in the web page context. `getUserMedia` with `chromeMediaSource:'tab'` is **blocked** by Permissions Policy — do NOT attempt tab capture here.
- **Offscreen document** (`offscreen/offscreen.ts`): Extension page context. `getUserMedia` with tabCapture works here. **`chrome.downloads` is NOT available** in offscreen documents — return data as a `data:` URL in the `sendResponse` and let the service worker call `chrome.downloads.download()`.
- **`chrome.offscreen.getContexts` does not exist** (Chrome 114 era API removed). Use try/catch on `createDocument` and ignore the "single offscreen document" error.

### Video recording
- `MediaRecorder` in Chrome produces **WebM** (VP8/VP9), not MP4. The saved file must use `.webm` extension.
- The offscreen doc detects the correct MIME/extension from `MediaRecorder.mimeType` and sends it back with the data URL. The SW derives the file extension: `mime.includes('mp4') ? 'mp4' : 'webm'`.
- WebM files from `MediaRecorder` have `duration = Infinity`. Scrubber / `isFinite(duration)` guards are required.

### Canvas rendering
- `ctx.drawImage(videoElement)` **throws `InvalidStateError`** when `video.readyState < 2` (HAVE_CURRENT_DATA). Always guard with `readyState >= 2` before calling `drawImage`.
- If `drawFrame()` throws and the RAF loop is `loop = () => { draw(); raf(loop); }`, the throw kills the loop permanently. Wrap `draw()` in try/catch inside the loop.
- The preview video element **must be attached to the DOM** (even if hidden) for `play()` to work reliably on WebM files. A purely detached element can silently reject `play()`.
- `sceneRenderer.ts` uses **cover semantics**: `scale = Math.max(destW/natW, destH/natH)` then center-crop — eliminates letterbox/pillarbox black bars.

### Editor state machine phases
```
empty → uploading → processing → ready → exporting → ready
```
- `uploading`: at least one file added; editor layout hidden
- `processing`: both files loaded, pipeline worker running; canvas black (loop not yet started)
- `ready`: pipeline done, `polishedTrack` set; RAF loop running
- Changing any pipeline param triggers a debounced re-run (back to `processing`)

### Worker paths
Workers live at `src/workers/`. The `editorStore.ts` is at `src/editor/state/`. Import paths:
```typescript
new URL('../../workers/pipeline.worker.ts', import.meta.url)
new URL('../../workers/encode.worker.ts', import.meta.url)
```

### Build
- `@crxjs/vite-plugin` processes `manifest.json` and injects the correct hashed paths.
- Entry points declared in both `manifest.json` AND `vite.config.ts rollupOptions.input` (for HTML pages the manifest doesn't reference as entry points).
- Output: `dist/` — load this folder directly in Chrome as an unpacked extension.

---

## Data Flow

### Recording
```
User clicks Start
  → SW: getTabCaptureStreamId(tabId) → streamId
  → SW: ensureOffscreenDocument()
  → SW → Offscreen: START_VIDEO { streamId }
     → Offscreen: getUserMedia({ chromeMediaSource:'tab', chromeMediaSourceId:streamId })
     → MediaRecorder.start(500ms chunks)
  → SW → Content: START_RECORDING { startedAt }
     → Content: attaches pointer/scroll listeners, shows REC badge

User clicks Stop
  → SW → Content: STOP_RECORDING → { SESSION_DATA: CaptureSession }
     → SW: chrome.downloads.download(cursor-session-TIMESTAMP.json)
  → SW → Offscreen: STOP_VIDEO { filename }
     → Offscreen: MediaRecorder.stop() → Blob → FileReader → dataUrl
     → SW receives { ok, dataUrl } → chrome.downloads.download(screen-recording-TIMESTAMP.webm)
  → SW: closeOffscreenDocument()
```

### Editor
```
Upload video + JSON
  → editorStore.tryProcessFiles() → video.onloadedmetadata → dimensions
  → computeTransform(session, videoW, videoH) → CoordTransform
  → pipeline worker: runPipeline(events, params) → PolishedTrack
  → PreviewCanvas: RAF loop starts (readyState guard, cover draw)

Export
  → encode worker: VideoDecoder (input file) → OffscreenCanvas → SceneRenderer
                   → VideoEncoder (H.264) → mp4-muxer → ArrayBuffer
  → SW: chrome.downloads.download(polished-demo.mp4)
```

### Message types
| Direction | Type | Payload |
|---|---|---|
| SW → Content | `START_RECORDING` | `{ startedAt: string }` |
| SW → Content | `STOP_RECORDING` | — |
| Content → SW | `SESSION_DATA` | `{ session: CaptureSession }` |
| Content → SW | `ACK` / `ERROR` | — |
| Popup → SW | `TOGGLE_RECORDING` | — |
| Popup → SW | `GET_STATE` | — |
| SW → Offscreen | `START_VIDEO` | `{ streamId: string }` |
| SW → Offscreen | `STOP_VIDEO` | `{ filename: string }` |
| Offscreen → SW | response | `{ ok: boolean, dataUrl?: string, filename?: string }` |

---

## Types (src/types/index.ts)

Key interfaces to know:

```typescript
CaptureSession   // version, startedAt, durationMs, viewport, events[]
RawEvent         // k:'move'|'down'|'up'|'scroll', t, x, y, b?
PolishedTrack    // points[], dwells[], clicks[], totalDurationMs
SceneConfig      // outputWidth, outputHeight, gradient, window, autoZoom, cursorScale
CoordTransform   // scaleX, scaleY, offsetX, offsetY
EditorState      // phase, videoFile, session, pipelineParams, sceneConfig, polishedTrack, ...
RenderFrameData  // videoSource, cursorX, cursorY, isClick, camera, t
GradientPresetId // 'dawn' | 'dusk' | 'ocean' | 'forest' | 'slate'
```

---

## Permissions (manifest.json)

`activeTab, scripting, storage, downloads, tabs, tabCapture, offscreen`  
`host_permissions: ["<all_urls>"]` — needed for programmatic content script injection into pre-existing tabs.

---

## Known Issues / History

- **`chrome.downloads` not available in offscreen documents** — data URL returned to SW for download
- **`chrome.offscreen.getContexts` does not exist** — use try/catch on `createDocument`
- **`ctx.drawImage(video)` throws when `readyState < 2`** — kills RAF loop; guard required
- **WebM saved as `.mp4`** (old bug) — causes MIME mismatch; current code saves with correct `.webm` extension
- **Detached video `play()` rejection** — fixed by attaching video to `document.body` (hidden)
- **Content script connection errors on pre-existing tabs** — fixed by programmatic injection fallback using `chrome.runtime.getManifest().content_scripts[0].js`
