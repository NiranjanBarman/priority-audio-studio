/**
 * File IPC — native file picker + authorized path registry.
 *
 * SECURITY MODEL:
 *   The `pas-audio://` protocol (see protocol.js) can serve ANY file on
 *   disk if we let it. Instead, we maintain a Set of paths the user has
 *   EXPLICITLY chosen through the native dialog. The protocol refuses
 *   any path not in this Set.
 *
 *   This is the same pattern VS Code / Slack use for local file access —
 *   user gesture authorizes the path, not arbitrary URL construction.
 *
 * M2 INTEGRATION:
 *   Renderer's filePlayer.js will call window.pas.openFiles() → get
 *   { path, name, size, type } → then set audioEl.src = `pas-audio:///<encoded>`.
 *   M1 uses blob URLs, which still works — this is additive.
 */

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

/** Paths the user has explicitly authorized via the file dialog. */
const authorizedPaths = new Set();

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'webm'];

function isAuthorized(filePath) {
  return authorizedPaths.has(filePath);
}

function authorizePath(filePath) {
  authorizedPaths.add(filePath);
}

function deauthorizePath(filePath) {
  authorizedPaths.delete(filePath);
}

function registerFileIpc() {
  /**
   * Open the native file picker.
   * @returns {Promise<Array<{ path, name, size, type }>>}
   */
  ipcMain.handle('files:openDialog', async (event) => {
    const window = event.sender.getOwnerBrowserWindow();
    const result = await dialog.showOpenDialog(window, {
      title: 'Select audio files',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Audio', extensions: AUDIO_EXTENSIONS },
        { name: 'All files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) return [];

    const files = [];
    for (const fp of result.filePaths) {
      try {
        const stat = await fs.promises.stat(fp);
        if (!stat.isFile()) continue;

        // Authorize this path for pas-audio:// serving
        authorizePath(fp);

        files.push({
          path: fp,
          name: path.basename(fp),
          size: stat.size,
          ext: path.extname(fp).replace('.', '').toLowerCase()
        });
      } catch (e) {
        console.warn('[ipc] file stat failed:', fp, e.message);
      }
    }

    return files;
  });

  /**
   * Read small files (metadata, cover art, preset JSON) into memory.
   * For large audio, use pas-audio:// streaming instead.
   * Limit: 5 MB.
   */
  ipcMain.handle('files:readSmall', async (_event, filePath) => {
    if (!isAuthorized(filePath)) {
      throw new Error(`Path not authorized: ${filePath}`);
    }
    const stat = await fs.promises.stat(filePath);
    if (stat.size > 5 * 1024 * 1024) {
      throw new Error(`File too large for files:readSmall (${stat.size} bytes, max 5 MB)`);
    }
    const buf = await fs.promises.readFile(filePath);
    return buf; // Node Buffer → serialized as Uint8Array to renderer
  });

  /**
   * Remove a path from the authorized set (used when user clears playlist).
   */
  ipcMain.handle('files:deauthorize', (_event, filePath) => {
    deauthorizePath(filePath);
    return true;
  });

  /** Return all currently authorized paths (for debug panel). */
  ipcMain.handle('files:listAuthorized', () => {
    return Array.from(authorizedPaths);
  });
}

module.exports = {
  registerFileIpc,
  isAuthorized,
  authorizePath,
  AUDIO_EXTENSIONS
};