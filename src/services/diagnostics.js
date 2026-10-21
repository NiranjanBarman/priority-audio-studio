import { info, debug, warn } from './logger.js';
import {
  nativeIsAvailable,
  nativeGetDiagnostics,
  nativeGetMeters
} from './ipc.js';

const SAMPLE_INTERVAL_MS = 1000;
const EVENT_RING_SIZE = 100;
const DROPOUT_THRESHOLD_MS = 500;
const LONG_TASK_MS = 50;
const RECENT_WINDOW_MS = 60000;

class Diagnostics {
  constructor() {
    this.engine = null;

    // Sampling state
    this.timer = null;
    this.startedAt = 0;
    this.sampleCount = 0;

    // Dropout detection
    this.silentSince = 0;
    this._lastDropoutCountedAt = 0;
    this.dropoutCount = 0;

    // Long-task tracking
    this.longTaskObserver = null;
    this.longTasks = []; // [{ t, duration }]

    // Frame tracking (rAF-driven, optional)
    this.frameCount = 0;
    this.framesSinceLastSample = 0;
    this.lastFpsSampleAt = 0;
    this.fps = 0;

    // Event log (ring)
    this.events = [];

    // Native engine availability (refreshed per sample)
    this.nativeAvailable = false;
    this.nativeInfo = null;

    // Subscribers
    this.listeners = new Set();

    // Last snapshot (avoid allocating on every subscribe tick)
    this.lastSnapshot = null;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /**
   * Attach to an AudioEngine instance. Must be called before start().
   * @param {object} engine — from src/audio/engine.js getEngine()
   */
  attach(engine) {
    if (!engine) {
      warn('Diagnostics.attach: engine is null');
      return;
    }
    this.engine = engine;
    info('Diagnostics attached to engine');
  }

  /**
   * Begin 1 Hz sampling + long-task observer + rAF frame counter.
   * Idempotent.
   */
  start() {
    if (this.timer) return;

    this.startedAt = Date.now();
    this.sampleCount = 0;

    // Long-task observer — Chromium 124+ (Electron 30). Falls back silently
    // if unsupported.
    this._startLongTaskObserver();

    // rAF frame counter for FPS estimation
    this._startFrameCounter();

    // Eagerly probe native availability once
    this._probeNative();

    // Periodic sample
    this.timer = setInterval(() => this._sample(), SAMPLE_INTERVAL_MS);

    info('Diagnostics started');
  }

  /**
   * Stop sampling. Clears timer, disconnects observers.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.longTaskObserver) {
      try { this.longTaskObserver.disconnect(); } catch { /* ok */ }
      this.longTaskObserver = null;
    }
    debug('Diagnostics stopped');
  }

  /**
   * Full shutdown — stop + clear subscribers + release references.
   */
  dispose() {
    this.stop();
    this.listeners.clear();
    this.engine = null;
    this.events = [];
    this.lastSnapshot = null;
  }

  // ── Subscription ────────────────────────────────────────────────────

  /**
   * Subscribe to snapshot updates. Fires at 1 Hz (once per sample).
   * @param {(snapshot: object) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe(fn) {
    this.listeners.add(fn);
    // Immediately deliver current snapshot if available
    if (this.lastSnapshot) {
      try { fn(this.lastSnapshot); } catch { /* ok */ }
    }
    return () => this.listeners.delete(fn);
  }

  // ── Event log ───────────────────────────────────────────────────────

  /**
   * Record a manual event. Useful for post-mortem analysis.
   * @param {string} type — e.g. 'sink_switch', 'file_load', 'dtx_toggle'
   * @param {object} [data]
   */
  recordEvent(type, data = null) {
    const entry = {
      t: Date.now(),
      type,
      data: data ? this._safeClone(data) : null
    };
    this.events.push(entry);
    if (this.events.length > EVENT_RING_SIZE) this.events.shift();
    debug(`event: ${type}`, data || {});
  }

  /**
   * Get the full event log (newest last).
   * @returns {Array<{t, type, data}>}
   */
  getEventLog() {
    return this.events.slice();
  }

  // ── Snapshot ────────────────────────────────────────────────────────

  /**
   * Current diagnostics snapshot. Safe to call anytime.
   * @returns {object}
   */
  getSnapshot() {
    if (this.lastSnapshot) return this.lastSnapshot;
    // Build on-demand if start() hasn't run yet
    return this._buildSnapshot();
  }

  /**
   * Health score 0–100. Higher is better. Degrades with:
   *   - dropouts (heaviest penalty)
   *   - recent errors in event log
   *   - long tasks in the last minute
   *   - native engine unavailable when expected (M2+)
   * @returns {number}
   */
  getHealthScore() {
    const snap = this.getSnapshot();
    let score = 100;

    // Dropouts: -2 each, capped at -30
    score -= Math.min(30, snap.dropouts * 2);

    // Recent errors in last 60s: -5 each, capped at -40
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const recentErrors = this.events.filter(
      e => e.t > cutoff && e.type === 'error'
    ).length;
    score -= Math.min(40, recentErrors * 5);

    // Long tasks in last 60s: -1 each, capped at -20
    const recentLongTasks = snap.longTasksLastMinute || 0;
    score -= Math.min(20, recentLongTasks * 1);

    // Context not running: -15
    if (snap.ctxState && snap.ctxState !== 'running' && snap.ctxState !== 'closed') {
      score -= 15;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  // ── Internal ────────────────────────────────────────────────────────

  _startLongTaskObserver() {
    if (typeof PerformanceObserver !== 'function') return;
    try {
      this.longTaskObserver = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (entry.duration >= LONG_TASK_MS) {
            this.longTasks.push({ t: entry.startTime, duration: entry.duration });
            // Trim to last 5 min to bound memory
            const cutoff = performance.now() - 5 * 60 * 1000;
            while (this.longTasks.length && this.longTasks[0].t < cutoff) {
              this.longTasks.shift();
            }
          }
        }
      });
      this.longTaskObserver.observe({ entryTypes: ['longtask'] });
    } catch (e) {
      // Some Chromium builds reject 'longtask' — degrade silently
      debug('longtask observer unavailable', { error: e.message });
      this.longTaskObserver = null;
    }
  }

  _startFrameCounter() {
    if (typeof requestAnimationFrame !== 'function') return;
    const tick = () => {
      this.framesSinceLastSample++;
      this.frameCount++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  async _probeNative() {
    try {
      const r = await nativeIsAvailable();
      this.nativeAvailable = !!(r && r.available);
      this.nativeInfo = r || null;
      if (this.nativeAvailable) {
        info('Native engine detected for diagnostics');
      }
    } catch (e) {
      this.nativeAvailable = false;
      this.nativeInfo = { available: false, reason: e.message };
    }
  }

  async _sample() {
    this.sampleCount++;

    // Refresh native availability every ~10 samples to detect addon reload
    if (this.sampleCount % 10 === 0) {
      this._probeNative();
    }

    // FPS estimate
    const now = performance.now();
    if (this.lastFpsSampleAt > 0) {
      const dt = (now - this.lastFpsSampleAt) / 1000;
      if (dt > 0) {
        this.fps = Math.round(this.framesSinceLastSample / dt);
      }
    }
    this.lastFpsSampleAt = now;
    this.framesSinceLastSample = 0;

    // Dropout detection
    if (this.engine && this.engine.state) {
      this._detectDropout(this.engine.state, Date.now());
    }

    // Native counters (M2 — no-op in M1)
    let nativeDiag = null;
    let nativeMeters = null;
    if (this.nativeAvailable) {
      try {
        nativeDiag = await nativeGetDiagnostics();
        nativeMeters = await nativeGetMeters();
      } catch (e) {
        debug('native sample failed', { error: e.message });
      }
    }

    // Build + emit snapshot
    const snap = await this._buildSnapshotAsync(nativeDiag, nativeMeters);
    this.lastSnapshot = snap;

    for (const fn of this.listeners) {
      try { fn(snap); } catch { /* subscriber crashed */ }
    }
  }

  _detectDropout(state, now) {
    // If not playing, or if signal is present → no dropout
    if (!state.playing) {
      this.silentSince = 0;
      return;
    }
    if (state.peak > 0.001) {
      this.silentSince = 0;
      return;
    }

    // Playing but silent
    if (this.silentSince === 0) {
      this.silentSince = now;
      return;
    }

    if (now - this.silentSince > DROPOUT_THRESHOLD_MS) {
      // Count each dropout event once
      if (this._lastDropoutCountedAt !== this.silentSince) {
        this._lastDropoutCountedAt = this.silentSince;
        this.dropoutCount++;
        this.recordEvent('dropout', {
          silentForMs: now - this.silentSince
        });
      }
    }
  }

  _buildSnapshot() {
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const longTasksLastMinute = this.longTasks.filter(
      lt => performance.now() - lt.t < RECENT_WINDOW_MS
    ).length;

    return {
      uptimeMs: this.startedAt ? Date.now() - this.startedAt : 0,
      sampleCount: this.sampleCount,
      fps: this.fps,

      // Audio context (may be null if engine not initialized)
      ctxState: this.engine?.ctx?.state || null,
      sampleRate: this.engine?.ctx?.sampleRate || null,
      baseLatency: this.engine?.ctx?.baseLatency || null,
      outputLatency: this.engine?.ctx?.outputLatency || null,

      // Meters
      peak: this.engine?.state?.peak || 0,
      clip: !!(this.engine?.state?.clip),

      // Health counters
      dropouts: this.dropoutCount,
      longTasksLastMinute,

      // Native (M2 — null in M1)
      nativeAvailable: this.nativeAvailable,
      nativeInfo: this.nativeInfo,

      // Memory (Chromium-only)
      memory: this._getMemory(),

      // Recent events count
      recentErrors: this.events.filter(e => e.t > cutoff && e.type === 'error').length
    };
  }

  async _buildSnapshotAsync(nativeDiag, nativeMeters) {
    const base = this._buildSnapshot();
    return {
      ...base,
      native: nativeDiag,
      nativeMeters
    };
  }

  _getMemory() {
    // Chromium-only API. Guard for safety.
    if (typeof performance === 'undefined' || !performance.memory) return null;
    const m = performance.memory;
    return {
      usedJSHeapMB: Math.round(m.usedJSHeapSize / (1024 * 1024)),
      totalJSHeapMB: Math.round(m.totalJSHeapSize / (1024 * 1024)),
      limitMB: Math.round(m.jsHeapSizeLimit / (1024 * 1024))
    };
  }

  _safeClone(obj) {
    try {
      // Handles cycles; drops functions
      return JSON.parse(JSON.stringify(obj));
    } catch {
      return { _unserializable: true };
    }
  }
}

// ── Singleton factory ──────────────────────────────────────────────────

let _singleton = null;

/**
 * Get the singleton Diagnostics instance.
 * @returns {Diagnostics}
 */
export function getDiagnostics() {
  if (!_singleton) _singleton = new Diagnostics();
  return _singleton;
}

// ── Convenience event helpers ──────────────────────────────────────────
// These wrap recordEvent() with typed payloads so the call sites stay
// short and consistent.

export function recordPlaybackError(message, file = null) {
  getDiagnostics().recordEvent('error', { area: 'playback', message, file });
}

export function recordDeviceChange(kind, deviceId, label) {
  getDiagnostics().recordEvent('device_change', { kind, deviceId, label });
}

export function recordSinkSwitch(deviceId, label) {
  getDiagnostics().recordEvent('sink_switch', { deviceId, label });
}

export function recordFileLoad(name, size, ext) {
  getDiagnostics().recordEvent('file_load', { name, size, ext });
}

export function recordPresetChange(name) {
  getDiagnostics().recordEvent('preset_change', { name });
}

export function recordDtxToggle(enabled) {
  getDiagnostics().recordEvent('dtx_toggle', { enabled });
}