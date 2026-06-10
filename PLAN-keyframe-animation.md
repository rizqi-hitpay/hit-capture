# Plan: Keyframe Animation System (Motion Editor)

Animate container position, video pan, and zoom over time — like a simple motion editor.

## Steps

- [x] 1. `src/types/index.ts` — add `Keyframe` interface, update `EditorState`, update `EncodeWorkerIn`
- [x] 2. `src/editor/state/defaults.ts` — add `DEFAULT_KEYFRAMES`, `DEFAULT_SELECTED_KEYFRAME_ID`
- [x] 3. `src/editor/utils/keyframeInterpolation.ts` — new pure interpolation utility (`getStateAtTime`)
- [x] 4. `src/editor/state/editorStore.ts` — add `addKeyframe`, `updateKeyframe`, `deleteKeyframe`, `selectKeyframe`
- [x] 5. `src/renderer/sceneRenderer.ts` — add `zoom` param, apply to video scale
- [x] 6. `src/workers/encode.worker.ts` — add `keyframes` to state, interpolate per frame during encode
- [x] 7. `src/editor/components/PreviewCanvas.ts` — use `getStateAtTime` in `drawFrame()`, public accessors
- [x] 8. `src/editor/components/Timeline.ts` — new timeline component (ruler, playhead, KF markers)
- [x] 9. `src/editor/editor.html` — add `#timeline-container` below preview
- [x] 10. `src/editor/editor.css` — timeline styles
- [x] 11. `src/editor/editor.ts` — wire up `Timeline` + connect to `PreviewCanvas`
- [x] 12. `src/editor/components/ControlPanel.ts` — add "Selected Keyframe" section with zoom slider

## Key Concepts

**`Keyframe`** — snapshot of `containerRect + videoCenter + zoom` at a video timestamp. Values are linearly interpolated between keyframes.

**`zoom`** (per keyframe) — content zoom multiplier on the video. `1.0` = normal, `2.0` = 2× magnified. The container clips what's visible.

**Selected keyframe** — canvas shows the selected KF's exact state. Dragging updates the KF. Deselecting resumes live interpolated playback.

**Zero regression** — `getStateAtTime([], t)` returns `null`; callers fall back to existing store values. No keyframes = behaviour identical to today.
