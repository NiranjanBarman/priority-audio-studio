/**
 * IPC service — safe wrapper around window.pas.
 *
 * WHY THIS FILE EXISTS:
 *   The preload exposes `window.pas` with safeInvoke channels. But:
 *   1. In Vite's browser preview (npm run dev:vite alone, no Electron),
 *      window.pas is undefined. Every call would crash.
 *   2. Channel names would be scattered across the codebase as magic
 *      strings — hard to audit.
 *   3. Argument validation belongs in one place, not in every component.
 *
 * This file is the ONLY place that talks to window.pas. Every component
 * imports from here. If M3 adds new channels, they get added here.
 *
 * BEHAVIOR IN BROWSER (no Electron):
 *   Every method returns a safe fallback and logs a warning. The app
 *   doesn't crash — file dialogs just return [], appInfo returns browser
 *   versions, native engine reports "unavailable".
 */

import { warn, debug } from './logger.js';

// ── Detection ──────────────────────────────────────────────────────────

export function isElectron() {
  return !!(typeof window !== 'undefined' && window.pas && window.pas.isElectron);
}

// ── App info ───────────────────────────────────────────────────────────

/**
 * Get runtime versions. Works in Electron and browser.
 * @returns {Promise<{electron, chrome, node, platform, arch, mode}>}
 */
export async function getAppInfo() {
  if (isElectron() && typeof window.pas.appInfo === 'function') {
    try {
      const info = await window.pas.appInfo();
      return { ...info, mode: 'electron' };
    } catch (e) {
      warn('appInfo failed', { error: e.message });
    }
  }
  // Browser fallback
  return {
    electron: null,
    chrome: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || null,
    node: null,
    platform: navigator.platform || 'browser',
    arch: null,
    mode: 'browser'
  };
}

// ── File dialog ────────────────────────────────────────────────────────

/**
 * Open the native file picker.
 * @returns {Promise<Array<{path, name, size, ext}>>}
 */
export async function openFiles() {
  if (!isElectron()) {
    debug('openFiles: not in Electron, returning []');
    return [];
  }
  try {
    return await window.pas.openFiles();
  } catch (e) {
    warn('openFiles failed', { error: e.message });
    return [];
  }
}

/**
 * Read a small file (metadata, cover art) into memory. Max 5 MB enforced
 * on the main-process side.
 * @param {string} filePath — must be authorized via openFiles first
 * @returns {Promise<Uint8Array|null>}
 */
export async function readSmallFile(filePath) {
  if (!isElectron()) return null;
  try {
    return await window.pas.readSmallFile(filePath);
  } catch (e) {
    warn('readSmallFile failed', { error: e.message });
    return null;
  }
}

/**
 * Deauthorize a path from `pas-audio://` serving.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
export async function deauthorizeFile(filePath) {
  if (!isElectron()) return false;
  try {
    return await window.pas.deauthorizeFile(filePath);
  } catch (e) {
    warn('deauthorizeFile failed', { error: e.message });
    return false;
  }
}

/**
 * List all paths currently authorized for streaming.
 * @returns {Promise<string[]>}
 */
export async function listAuthorizedFiles() {
  if (!isElectron()) return [];
  try {
    return await window.pas.listAuthorizedFiles();
  } catch {
    return [];
  }
}

// ── Native engine (M2) ─────────────────────────────────────────────────

/**
 * Report whether the C++ WASAPI engine addon is loaded.
 * @returns {Promise<{available: boolean, reason?: string}>}
 */
export async function nativeIsAvailable() {
  if (!isElectron() || !window.pas.native) {
    return { available: false, reason: 'not in Electron' };
  }
  try {
    return await window.pas.native.isAvailable();
  } catch (e) {
    return { available: false, reason: e.message };
  }
}

/**
 * Forwarding wrappers — return { ok: false } if native is unavailable.
 * M2's engine.js will call these; M1's engine.js doesn't (uses Web Audio).
 */
export async function nativeInit(options) {
  if (!isElectron() || !window.pas.native) return { ok: false, reason: 'not in Electron' };
  return window.pas.native.init(options);
}

export async function nativeStart() {
  if (!isElectron() || !window.pas.native) return { ok: false, reason: 'not in Electron' };
  return window.pas.native.start();
}

export async function nativeStop() {
  if (!isElectron() || !window.pas.native) return { ok: false, reason: 'not in Electron' };
  return window.pas.native.stop();
}

export async function nativeSetOutputDevice(deviceId) {
  if (!isElectron() || !window.pas.native) return { ok: false, reason: 'not in Electron' };
  return window.pas.native.setOutputDevice(deviceId);
}

export async function nativeGetMeters() {
  if (!isElectron() || !window.pas.native) {
    return { peakL: 0, peakR: 0, clip: false, dropouts: 0 };
  }
  return window.pas.native.getMeters();
}

export async function nativeGetDiagnostics() {
  if (!isElectron() || !window.pas.native) return null;
  return window.pas.native.getDiagnostics();
}

export async function nativeDispose() {
  if (!isElectron() || !window.pas.native) return { ok: false, reason: 'not in Electron' };
  return window.pas.native.dispose();
}

export async function nativeReload() {
  if (!isElectron() || !window.pas.native) return { ok: false, reason: 'not in Electron' };
  return window.pas.native.reload();
}

// ── Custom protocol helper ─────────────────────────────────────────────

/**
 * Build a `pas-audio://` URL for an authorized local path.
 * The file player uses this instead of blob URLs.
 * @param {string} filePath — absolute path, must be authorized
 * @returns {string}
 */
export function buildPasAudioUrl(filePath) {
  // Encode the entire path so Windows backslashes and spaces survive.
  return `pas-audio://local/${encodeURIComponent(filePath)}`;
}