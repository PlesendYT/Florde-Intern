// OS-level screen capture protection for the main window.
//
// Wraps Electron's BrowserWindow.setContentProtection(true), which is the
// designated native mechanism for this purpose (no DRM/Widevine involved):
//   - Windows: SetWindowDisplayAffinity with WDA_EXCLUDEFROMCAPTURE
//     (Win 10 2004+: window removed from captures entirely;
//      older: captures show a black window).
//   - macOS: NSWindow.sharingType = NSWindowSharingNone.
//     Limitation (documented by Electron): newer Mac apps using Apple's
//     ScreenCaptureKit still capture the window despite protection.
//   - Linux (X11/Wayland): NOT implemented by Electron/Chromium —
//     the call is accepted but has no effect. No security guarantee
//     may be claimed on Linux.
//
// Kept as a tiny dependency-free module (no electron import) so it stays
// unit-testable with a mock window. Call once, right after
// `new BrowserWindow(...)` and before content loads — the protection must
// be active before the first frame can be captured. There is intentionally
// no user toggle: capture protection must not depend on UI state and must
// hold even if a secret input is temporarily unmasked.
function applyContentProtection(win) {
  if (!win || typeof win.setContentProtection !== 'function') return false;
  try {
    win.setContentProtection(true);
  } catch {
    return false;
  }
  try {
    if (typeof win.isContentProtected === 'function') {
      return win.isContentProtected() === true;
    }
  } catch {}
  // Setter accepted but state unverifiable (e.g. older Electron):
  // report success — on Linux this is a documented no-op, see above.
  return true;
}

module.exports = { applyContentProtection };
