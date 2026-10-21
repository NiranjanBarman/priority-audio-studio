/**
 * Electron main process — application entry point.
 *
 * RESPONSIBILITIES:
 *   1. Single-instance lock (double-launch → focus existing window)
 *   2. Register custom scheme privileges (pas-audio://) BEFORE app ready
 *   3. Create the BrowserWindow with proper security flags
 *   4. Load Vite dev server (dev) or built dist (prod)
 *   5. Register permission handlers (media, speaker-selection, display-capture)
 *   6. Register display-media handler (system/Chrome loopback)
 *   7. Register all IPC handlers via ipc/index.js
 *   8. Clean shutdown
 *
 * PRODUCTION HARDENING:
 *   - contextIsolation: true     (renderer is isolated from Node)
 *   - nodeIntegration: false     (renderer cannot require())
 *   - sandbox: false             (preload needs require('electron'))
 *   - webSecurity: true          (default; kept explicit for audit)
 *   - backgroundThrottling: false → keeps timers/rAF running when window
 *     loses focus, critical for audio meters and anti-duck timing
 */

const { app, BrowserWindow, session, desktopCapturer, Menu, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const { configurePermissions } = require('./permissions.js');
const { registerIpc } = require('./ipc/index.js');
const { registerSchemePrivileged } = require('./ipc/protocol.js');

const isDev = !app.isPackaged;
const rendererUrl = isDev
  ? 'http://localhost:5173/'
  : pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href;

function isTrustedRendererUrl(candidateUrl) {
  try {
    const candidate = new URL(candidateUrl);
    const trusted = new URL(rendererUrl);
    return candidate.origin === trusted.origin
      && candidate.pathname === trusted.pathname
      && candidate.search === trusted.search;
  } catch {
    return false;
  }
}

let mainWindow = null;

// ── Single-instance lock ───────────────────────────────────────────────
// Prevents a second copy of the app from running (which would try to open
// the same AudioContext + CABLE routing and produce a broken state).
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ── Custom scheme privileges (MUST run BEFORE app.whenReady) ──────────
// Registers `pas-audio://` as a secure, streaming-capable scheme so the
// <audio> element and fetch() can load it. Registering after whenReady
// throws "Attempted to register a scheme after ready event".
registerSchemePrivileged();

// ── Window creation ────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#111116',
    title: 'Priority Audio Studio',
    show: false, // avoid white flash — show after ready-to-show
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Dev vs prod loading
  if (isDev) {
    mainWindow.loadURL(rendererUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadURL(rendererUrl);
  }

  // Prevent external links from hijacking the app window
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent in-window navigation (e.g. from a bad drag/drop)
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-frame-navigate', (event, details) => {
    if (!isTrustedRendererUrl(details.url)) event.preventDefault();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── Display-media handler ─────────────────────────────────────────────
// Enables getDisplayMedia({ audio: true }) to return a loopback audio
// track. Without this handler, Chromium resolves with video-only and
// systemCapture.js throws a clear error.
//
// M2 will replace this with a source-picker UI. For now, auto-picks the
// first full-screen source with loopback audio — exactly what we need
// for capturing Chrome.
function registerDisplayMediaHandler(sess) {
  if (typeof sess.setDisplayMediaRequestHandler !== 'function') {
    console.warn(
      '[main] setDisplayMediaRequestHandler unavailable — systemCapture will fail.'
    );
    return;
  }

  sess.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (request.frame.parent || !isTrustedRendererUrl(request.frame.url)) {
        callback({});
        return;
      }

      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 }
        });

        if (!sources || sources.length === 0) {
          callback({});
          return;
        }

        const screen =
          sources.find((s) => s.id.startsWith('screen:')) || sources[0];

        callback({ video: screen, audio: 'loopback' });
      } catch (e) {
        console.error('[main] display-media handler error:', e);
        callback({});
      }
    },
    { useSystemPicker: false }
  );
}

// ── App lifecycle ──────────────────────────────────────────────────────
app.whenReady().then(() => {
  // 1. Permissions FIRST (session must be configured before window exists
  //    so first getUserMedia from the renderer isn't blocked)
  configurePermissions(session.defaultSession, isTrustedRendererUrl);

  // 2. Display-media handler (needed for systemCapture in M2)
  registerDisplayMediaHandler(session.defaultSession);

  // 3. IPC handlers (app:info, files:*, native:*, protocol handler)
  registerIpc();

  // 4. Hide the default menu bar in production (dev keeps DevTools menu)
  if (!isDev) {
    Menu.setApplicationMenu(null);
  }

  // 5. Create the window
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ── Clean shutdown ─────────────────────────────────────────────────────
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Graceful shutdown — M2's native audio thread will be stopped here.
// For M1 it's a no-op (nativeEngine.js handles its own addon reference).
app.on('before-quit', () => {
  try {
    const { registerNativeIpc: _unused } = require('./ipc/nativeEngine.js');
    // M2: nativeEngine will export shutdown() that we call here.
    // For now, nothing to shut down.
  } catch { /* ipc/nativeEngine missing is fine for M1 */ }
});

// ── Error surfacing (dev only) ────────────────────────────────────────
if (isDev) {
  app.on('web-contents-created', (_e, contents) => {
    contents.on('render-process-gone', (_ev, details) => {
      console.error('[renderer-gone]', details.reason, details.exitCode);
    });
    contents.on('preload-error', (_ev, preloadPath, error) => {
      console.error('[preload-error]', preloadPath, error);
    });
  });
}