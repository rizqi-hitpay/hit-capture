// Content script stub — no in-page capture or indicators for Phase 1.
// Kept in manifest so Chrome doesn't reject the extension on load.

const WIN = window as Window & { __cursorCaptureInit?: boolean };
if (!WIN.__cursorCaptureInit) {
  WIN.__cursorCaptureInit = true;
}
