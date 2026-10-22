/**
 * Settings store — persistent user preferences.
 *
 * Backend: localStorage (M1) → JSON file via IPC (M2).
 * API is stable across the milestone change.
 */

const STORAGE_KEY = 'pas.settings.v1';
export const SCHEMA_VERSION = 1;

export const DEFAULTS_SETTINGS = Object.freeze({
  // Player
  volume: 0.8,

  // Anti-duck chain
  preset: 'antiDuck',
  makeupDb: 15,
  dtxEnabled: true,

  // Routing
  outputDeviceId: '',
  monitorEnabled: false,
  monitorDeviceId: '',
  micEffect: 'normal',

  // UI
  logLevel: 'info',

  // Startup (M4)
  launchOnBoot: false,

  // Equalizer (M3)
  eqEnabled: false,
  eqGains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqBassBoost: 0,
  eqTreble: 0,
  eqDistortion: 0
});

// ── Coercion helpers ──────────────────────────────────────────────────

/**
 * Clamp with default fallback for missing values.
 * THIS FIXES m1 from the audit — undefined was previously mapped to
 * the minimum (0), muting the app on a partial settings load.
 */
function clampOrDefault(value, min, max, def) {
  if (value === undefined || value === null || value === '') return def;
  const n = Number(value);
  if (!isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function asBool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

function asEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function asString(value, fallback) {
  return typeof value === 'string' ? value : fallback;
}

function coerce(raw) {
  const d = DEFAULTS_SETTINGS;
  if (!raw || typeof raw !== 'object') return { ...d };

  const eqGainsIn = Array.isArray(raw.eqGains) && raw.eqGains.length === 10
    ? raw.eqGains.map((v) => clampOrDefault(v, -12, 12, 0))
    : [...d.eqGains];

  return {
    volume:          clampOrDefault(raw.volume, 0, 1, d.volume),
    preset:          asEnum(raw.preset, ['natural', 'loud', 'antiDuck', 'bass'], d.preset),
    makeupDb:        clampOrDefault(raw.makeupDb, 0, 18, d.makeupDb),
    dtxEnabled:      asBool(raw.dtxEnabled, d.dtxEnabled),
    outputDeviceId:  asString(raw.outputDeviceId, d.outputDeviceId),
    monitorEnabled:  asBool(raw.monitorEnabled, d.monitorEnabled),
    monitorDeviceId: asString(raw.monitorDeviceId, d.monitorDeviceId),
    micEffect:       asEnum(raw.micEffect, ['normal', 'distorted', 'radio'], d.micEffect),
    logLevel:        asEnum(raw.logLevel, ['debug', 'info', 'warn', 'error'], d.logLevel),
    launchOnBoot:    asBool(raw.launchOnBoot, d.launchOnBoot),
    eqEnabled:       asBool(raw.eqEnabled, d.eqEnabled),
    eqGains:         eqGainsIn,
    eqBassBoost:     clampOrDefault(raw.eqBassBoost, -12, 12, d.eqBassBoost),
    eqTreble:        clampOrDefault(raw.eqTreble, -12, 12, d.eqTreble),
    eqDistortion:    clampOrDefault(raw.eqDistortion, 0, 100, d.eqDistortion)
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS_SETTINGS, eqGains: [...DEFAULTS_SETTINGS.eqGains] };
    return coerce(JSON.parse(raw));
  } catch (e) {
    console.warn('[settingsStore] load failed, using defaults:', e.message);
    return { ...DEFAULTS_SETTINGS, eqGains: [...DEFAULTS_SETTINGS.eqGains] };
  }
}

export function saveSettings(settings) {
  try {
    const safe = coerce(settings);
    safe.__version = SCHEMA_VERSION;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
    return true;
  } catch (e) {
    console.warn('[settingsStore] save failed:', e.message);
    return false;
  }
}

export function resetSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { /* ok */ }
  return { ...DEFAULTS_SETTINGS, eqGains: [...DEFAULTS_SETTINGS.eqGains] };
}

export function updateSetting(key, value) {
  const current = loadSettings();
  current[key] = value;
  saveSettings(current);
  return current;
}