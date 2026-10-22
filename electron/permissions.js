/**
 * Chromium permission whitelist for Voice Priority Audio.
 *
 * WHY THIS FILE EXISTS:
 *   Electron's default policy denies almost every permission. Without
 *   explicitly allowing them:
 *     - `media`             → getUserMedia fails (device labels stay empty)
 *     - `speaker-selection` → AudioContext.setSinkId() throws NotAllowedError
 *     - `display-capture`   → getDisplayMedia fails (M2 loopback dead)
 *     - `audioCapture`      → mic capture fails (M2)
 *
 * WHAT WE DO **NOT** ALLOW:
 *   - camera, geolocation, notifications, midi, etc. — the app has no
 *     business asking for these, so we silently deny them.
 *
 * SECURITY MODEL:
 *   This is a *permission* handler, not an *authentication* handler. It
 *   does NOT bypass Electron's origin isolation. The renderer still runs
 *   with contextIsolation + nodeIntegration=false; this only unlocks the
 *   browser-level permission prompts so getUserMedia/setSinkId can work.
 */

const ALLOWED_PERMISSIONS = new Set([
  'media',              // getUserMedia — mic capture + device label unlock
  'audioCapture',       // explicit audio-only capture (some Chromium builds)
  'speaker-selection',  // AudioContext.setSinkId — THE critical one for CABLE routing
  'display-capture',    // getDisplayMedia — system/Chrome loopback (M2)
  'fullscreen'          // harmless, used by some audio UIs
]);

/**
 * Configure permission handlers for a session.
 * Call once at app startup with the trusted renderer URL checker.
 *
 * @param {Electron.Session} sess
 */
function configurePermissions(sess, isTrustedRendererUrl) {
  // Handles explicit requests (e.g. getUserMedia triggers one)
  sess.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(
      ALLOWED_PERMISSIONS.has(permission)
      && details.isMainFrame
      && isTrustedRendererUrl(details.requestingUrl)
    );
  });

  // Handles synchronous checks (e.g. navigator.permissions.query)
  sess.setPermissionCheckHandler((_webContents, permission, _origin, details) => {
    return ALLOWED_PERMISSIONS.has(permission)
      && details.isMainFrame
      && isTrustedRendererUrl(details.requestingUrl || '');
  });

  // Handles device enumeration permission (Bluetooth, HID, Serial).
  // We allow nothing — the app only needs audio.
  if (typeof sess.setDevicePermissionHandler === 'function') {
    sess.setDevicePermissionHandler(() => false);
  }
}

module.exports = { configurePermissions, ALLOWED_PERMISSIONS };