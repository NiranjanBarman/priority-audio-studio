/**
 * Anti-Duck engine.
 *
 * Two responsibilities:
 *   1. DTX (Discontinuous Transmission) injector: a -55 dBFS pink-noise
 *      bed that keeps the game's VAD convinced the mic is "active".
 *      Without this, the game's VAD cuts transmission during quiet
 *      music passages — the music literally stops reaching other players.
 *   2. Preset application: switches compressor/makeup/limiter values
 *      between Natural / Loud / Anti-Duck / Bass.
 *
 * WHAT THIS DOES *NOT* DO:
 *   - It does NOT duck. There is no ducking code in this file. The spec
 *     forbids auto-ducking. This class only *prevents* ducking.
 */

// Target level for the DTX bed, in dBFS (RMS).
const DTX_DBFS = -55;
const DTX_LINEAR = Math.pow(10, DTX_DBFS / 20); // ≈ 0.00178

export class AntiDuck {
  /**
   * @param {AudioContext} ctx
   * @param {object} graph — from buildGraph()
   */
  constructor(ctx, graph) {
    this.ctx = ctx;
    this.graph = graph;

    // ── DTX INJECTOR ────────────────────────────────────────────────
    // Generate a 2-second pink-noise loop once. Cheap and deterministic.
    this.noiseBuffer = this._makePinkNoise(2.0);

    this.noiseSrc = ctx.createBufferSource();
    this.noiseSrc.buffer = this.noiseBuffer;
    this.noiseSrc.loop = true;

    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = DTX_LINEAR;

    // CRITICAL WIRING DECISION:
    // DTX connects to the ANALYSER input, not to the limiter input.
    // - Connecting to limiter input → DTX gets squashed by music-driven
    //   gain reduction, causing VAD gaps.
    // - Connecting to analyser input → DTX is mixed AFTER the safety trim
    //   at exactly -55 dBFS, unconditionally. Music goes through the
    //   anti-duck chain; DTX rides on top untouched.
    // Side effect: DTX is NOT audible on the monitor path (good —
    // user should not hear -55 dB noise in their headphones).
    this.noiseSrc.connect(this.noiseGain);
    this.noiseGain.connect(graph.analyser);
    this.noiseSrc.start();

    this.dtxEnabled = true;
  }

  /**
   * Paul Kellet's refined pink-noise filter. Output is RMS-normalized to
   * 1.0 so the gain math (DTX_LINEAR) produces the exact target dBFS.
   */
  _makePinkNoise(seconds) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }

    // Normalize RMS to 1.0
    let sumSq = 0;
    for (let i = 0; i < len; i++) sumSq += data[i] * data[i];
    const rms = Math.sqrt(sumSq / len);
    if (rms > 1e-9) {
      const scale = 1 / rms;
      for (let i = 0; i < len; i++) data[i] *= scale;
    }

    return buf;
  }

  /** Toggle the DTX bed. When off, gain = 0 (src keeps running, silent). */
  setDtxEnabled(on) {
    this.dtxEnabled = !!on;
    this.noiseGain.gain.value = on ? DTX_LINEAR : 0;
  }

  /** Makeup gain in dB. Clamped to 0..18 for safety. */
  setMakeupGain(db) {
    const clamped = Math.max(0, Math.min(18, Number(db) || 0));
    this.graph.makeup.gain.value = Math.pow(10, clamped / 20);
  }

  /**
   * Apply a named preset. Overwrites compressor, makeup, limiter, DTX.
   * Does NOT touch user's per-source volume (that lives in FilePlayer).
   *
   * @param {'natural'|'loud'|'antiDuck'|'bass'} name
   */
  applyPreset(name) {
    const g = this.graph;

    switch (name) {
      case 'natural':
        // Bypass compression. Safety limiter still active.
        g.comp.threshold.value = 0;
        g.comp.ratio.value = 1;
        g.comp.attack.value = 0.01;
        g.comp.release.value = 0.1;
        g.makeup.gain.value = 1.0;         // 0 dB
        g.limiter.threshold.value = -1;
        this.setDtxEnabled(false);
        break;

      case 'loud':
        // Moderate compression, +8 dB makeup. No DTX.
        g.comp.threshold.value = -18;
        g.comp.ratio.value = 4;
        g.comp.attack.value = 0.005;
        g.comp.release.value = 0.08;
        g.makeup.gain.value = Math.pow(10, 8 / 20);
        g.limiter.threshold.value = -1;
        this.setDtxEnabled(false);
        break;

      case 'bass':
        // Low-end emphasis. HPF stays at 80 Hz (bass = 100–250 Hz region).
        g.comp.threshold.value = -22;
        g.comp.ratio.value = 8;
        g.comp.attack.value = 0.004;
        g.comp.release.value = 0.06;
        g.makeup.gain.value = Math.pow(10, 10 / 20);
        g.limiter.threshold.value = -1;
        this.setDtxEnabled(false);
        break;

      case 'antiDuck':
      default:
        // Aggressive: 20:1, -30 dB threshold, +15 dB makeup, DTX ON.
        g.comp.threshold.value = -30;
        g.comp.ratio.value = 20;
        g.comp.attack.value = 0.003;
        g.comp.release.value = 0.04;
        g.makeup.gain.value = Math.pow(10, 15 / 20);
        g.limiter.threshold.value = -1;
        this.setDtxEnabled(true);
        break;
    }
  }

  dispose() {
    try { this.noiseSrc.stop(); } catch { /* ok */ }
    try { this.noiseSrc.disconnect(); } catch { /* ok */ }
    try { this.noiseGain.disconnect(); } catch { /* ok */ }
  }
}