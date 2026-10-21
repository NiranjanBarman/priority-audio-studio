/**
 * NativeBridge — JS wrapper around the native C++ WASAPI engine addon.
 *
 * ROUTING:
 *   The addon lives in the MAIN process (electron/ipc/nativeEngine.js).
 *   The renderer reaches it via `window.pas.native.*`, which is an IPC
 *   namespace exposed by preload.js. Every call is an async IPC round-trip.
 *
 *   Direct `require('./build/Release/pas_engine.node')` would only work
 *   with nodeIntegration: true, which we deliberately disabled for security.
 *
 * BEHAVIOR WHEN ADDON IS NOT BUILT (M1 default):
 *   - `isAvailable()` → { available: false, reason: '...' }
 *   - All setters resolve to `{ ok: false }` silently
 *   - Callers (engine.js in M2.5) fall back to Web Audio chain
 *
 * PERFORMANCE NOTE:
 *   Do NOT call getMeters() at 60 fps via IPC — it's a full round-trip.
 *   Use it at 1–5 Hz (meter UI). Diagnostics does this at 1 Hz.
 *   M4 will add a push-based subscription (webContents.send) for smooth
 *   metering; until then, poll at low rate.
 */

let _available = false;
let _probed = false;
let _lastError = null;

// ── Detection ──────────────────────────────────────────────────────────

function _nativeNs() {
  if (typeof window === 'undefined') return null;
  return window.pas && window.pas.native ? window.pas.native : null;
}

/**
 * Probe whether the native addon is loaded. Caches the result.
 * @returns {Promise<{available: boolean, reason?: string}>}
 */
export async function isAvailable() {
  const ns = _nativeNs();
  if (!ns) {
    _available = false;
    _lastError = 'Not running in Electron';
    return { available: false, reason: _lastError };
  }
  if (_probed) {
    return { available: _available, reason: _lastError || undefined };
  }
  try {
    const r = await ns.isAvailable();
    _available = !!(r && r.available);
    _lastError = r && r.reason ? r.reason : null;
    _probed = true;
    return { available: _available, reason: _lastError || undefined };
  } catch (e) {
    _available = false;
    _lastError = e.message;
    _probed = true;
    return { available: false, reason: _lastError };
  }
}

export function getLastError() {
  return _lastError;
}

/** Force a re-probe (after M2 build or reload). */
export async function recheck() {
  _probed = false;
  return isAvailable();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

/**
 * Initialize the native engine.
 * @param {object} [options]
 * @param {number} [options.sampleRate=48000]
 * @param {number} [options.channels=2]
 * @param {number} [options.bufferSize=512]
 * @param {string} [options.outputDeviceId='']  — target: CABLE Input id
 * @param {string} [options.loopbackDeviceId=''] — target: headphones id
 * @returns {Promise<{ok: boolean, handle?: object, reason?: string}>}
 */
export async function init(options = {}) {
  const ns = _nativeNs();
  if (!ns) return { ok: false, reason: 'Not running in Electron' };

  try {
    const handle = await ns.init({
      sampleRate: options.sampleRate || 48000,
      channels: options.channels || 2,
      bufferSize: options.bufferSize || 512,
      outputDeviceId: options.outputDeviceId || '',
      loopbackDeviceId: options.loopbackDeviceId || ''
    });
    return { ok: true, handle };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

export async function start() {
  const ns = _nativeNs();
  if (!ns) return { ok: false, reason: 'Not running in Electron' };
  return ns.start();
}

export async function stop() {
  const ns = _nativeNs();
  if (!ns) return { ok: false, reason: 'Not running in Electron' };
  return ns.stop();
}

export async function dispose() {
  const ns = _nativeNs();
  if (!ns) return { ok: false, reason: 'Not running in Electron' };
  _probed = false;
  _available = false;
  return ns.dispose();
}

export async function setOutputDevice(deviceId) {
  const ns = _nativeNs();
  if (!ns) return { ok: false, reason: 'Not running in Electron' };
  return ns.setOutputDevice(deviceId);
}

export async function setInputSource(sourceId, kind) {
  const ns = _nativeNs();
  if (!ns) return { ok: false, reason: 'Not running in Electron' };
  return ns.setInputSource(sourceId, kind);
}

// ── Audio feed ─────────────────────────────────────────────────────────

/**
 * Push interleaved float32 samples into the native engine.
 * @param {Float32Array} samples
 * @param {number} frames
 */
export async function pushAudio(samples, frames) {
  const ns = _nativeNs();
  if (!ns) return { ok: false, reason: 'Not running in Electron' };
  return ns.pushAudio(samples, frames);
}

// ── Meters / diagnostics ───────────────────────────────────────────────

export async function getMeters() {
  const ns = _nativeNs();
  if (!ns) {
    return {
      peakL: 0, peakR: 0, clip: false, dropouts: 0,
      compressorGrDb: 0, limiterGrDb: 0
    };
  }
  return ns.getMeters();
}

export async function getDiagnostics() {
  const ns = _nativeNs();
  if (!ns) return null;
  return ns.getDiagnostics();
}

// ── Mixer ──────────────────────────────────────────────────────────────

export async function setMusicGain(gain) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setMusicGain(gain);
}

export async function setSystemGain(gain) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setSystemGain(gain);
}

export async function setSystemEnabled(enabled) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setSystemEnabled(enabled);
}

// ── DTX ────────────────────────────────────────────────────────────────

export async function setDtxEnabled(enabled) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setDtxEnabled(enabled);
}

export async function setDtxLevelDb(db) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setDtxLevelDb(db);
}

// ── EQ ─────────────────────────────────────────────────────────────────

export async function setEqEnabled(on) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setEqEnabled(on);
}

export async function setEqBandGain(band, db) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setEqBandGain(band, db);
}

export async function setEqAllGains(gainsDb) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  // Send as a plain array; native side converts to Float32Array via IPC
  return ns.setEqAllGains(new Float32Array(gainsDb));
}

export async function resetEqGains() {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.resetEqGains();
}

export async function getEqBandGain(band) {
  const ns = _nativeNs();
  if (!ns) return 0;
  return ns.getEqBandGain(band);
}

// ── Compressor ─────────────────────────────────────────────────────────

export async function setCompressorEnabled(on) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setCompressorEnabled(on);
}

export async function setCompressorThresholdDb(db) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setCompressorThresholdDb(db);
}

export async function setCompressorRatio(ratio) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setCompressorRatio(ratio);
}

export async function setCompressorAttackMs(ms) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setCompressorAttackMs(ms);
}

export async function setCompressorReleaseMs(ms) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setCompressorReleaseMs(ms);
}

export async function setCompressorKneeDb(db) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setCompressorKneeDb(db);
}

export async function setCompressorMakeupDb(db) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setCompressorMakeupDb(db);
}

/**
 * Apply one of the named anti-duck presets to the compressor.
 * @param {'natural'|'loud'|'antiDuck'|'bass'} name
 */
export async function applyCompressorPreset(name) {
  switch (name) {
    case 'natural':
      await setCompressorThresholdDb(0);
      await setCompressorRatio(1);
      await setCompressorAttackMs(10);
      await setCompressorReleaseMs(100);
      await setCompressorMakeupDb(0);
      await setDtxEnabled(false);
      break;
    case 'loud':
      await setCompressorThresholdDb(-18);
      await setCompressorRatio(4);
      await setCompressorAttackMs(5);
      await setCompressorReleaseMs(80);
      await setCompressorMakeupDb(8);
      await setDtxEnabled(false);
      break;
    case 'bass':
      await setCompressorThresholdDb(-22);
      await setCompressorRatio(8);
      await setCompressorAttackMs(4);
      await setCompressorReleaseMs(60);
      await setCompressorMakeupDb(10);
      await setDtxEnabled(false);
      break;
    case 'antiDuck':
    default:
      await setCompressorThresholdDb(-30);
      await setCompressorRatio(20);
      await setCompressorAttackMs(3);
      await setCompressorReleaseMs(40);
      await setCompressorMakeupDb(15);
      await setDtxEnabled(true);
      break;
  }
}

// ── Limiter ────────────────────────────────────────────────────────────

export async function setLimiterEnabled(on) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setLimiterEnabled(on);
}

export async function setLimiterCeilingDb(db) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setLimiterCeilingDb(db);
}

export async function setLimiterReleaseMs(ms) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setLimiterReleaseMs(ms);
}

export async function setLimiterLookaheadMs(ms) {
  const ns = _nativeNs();
  if (!ns) return { ok: false };
  return ns.setLimiterLookaheadMs(ms);
}

// ── Contract documentation ─────────────────────────────────────────────

/**
 * What the C++ addon MUST export (matches addon/addon.cpp).
 * Kept here as a checklist for future C++ changes.
 */
export const ADDON_CONTRACT = {
  // Lifecycle
  init:            '({ sampleRate, channels, bufferSize, outputDeviceId, loopbackDeviceId }) => handle',
  start:           '() => void',
  stop:            '() => void',
  dispose:         '() => void',
  setOutputDevice: '(deviceId) => void',
  setInputSource:  '(sourceId, kind) => void',

  // Audio feed
  pushAudio:       '(Float32Array samples, frames) => void',

  // Meters / diagnostics
  getMeters:       '() => { peakL, peakR, clip, dropouts, compressorGrDb, limiterGrDb }',
  getDiagnostics:  '() => { underruns, overruns, framesRendered, framesLoopback, sampleRate, channels, compressorGrDb, limiterGrDb }',

  // Mixer
  setMusicGain:    '(gain) => void',
  setSystemGain:   '(gain) => void',
  setSystemEnabled:'(enabled) => void',

  // DTX
  setDtxEnabled:   '(enabled) => void',
  setDtxLevelDb:   '(db) => void',

  // EQ
  setEqEnabled:    '(on) => void',
  setEqBandGain:   '(bandIndex, db) => void',
  setEqAllGains:   '(Float32Array[10]) => void',
  resetEqGains:    '() => void',
  getEqBandGain:   '(bandIndex) => number',

  // Compressor
  setCompressorEnabled:     '(on) => void',
  setCompressorThresholdDb: '(db) => void',
  setCompressorRatio:       '(ratio) => void',
  setCompressorAttackMs:    '(ms) => void',
  setCompressorReleaseMs:   '(ms) => void',
  setCompressorKneeDb:      '(db) => void',
  setCompressorMakeupDb:    '(db) => void',

  // Limiter
  setLimiterEnabled:     '(on) => void',
  setLimiterCeilingDb:   '(db) => void',
  setLimiterReleaseMs:   '(ms) => void',
  setLimiterLookaheadMs: '(ms) => void'
};