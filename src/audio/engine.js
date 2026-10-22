import { buildGraph } from './graph.js';
import { FilePlayer } from './filePlayer.js';
import { Meters } from './meters.js';
import { AntiDuck } from './antiDuck.js';
import { MicCapture } from './micCapture.js';
import { log } from '../services/logger.js';

/**
 * AudioEngine — single source of truth for the audio pipeline.
 *
 * Lifecycle:
 *   1. getEngine() creates the instance (no side effects).
 *   2. engine.init() creates AudioContext + graph + player + meters + antiDuck.
 *      This MUST run after a user gesture (Play button click, Start Engine click).
 *   3. engine.setOutputDevice(id) routes the context's destination to CABLE Input.
 *   4. engine.setPreset('antiDuck') applies the default aggressive chain.
 *
 * React talks to this class via useAudioEngine() hook.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.graph = null;
    this.player = null;
    this.meters = null;
    this.antiDuck = null;
    this.mic = null;
    this.micGain = 1;
    this.micEffect = 'normal';

    this.monitorEl = null;
    this._initPromise = null;

    this.listeners = new Set();
    this.state = {
      ready: false,
      playing: false,
      currentTrack: null,
      currentTime: 0,
      duration: 0,
      volume: 0.8,
      preset: 'antiDuck',
      outputDeviceId: '',
      monitorEnabled: false,
      micEnabled: false,
      micDeviceId: '',
      peak: 0,
      clip: false,
      error: null
    };
  }

  // ── State subscription ─────────────────────────────────────────────

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit() {
    const snap = { ...this.state };
    for (const l of this.listeners) l(snap);
  }

  _set(partial) {
    Object.assign(this.state, partial);
    this.emit();
  }

  // ── Initialization ─────────────────────────────────────────────────

  /**
   * Idempotent init. Safe to call multiple times.
   * If two components call init() in the same tick, both await the
   * same promise — no duplicate AudioContexts.
   */
  async init() {
    if (this.ctx) return;
    if (this._initPromise) return this._initPromise;

    this._initPromise = this._doInit();
    try {
      await this._initPromise;
    } finally {
      this._initPromise = null;
    }
  }

  async _doInit() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    if (this.ctx.state === 'suspended') await this.ctx.resume();

    this.graph = buildGraph(this.ctx);
    this.meters = new Meters(this.graph.analyser);
    this.antiDuck = new AntiDuck(this.ctx, this.graph);
    this.mic = new MicCapture(this.ctx, this.graph.micInput);
    this.mic.setGain(this.micGain);
    this.mic.setEffect(this.micEffect);

    this.player = new FilePlayer(this.ctx, this.graph.sourceInput, (s) => {
      this._set(s);
    });

    this.meters.start((peak, clip) => {
      // Direct state mutation for high-frequency updates (avoids snapshot
      // allocation at 60 fps). Subscribers still get the value on next emit.
      this.state.peak = peak;
      this.state.clip = clip;
      this.emit();
    });

    this._set({ ready: true, error: null });
    log(`AudioEngine ready · sampleRate=${this.ctx.sampleRate} Hz`);
  }

  // ── Output routing ─────────────────────────────────────────────────

  /**
   * Route the context's destination to a specific device.
   * Empty string = Windows default device.
   */
  async setOutputDevice(deviceId) {
    await this.init();

    if (typeof this.ctx.setSinkId !== 'function') {
      const msg =
        'This Chromium build does not support AudioContext.setSinkId(). ' +
        'Please update Electron.';
      this._set({ error: msg });
      log(msg, 'error');
      throw new Error(msg);
    }

    try {
      await this.ctx.setSinkId(deviceId || '');
      this._set({ outputDeviceId: deviceId || '', error: null });
      log(`Output sink → ${deviceId || 'default'}`);
    } catch (e) {
      const msg = `setSinkId failed: ${e.message}`;
      this._set({ error: msg });
      log(msg, 'error');
      throw e;
    }
  }

  // ── Monitor control ────────────────────────────────────────────────

  /**
   * Enable/disable the headphone monitor.
   * Monitor = isolated tap. Does NOT include DTX (user shouldn't hear it).
   */
  async enableMonitor(enabled, deviceId) {
    await this.init();

    if (!enabled) {
      this.graph.monitorGain.gain.value = 0;
      if (this.monitorEl) {
        try { this.monitorEl.pause(); } catch { /* ok */ }
        this.monitorEl.srcObject = null;
        this.monitorEl = null;
      }
      this._set({ monitorEnabled: false });
      log('Monitor OFF');
      return;
    }

    this.graph.monitorGain.gain.value = 1;

    if (!this.monitorEl) {
      this.monitorEl = new Audio();
      this.monitorEl.srcObject = this.graph.mediaStreamDest.stream;
    }

    if (deviceId && typeof this.monitorEl.setSinkId === 'function') {
      try {
        await this.monitorEl.setSinkId(deviceId);
      } catch (e) {
        log(`Monitor setSinkId failed: ${e.message}`, 'error');
      }
    }

    try {
      await this.monitorEl.play();
    } catch (e) {
      log(`Monitor play failed: ${e.message}`, 'error');
    }

    this._set({ monitorEnabled: true });
    log('Monitor ON');
  }

  // ── Player passthroughs ────────────────────────────────────────────

  async loadFile(filePath, metadata) {
    await this.init();
    return this.player.load(filePath, metadata);
  }

  unloadFile() {
    if (this.player) this.player.unload();
  }

  async play() {
    await this.init();
    return this.player.play();
  }

  pause() {
    if (this.player) this.player.pause();
  }

  stop() {
    if (this.player) this.player.stop();
  }

  seek(t) {
    if (this.player) this.player.seek(t);
  }

  setVolume(v) {
    this._set({ volume: v });
    if (this.player) this.player.setVolume(v);
  }

  // ── Preset + chain control ─────────────────────────────────────────

  setPreset(name) {
    if (!this.antiDuck) {
      // Defer until init — Dashboard click order guarantees init runs first.
      return;
    }
    this.antiDuck.applyPreset(name);
    this._set({ preset: name });
    log(`Preset → ${name}`);
  }

  setMakeupGain(db) {
    if (!this.antiDuck) return;
    this.antiDuck.setMakeupGain(db);
    log(`Makeup gain → ${db} dB`);
  }

  setDtxEnabled(on) {
    if (!this.antiDuck) return;
    this.antiDuck.setDtxEnabled(on);
    log(`DTX injector → ${on ? 'ON' : 'OFF'}`);
  }

  async enableMic(deviceId, enabled) {
    await this.init();

    if (!enabled) {
      this.mic.stop();
      this._set({ micEnabled: false, error: null });
      log('Microphone OFF');
      return;
    }

    try {
      await this.mic.start(deviceId);
      this.mic.setGain(this.micGain);
      this._set({ micEnabled: true, micDeviceId: deviceId || '', error: null });
      log(`Microphone ON · ${deviceId || 'default input'}`);
    } catch (error) {
      this.mic.stop();
      this._set({ micEnabled: false, error: error.message });
      log(`Microphone start failed: ${error.message}`, 'error');
      throw error;
    }
  }

  setMicGain(value) {
    const gain = Math.max(0, Math.min(2, Number(value) || 0));
    this.micGain = gain;
    if (this.mic) this.mic.setGain(gain);
  }

  setMicEffect(effectName) {
    if (!['normal', 'distorted', 'radio'].includes(effectName)) {
      throw new TypeError(`Unsupported microphone effect: ${effectName}`);
    }
    if (this.mic) this.mic.setEffect(effectName);
    this.micEffect = effectName;
  }

  // ── Shutdown ───────────────────────────────────────────────────────

  async dispose() {
    try {
      if (this.monitorEl) {
        this.monitorEl.pause();
        this.monitorEl.srcObject = null;
        this.monitorEl = null;
      }
      if (this.meters) this.meters.stop();
      if (this.mic) this.mic.stop();
      if (this.player) this.player.dispose();
      if (this.antiDuck) this.antiDuck.dispose();
      if (this.ctx) await this.ctx.close();
    } catch (e) {
      log(`dispose error: ${e.message}`, 'error');
    }

    this.ctx = null;
    this.graph = null;
    this.player = null;
    this.meters = null;
    this.antiDuck = null;
    this.mic = null;
    this._initPromise = null;

    this._set({
      ready: false,
      playing: false,
      micEnabled: false,
      peak: 0,
      clip: false
    });
  }
}

// ── Singleton factory ────────────────────────────────────────────────
let _singleton = null;

export function getEngine() {
  if (!_singleton) _singleton = new AudioEngine();
  return _singleton;
}