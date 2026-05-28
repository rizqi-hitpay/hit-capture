# PRD: Cursor Capture → Polished Marketing Video

**Status:** Draft v0.1
**Author:** [you]
**Last updated:** 2026-05-26

---

## 1. Problem

Marketing demo videos lose their polish the moment a real human cursor enters the frame. Raw cursor movement is laggy, jittery, and full of hesitation — humans doubt, drift, and miss targets by a few pixels. Tools like Screen Studio solve this on macOS desktop, but there is no equivalent that lives inside the browser, captures cursor activity directly from web sessions, and produces a Screen Studio-style polished output without a native install.

The result today: marketers either record-and-hope, manually re-edit cursor paths in After Effects, or pay for a desktop tool that doesn't fit a browser-first workflow.

## 2. Goal

Ship a Chrome extension that captures cursor activity in a browser tab and, in the same extension, produces an exportable marketing video with:

- Smoothed, intentional-looking cursor motion
- Auto-zoom and pan choreography on clicks and dwells
- Floating-window framing on a gradient background, à la Screen Studio
- A swappable style system (gradient + framing presets)

No native install. No companion app. All processing in the browser.

## 3. Non-goals (out of scope)

- Screen recording — user brings their own MP4/WebM
- Audio capture, narration, music
- Multi-monitor or full-desktop capture
- Mobile capture
- Cloud sync, account system, or collaboration
- Editing the underlying screen recording (trimming, splitting, captions)

## 4. Target user & use case

Solo founders, marketers, and developer-advocates who:
- Demo web apps for a living
- Already record their own screen with Loom, QuickTime, OBS, etc.
- Want Screen Studio-quality output for browser content without learning After Effects

Primary use case: a 15–60 second product demo of a web app, posted to landing pages, X, and LinkedIn.

## 5. Solution overview

A Chrome extension (Manifest v3) with two halves:

**Capture half** — a content script records cursor position, clicks, and scrolls with high-resolution timestamps while the user demos. Exports a session as JSON.

**Editor half** — a full-tab extension page where the user drops in their own screen recording plus the session JSON. The editor runs a polish pipeline on the cursor track, applies scene composition (gradient bg, framed window, auto-zoom), and exports an MP4 — all in-browser using Web Workers and WebCodecs.

### Reference style
Output should match the floating-window-on-gradient look exemplified by the reference video (`intro-video.webm`): rounded card framing, soft drop shadow, pastel gradient background, smooth zoom transitions when context expands.

## 6. User flow

1. User installs the extension
2. User opens the tab they want to demo, hits the extension shortcut (Cmd/Ctrl+Shift+R) to start recording cursor activity
3. User performs their demo while separately recording their screen (Loom, QuickTime, etc.)
4. User hits stop — extension exports a `.json` session
5. User opens the extension editor, uploads the screen recording + session JSON
6. Editor shows live preview with default style applied; user adjusts smoothing, picks a gradient/framing preset, toggles auto-zoom
7. User exports MP4

## 7. Functional requirements (v1)

**Capture**
- Records `pointermove`, `pointerdown`, `pointerup`, `scroll` with `performance.now()` timestamps
- Throttled to ~250Hz max on move events
- Captures viewport size and DPR at recording start
- Exports session as JSON
- Start/stop via popup button and keyboard shortcut

**Polish pipeline**
- Resample cursor track to fixed 120Hz internal timebase
- One-Euro filter for tremor removal
- Catmull-Rom spline smoothing through dwell anchors
- Dwell detection (idle < 5px movement for > 150ms)
- Click-target snap (cursor lands exactly on click coords)
- Hesitation trim (idle gaps > 800ms compressed to 200ms; configurable)
- Click choreography (subtle overshoot + settle on each click)

**Scene composition**
- Gradient background, 3–5 presets
- Floating window with rounded corners (16px), drop shadow, configurable padding
- Auto-zoom: detects clicks and significant dwells, eases camera between regions of interest
- Polished cursor rendered on top, always visible

**Editor**
- Drag-and-drop upload for video + session JSON
- Live preview canvas (lower res for performance)
- Controls: smoothing strength, hesitation threshold, auto-zoom on/off + sensitivity, preset picker
- Before/after toggle for cursor track

**Export**
- WebCodecs-based H.264 MP4 encoding
- Output at source video resolution (up to 1080p)
- Progress indicator during export

## 8. Non-functional requirements

- All processing client-side; no server round-trips
- Polish pipeline runs in a Web Worker; UI stays responsive
- Export of a 60-second 1080p video completes in under 3 minutes on a 2022-era MacBook Pro
- Extension bundle under 5MB
- Chrome 121+ (WebCodecs encoder support)

## 9. Success criteria

v1 is done when:

1. A non-technical user can go from "fresh install" to "exported MP4" in under 10 minutes with no documentation beyond a one-page guide
2. Side-by-side, the polished cursor track is visibly smoother than the raw track — confirmed by 5 of 5 test users
3. Output video is indistinguishable in polish from a Screen Studio export when judged by 3 of 5 marketers in a blind comparison
4. Export of a typical 30-second demo completes in under 90 seconds end-to-end on reference hardware
5. Zero crashes across 20 consecutive recording + export sessions

## 10. Key risks & open questions

| Risk | Mitigation |
|---|---|
| Cross-origin iframes block event capture | Document the limitation; works fine for own-domain demos which is the primary use case |
| Coordinate mismatch between page-relative cursor and screen recording | Calibration step in editor: user clicks reference point, or auto-match by viewport size |
| WebCodecs H.264 encoder availability varies | Detect support at startup; fall back to VP9/WebM with user warning |
| MP4 muxing in-browser | Use `mp4-muxer` library (MIT, ~30KB), proven solution |
| Long videos hit memory ceiling | Stream encode frame-by-frame, never hold full decoded video in memory |

Open questions:
- Do we need session encryption at rest in `chrome.storage`? (probably not for v1)
- Should the cursor sprite be customizable in v1 or v2?

## 11. Phased roadmap

### v1 — Foundation (target: 4 weeks)

- Chrome extension with cursor capture
- Polish pipeline (all 7 stages)
- Editor with live preview
- 3–5 gradient/framing presets, hardcoded
- Auto-zoom on by default with sensitivity slider
- MP4 export via WebCodecs

**Goal:** prove the end-to-end pipeline produces Screen Studio-quality output for the primary use case (30-second web demo).

### v2 — Style System (target: +3 weeks after v1)

- Custom gradient builder (pick colors, angle, blur)
- Custom cursor sprites (upload SVG, presets)
- Click effect customization (ripple style, color, size)
- Window framing options (browser chrome mockup, device mockup, perspective tilt)
- Manual zoom keyframes in addition to auto-zoom
- Preset save/load
- Per-scene cursor visibility toggle (hide cursor during certain segments)

**Goal:** let users develop a signature visual identity, not just a Screen Studio clone.

---

## Appendix: reference

- Reference video supplied by user: `intro-video.webm` (25s, 1280×720, floating-window + gradient style)
- Closest commercial analog: Screen Studio (macOS native, ~$229)
- Browser API foundation: Chrome Extensions MV3, WebCodecs, OffscreenCanvas, Web Workers
