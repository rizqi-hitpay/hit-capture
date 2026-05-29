# PRD — Screen Recorder + Video Editor

**Status:** Planning  
**Date:** 2026-05-29

---

## Overview

A Chrome extension that cleanly records any browser tab and lets the user polish the video in a lightweight built-in editor — gradient backgrounds, crop, and zoom — before saving to disk. No cursor heatmaps, no REC badge, no command automation. Just record → polish → export.

---

## Target Users

- Product managers making feature demo clips
- Developers recording bug reproductions
- Marketers producing quick screen-capture content for social / docs

---

## Phase 1 — Clean Tab Recorder

### Goals
- One-click recording of the active tab with zero visual artefacts in the captured video
- Recorded file saved directly to the user's computer

### Requirements

| # | Requirement |
|---|---|
| R1 | Popup has a single **Start Recording / Stop Recording** toggle button |
| R2 | Recording captures the full visible tab as a video (WebM/VP8) |
| R3 | **No REC badge, no overlay, no indicator injected into the page** |
| R4 | Status is shown only inside the popup (live timer, red dot) |
| R5 | When stopped, the WebM file is auto-downloaded to the user's Downloads folder |
| R6 | Keyboard shortcut `⌘⇧R` / `Ctrl+Shift+R` also toggles recording |
| R7 | Extension icon badge shows "REC" (badge only, not in-page) while recording |

### Out of Scope (Phase 1)
- Cursor event capture
- Any video editing
- Audio capture

---

## Phase 2 — Video Editor

### Goals
- Import the recorded WebM (or any video file) into a built-in editor
- Apply visual polish: background, crop, zoom — then export as MP4

### Requirements

| # | Requirement |
|---|---|
| R8 | Editor page opened via "Open Editor →" button in popup |
| R9 | Drag-and-drop or file picker to load a video file |
| R10 | **Background** — gradient backdrop behind the floating video window (dawn / dusk / ocean / forest / slate presets) with padding and corner radius controls |
| R11 | **Crop** — user draws a rectangle on the preview to define the crop region; applied at export time |
| R12 | **Zoom** — global zoom level slider (0.5× – 3×) that scales the floating video window relative to the background canvas |
| R13 | Real-time preview canvas reflecting all settings at 50% resolution |
| R14 | Export as H.264 MP4 using WebCodecs + mp4-muxer; progress bar during export |
| R15 | Exported file auto-downloaded to Downloads folder |

### Out of Scope (Phase 2)
- Timeline-based zoom keyframes (fixed zoom only)
- Audio track pass-through (silent export)
- Multiple clips / trimming

---

## Success Metrics

| Metric | Target |
|---|---|
| Time from install to first recording saved | < 30 seconds |
| Export time for a 60s clip at 1080p | < 60 seconds |
| Zero in-page visual artefacts during recording | 100% |

