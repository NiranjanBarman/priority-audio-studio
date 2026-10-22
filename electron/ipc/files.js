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
 * V2 INTEGRATION:
 *   The renderer selects files through window.pas.openFiles(). These grants
 *   are persisted in the app's user-data directory so saved playlist paths
 *   remain authorized after an application restart.
 */

const { app, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

/** Paths the user has explicitly authorized via the file dialog. */
const authorizedPaths = new Set();
let authorizationStorePath = null;

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'opus', 'webm'];

function isAuthorized(filePath) {
  return authorizedPaths.has(filePath);
}

function authorizePath(filePath) {
  const wasAuthorized = authorizedPaths.has(filePath);
  authorizedPaths.add(filePath);
  try {
    persistAuthorizedPaths();
  } catch (error) {
    if (!wasAuthorized) authorizedPaths.delete(filePath);
    throw error;
  }
}

function deauthorizePath(filePath) {
  const wasAuthorized = authorizedPaths.has(filePath);
  authorizedPaths.delete(filePath);
  try {
    persistAuthorizedPaths();
  } catch (error) {
    if (wasAuthorized) authorizedPaths.add(filePath);
    throw error;
  }
}

function persistAuthorizedPaths() {
  if (!authorizationStorePath) return;

  const temporaryPath = `${authorizationStorePath}.tmp`;
  fs.mkdirSync(path.dirname(authorizationStorePath), { recursive: true });
  fs.writeFileSync(
    temporaryPath,
    JSON.stringify(Array.from(authorizedPaths), null, 2),
    'utf8'
  );
  fs.renameSync(temporaryPath, authorizationStorePath);
}

function loadPersistedAuthorizations() {
  authorizationStorePath = path.join(
    app.getPath('userData'),
    'authorized-audio-files.json'
  );

  if (!fs.existsSync(authorizationStorePath)) return;

  let savedPaths;
  try {
    savedPaths = JSON.parse(fs.readFileSync(authorizationStorePath, 'utf8'));
  } catch (error) {
    console.error('[ipc] Could not read authorized audio paths:', error);
    return;
  }

  if (!Array.isArray(savedPaths)) {
    console.error('[ipc] Authorized audio path store is not a list.');
    return;
  }

  for (const filePath of savedPaths) {
    if (typeof filePath !== 'string') continue;
    try {
      if (fs.statSync(filePath).isFile()) authorizedPaths.add(filePath);
    } catch (error) {
      console.warn('[ipc] Previously authorized audio file is unavailable:', filePath, error.message);
    }
  }
}

function registerFileIpc() {
  loadPersistedAuthorizations();

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
      let stat;
      try {
        stat = await fs.promises.stat(fp);
      } catch (e) {
        console.warn('[ipc] file stat failed:', fp, e.message);
        continue;
      }
      if (!stat.isFile()) continue;

      authorizePath(fp);
      files.push({
        path: fp,
        name: path.basename(fp),
        size: stat.size,
        ext: path.extname(fp).replace('.', '').toLowerCase()
      });
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
    if (typeof filePath !== 'string') {
      throw new TypeError('Audio file path must be a string');
    }
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