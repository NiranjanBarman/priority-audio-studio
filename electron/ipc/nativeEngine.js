/**
 * Native engine IPC — C++ WASAPI addon bridge.
 *
 * All channels from M2 (lifecycle/meters/diagnostics) AND M3 (DSP setters)
 * are registered here. Every handler returns { ok, reason } instead of
 * throwing — renderer wrappers check .ok.
 */

const { ipcMain, app } = require('electron');
const path = require('path');
const fs = require('fs');

let addon = null;
let loadAttempted = false;
let lastError = null;

function findAddonPath() {
  if (!app.isPackaged) {
    const devRelease = path.join(
      __dirname, '..', '..', 'audio-engine', 'build', 'Release', 'pas_engine.node'
    );
    if (fs.existsSync(devRelease)) return devRelease;
    const devDebug = path.join(
      __dirname, '..', '..', 'audio-engine', 'build', 'Debug', 'pas_engine.node'
    );
    if (fs.existsSync(devDebug)) return devDebug;
    return null;
  }
  const prodPath = path.join(process.resourcesPath, 'native', 'pas_engine.node');
  return fs.existsSync(prodPath) ? prodPath : null;
}

function tryLoadAddon() {
  if (loadAttempted) return addon;
  loadAttempted = true;
  const addonPath = findAddonPath();
  if (!addonPath) {
    lastError = 'pas_engine.node not found. Build it with scripts/build-native.ps1 (M2).';
    console.log('[native] ' + lastError);
    return null;
  }
  try {
    addon = require(addonPath);
    console.log('[native] Addon loaded from ' + addonPath);
    return addon;
  } catch (e) {
    lastError = `Addon load failed: ${e.message}`;
    console.error('[native]', lastError);
    return null;
  }
}

function noAddon() {
  return { ok: false, reason: lastError || 'addon not available' };
}

/**
 * Register a channel that forwards args to addon[methodName].
 * Reduces boilerplate for the 21 M3 setters.
 */
function registerSetter(channel, methodName) {
  ipcMain.handle(channel, async (_e, ...args) => {
    if (!addon) return noAddon();
    try {
      addon[methodName](...args);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  });
}

function registerNativeIpc() {
  tryLoadAddon();

  // ── Lifecycle ──────────────────────────────────────────────────────
  ipcMain.handle('native:init', async (_e, options) => {
    const a = tryLoadAddon();
    if (!a) return noAddon();
    try {
      const handle = a.init(options || {});
      return { ok: true, handle };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  });

  ipcMain.handle('native:start', async () => {
    if (!addon) return noAddon();
    try { addon.start(); return { ok: true }; }
    catch (e) { return { ok: false, reason: e.message }; }
  });

  ipcMain.handle('native:stop', async () => {
    if (!addon) return noAddon();
    try { addon.stop(); return { ok: true }; }
    catch (e) { return { ok: false, reason: e.message }; }
  });

  ipcMain.handle('native:dispose', async () => {
    if (!addon) return noAddon();
    try { addon.dispose(); addon = null; return { ok: true }; }
    catch (e) { return { ok: false, reason: e.message }; }
  });

  ipcMain.handle('native:setOutputDevice', async (_e, deviceId) => {
    if (!addon) return noAddon();
    try { addon.setOutputDevice(deviceId); return { ok: true }; }
    catch (e) { return { ok: false, reason: e.message }; }
  });

  ipcMain.handle('native:setInputSource', async (_e, sourceId, kind) => {
    if (!addon) return noAddon();
    try { addon.setInputSource(sourceId, kind); return { ok: true }; }
    catch (e) { return { ok: false, reason: e.message }; }
  });

  ipcMain.handle('native:pushAudio', async (_e, samples, frames) => {
    if (!addon) return noAddon();
    try {
      const f32 = new Float32Array(
        samples.buffer, samples.byteOffset, samples.byteLength / 4
      );
      addon.pushAudio(f32, frames);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  });

  // ── Meters & diagnostics ───────────────────────────────────────────
  ipcMain.handle('native:getMeters', async () => {
    if (!addon) return {
      peakL: 0, peakR: 0, clip: false, dropouts: 0,
      compressorGrDb: 0, limiterGrDb: 0
    };
    try { return addon.getMeters(); }
    catch { return {
      peakL: 0, peakR: 0, clip: false, dropouts: 0,
      compressorGrDb: 0, limiterGrDb: 0
    }; }
  });

  ipcMain.handle('native:getDiagnostics', async () => {
    if (!addon) return null;
    try { return addon.getDiagnostics(); } catch { return null; }
  });

  ipcMain.handle('native:isAvailable', () => ({
    available: !!addon,
    reason: lastError
  }));

  ipcMain.handle('native:reload', async () => {
    try { if (addon?.dispose) addon.dispose(); } catch { /* ok */ }
    addon = null;
    loadAttempted = false;
    lastError = null;
    const a = tryLoadAddon();
    return a ? { ok: true } : noAddon();
  });

  // ── M3 mixer setters ───────────────────────────────────────────────
  registerSetter('native:setMusicGain',     'setMusicGain');
  registerSetter('native:setSystemGain',    'setSystemGain');
  registerSetter('native:setSystemEnabled', 'setSystemEnabled');

  // ── M3 DTX setters ─────────────────────────────────────────────────
  registerSetter('native:setDtxEnabled', 'setDtxEnabled');
  registerSetter('native:setDtxLevelDb', 'setDtxLevelDb');

  // ── M3 EQ setters/getters ──────────────────────────────────────────
  registerSetter('native:setEqEnabled',  'setEqEnabled');
  registerSetter('native:resetEqGains',  'resetEqGains');

  ipcMain.handle('native:setEqBandGain', async (_e, band, db) => {
    if (!addon) return noAddon();
    try { addon.setEqBandGain(band, db); return { ok: true }; }
    catch (e) { return { ok: false, reason: e.message }; }
  });

  ipcMain.handle('native:setEqAllGains', async (_e, arr) => {
    if (!addon) return noAddon();
    try {
      const f32 = arr instanceof Float32Array
        ? arr
        : new Float32Array(arr.buffer || arr);
      addon.setEqAllGains(f32);
      return { ok: true };
    } catch (e) { return { ok: false, reason: e.message }; }
  });

  ipcMain.handle('native:getEqBandGain', async (_e, band) => {
    if (!addon) return 0;
    try { return addon.getEqBandGain(band); } catch { return 0; }
  });

  // ── M3 compressor setters ──────────────────────────────────────────
  registerSetter('native:setCompressorEnabled',     'setCompressorEnabled');
  registerSetter('native:setCompressorThresholdDb', 'setCompressorThresholdDb');
  registerSetter('native:setCompressorRatio',       'setCompressorRatio');
  registerSetter('native:setCompressorAttackMs',    'setCompressorAttackMs');
  registerSetter('native:setCompressorReleaseMs',   'setCompressorReleaseMs');
  registerSetter('native:setCompressorKneeDb',      'setCompressorKneeDb');
  registerSetter('native:setCompressorMakeupDb',    'setCompressorMakeupDb');

  // ── M3 limiter setters ─────────────────────────────────────────────
  registerSetter('native:setLimiterEnabled',     'setLimiterEnabled');
  registerSetter('native:setLimiterCeilingDb',   'setLimiterCeilingDb');
  registerSetter('native:setLimiterReleaseMs',   'setLimiterReleaseMs');
  registerSetter('native:setLimiterLookaheadMs', 'setLimiterLookaheadMs');
}

module.exports = { registerNativeIpc };