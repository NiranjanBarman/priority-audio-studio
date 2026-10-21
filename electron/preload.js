/**
 * Preload script — whitelisted IPC surface for the renderer.
 *
 * All channels used by src/services/ipc.js and src/audio/nativeBridge.js
 * are whitelisted here. Any channel not in ALLOWED_INVOKE is rejected.
 */

const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = new Set([
  // App info
  'app:info',

  // Files
  'files:openDialog',
  'files:readSmall',
  'files:deauthorize',
  'files:listAuthorized',

  // Native lifecycle
  'native:init',
  'native:start',
  'native:stop',
  'native:dispose',
  'native:setOutputDevice',
  'native:setInputSource',
  'native:pushAudio',
  'native:getMeters',
  'native:getDiagnostics',
  'native:isAvailable',
  'native:reload',

  // Native M3 — mixer
  'native:setMusicGain',
  'native:setSystemGain',
  'native:setSystemEnabled',

  // Native M3 — DTX
  'native:setDtxEnabled',
  'native:setDtxLevelDb',

  // Native M3 — EQ
  'native:setEqEnabled',
  'native:setEqBandGain',
  'native:setEqAllGains',
  'native:resetEqGains',
  'native:getEqBandGain',

  // Native M3 — compressor
  'native:setCompressorEnabled',
  'native:setCompressorThresholdDb',
  'native:setCompressorRatio',
  'native:setCompressorAttackMs',
  'native:setCompressorReleaseMs',
  'native:setCompressorKneeDb',
  'native:setCompressorMakeupDb',

  // Native M3 — limiter
  'native:setLimiterEnabled',
  'native:setLimiterCeilingDb',
  'native:setLimiterReleaseMs',
  'native:setLimiterLookaheadMs'
]);

const ALLOWED_SEND = new Set([]);
const ALLOWED_RECEIVE = new Set([]);

function safeInvoke(channel, ...args) {
  if (!ALLOWED_INVOKE.has(channel)) {
    return Promise.reject(new Error(`IPC channel not allowed: ${channel}`));
  }
  return ipcRenderer.invoke(channel, ...args);
}

function safeSend(channel, ...args) {
  if (!ALLOWED_SEND.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
  ipcRenderer.send(channel, ...args);
}

function safeOn(channel, handler) {
  if (!ALLOWED_RECEIVE.has(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
  const wrapped = (_event, ...args) => handler(...args);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

contextBridge.exposeInMainWorld('pas', {
  isElectron: true,

  // App info
  appInfo: () => safeInvoke('app:info'),

  // Files
  openFiles: () => safeInvoke('files:openDialog'),
  readSmallFile: (p) => safeInvoke('files:readSmall', p),
  deauthorizeFile: (p) => safeInvoke('files:deauthorize', p),
  listAuthorizedFiles: () => safeInvoke('files:listAuthorized'),

  // Native engine
  native: {
    // Lifecycle
    init: (opts) => safeInvoke('native:init', opts),
    start: () => safeInvoke('native:start'),
    stop: () => safeInvoke('native:stop'),
    dispose: () => safeInvoke('native:dispose'),
    setOutputDevice: (id) => safeInvoke('native:setOutputDevice', id),
    setInputSource: (id, kind) => safeInvoke('native:setInputSource', id, kind),
    pushAudio: (samples, frames) => safeInvoke('native:pushAudio', samples, frames),
    getMeters: () => safeInvoke('native:getMeters'),
    getDiagnostics: () => safeInvoke('native:getDiagnostics'),
    isAvailable: () => safeInvoke('native:isAvailable'),
    reload: () => safeInvoke('native:reload'),

    // M3 — mixer
    setMusicGain: (g) => safeInvoke('native:setMusicGain', g),
    setSystemGain: (g) => safeInvoke('native:setSystemGain', g),
    setSystemEnabled: (on) => safeInvoke('native:setSystemEnabled', on),

    // M3 — DTX
    setDtxEnabled: (on) => safeInvoke('native:setDtxEnabled', on),
    setDtxLevelDb: (db) => safeInvoke('native:setDtxLevelDb', db),

    // M3 — EQ
    setEqEnabled: (on) => safeInvoke('native:setEqEnabled', on),
    setEqBandGain: (b, db) => safeInvoke('native:setEqBandGain', b, db),
    setEqAllGains: (arr) => safeInvoke('native:setEqAllGains', arr),
    resetEqGains: () => safeInvoke('native:resetEqGains'),
    getEqBandGain: (b) => safeInvoke('native:getEqBandGain', b),

    // M3 — compressor
    setCompressorEnabled: (on) => safeInvoke('native:setCompressorEnabled', on),
    setCompressorThresholdDb: (db) => safeInvoke('native:setCompressorThresholdDb', db),
    setCompressorRatio: (r) => safeInvoke('native:setCompressorRatio', r),
    setCompressorAttackMs: (ms) => safeInvoke('native:setCompressorAttackMs', ms),
    setCompressorReleaseMs: (ms) => safeInvoke('native:setCompressorReleaseMs', ms),
    setCompressorKneeDb: (db) => safeInvoke('native:setCompressorKneeDb', db),
    setCompressorMakeupDb: (db) => safeInvoke('native:setCompressorMakeupDb', db),

    // M3 — limiter
    setLimiterEnabled: (on) => safeInvoke('native:setLimiterEnabled', on),
    setLimiterCeilingDb: (db) => safeInvoke('native:setLimiterCeilingDb', db),
    setLimiterReleaseMs: (ms) => safeInvoke('native:setLimiterReleaseMs', ms),
    setLimiterLookaheadMs: (ms) => safeInvoke('native:setLimiterLookaheadMs', ms)
  }
});