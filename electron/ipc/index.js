/**
 * IPC registrar — single entry point for all main-process IPC.
 *
 * Called from main.js once after app.whenReady(). Sub-modules each own
 * their own channels and register themselves via their register() function.
 *
 * WHY A FOLDER OF FILES INSTEAD OF ONE BIG main.js:
 *   - Each concern (files, protocol, native engine) is isolated
 *   - Adding a new IPC surface = new file, no changes to main.js
 *   - Testable in isolation
 *   - M2/M3/M4 features drop in without touching existing handlers
 *
 * CHANNELS OWNED HERE:
 *   app:info               → runtime versions + platform
 *   files:openDialog       → native file picker
 *   files:authorize        → allow a path for pas-audio:// serving
 *   native:init/start/...  → C++ engine control (M2)
 *
 * The custom `pas-audio://` protocol is NOT an IPC channel — it's
 * registered separately via protocol.handle(). See protocol.js.
 */

const { ipcMain } = require('electron');
const { registerFileIpc } = require('./files.js');
const { registerProtocol } = require('./protocol.js');
const { registerNativeIpc } = require('./nativeEngine.js');

function registerIpc() {
  // ── app:info ────────────────────────────────────────────────────────
  ipcMain.handle('app:info', () => ({
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch
  }));

  // ── Sub-modules ─────────────────────────────────────────────────────
  registerFileIpc();
  registerProtocol();
  registerNativeIpc();

  console.log('[ipc] All handlers registered');
}

module.exports = { registerIpc };