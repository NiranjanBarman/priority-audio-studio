/**
 * Effects — intentional distortion + modulation effects.
 *
 * MILESTONE: M3. Not wired into M1's chain. Wired in M3 when Equalizer.jsx
 * ships with real UI.
 *
 * WHY DISTORTION IN A "LOUD" APP:
 *   The spec explicitly allows distortion ("loud priority hai, clean
 *   secondary hai"). A soft-clip waveshaper can make music perceptually
 *   louder without pushing peaks past the limiter ceiling — useful when
 *   the DTX injector needs more headroom.
 *
 * SIGNAL FLOW (per effect — all are optional, bypassed via dry/wet mix):
 *   input → [distortion] → [chorus] → [delay] → output
 *
 * The whole effect block sits BETWEEN makeup and limiter in the chain
 * when enabled. When all effects are bypassed (dry=1, wet=0), the block
 * is bit-transparent.
 */
export class Effects {
  /**
   * @param {AudioContext} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;

    // ── DISTORTION (soft clip) ──────────────────────────────────────
    this.distInput = ctx.createGain();
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = this._makeSoftClipCurve(2.0);
    this.shaper.oversample = '4x';
    this.distDry = ctx.createGain();
    this.distWet = ctx.createGain();
    this.distWet.gain.value = 0; // off by default
    this.distDry.gain.value = 1;
    this.distOutput = ctx.createGain();

    this.distInput.connect(this.distDry);
    this.distInput.connect(this.shaper);
    this.shaper.connect(this.distWet);
    this.distDry.connect(this.distOutput);
    this.distWet.connect(this.distOutput);

    // ── CHORUS (modulated delay ~15ms) ─────────────────────────────
    this.chorusDry = ctx.createGain();
    this.chorusWet = ctx.createGain();
    this.chorusWet.gain.value = 0;
    this.chorusDry.gain.value = 1;
    this.chorusDelay = ctx.createDelay(0.1);
    this.chorusDelay.delayTime.value = 0.015;

    this.chorusLfo = ctx.createOscillator();
    this.chorusLfo.type = 'sine';
    this.chorusLfo.frequency.value = 0.5; // 0.5 Hz
    this.chorusLfoDepth = ctx.createGain();
    this.chorusLfoDepth.gain.value = 0.003; // ±3 ms
    this.chorusLfo.connect(this.chorusLfoDepth);
    this.chorusLfoDepth.connect(this.chorusDelay.delayTime);
    this.chorusLfo.start();

    this.chorusOutput = ctx.createGain();
    this.distOutput.connect(this.chorusDry);
    this.distOutput.connect(this.chorusDelay);
    this.chorusDelay.connect(this.chorusWet);
    this.chorusDry.connect(this.chorusOutput);
    this.chorusWet.connect(this.chorusOutput);

    // ── DELAY (simple mono, feedback) ──────────────────────────────
    this.delayDry = ctx.createGain();
    this.delayWet = ctx.createGain();
    this.delayWet.gain.value = 0;
    this.delayDry.gain.value = 1;
    this.delayNode = ctx.createDelay(1.0);
    this.delayNode.delayTime.value = 0.25;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.3;
    this.delayNode.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delayNode);

    this.delayOutput = ctx.createGain();
    this.chorusOutput.connect(this.delayDry);
    this.chorusOutput.connect(this.delayNode);
    this.delayNode.connect(this.delayWet);
    this.delayDry.connect(this.delayOutput);
    this.delayWet.connect(this.delayOutput);

    this.input = this.distInput;
    this.output = this.delayOutput;
    this.enabled = false;
  }

  /**
   * Build a soft-clip waveshaper curve.
   * @param {number} drive — 1.0 = gentle, 4.0 = heavy
   */
  _makeSoftClipCurve(drive) {
    const n = 1024;
    const curve = new Float32Array(n);
    const k = drive;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1; // -1..1
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) {
      this.distWet.gain.value = 0;
      this.chorusWet.gain.value = 0;
      this.delayWet.gain.value = 0;
      this.distDry.gain.value = 1;
      this.chorusDry.gain.value = 1;
      this.delayDry.gain.value = 1;
    }
  }

  /** @param {number} drive 1..4 @param {number} mix 0..1 */
  setDistortion(drive, mix) {
    const d = Math.max(1, Math.min(4, Number(drive) || 1));
    const m = Math.max(0, Math.min(1, Number(mix) || 0));
    this.shaper.curve = this._makeSoftClipCurve(d);
    this.distWet.gain.value = m;
    this.distDry.gain.value = 1 - m;
  }

  /** @param {number} rate 0.1..5 Hz @param {number} depthMs 0..20 @param {number} mix 0..1 */
  setChorus(rate, depthMs, mix) {
    const r = Math.max(0.1, Math.min(5, Number(rate) || 0.5));
    const d = Math.max(0, Math.min(20, Number(depthMs) || 3)) / 1000;
    const m = Math.max(0, Math.min(1, Number(mix) || 0));
    this.chorusLfo.frequency.value = r;
    this.chorusLfoDepth.gain.value = d;
    this.chorusWet.gain.value = m;
    this.chorusDry.gain.value = 1 - m * 0.5; // keep some dry signal
  }

  /** @param {number} timeSec 0.01..1 @param {number} feedback 0..0.9 @param {number} mix 0..1 */
  setDelay(timeSec, feedback, mix) {
    const t = Math.max(0.01, Math.min(1, Number(timeSec) || 0.25));
    const f = Math.max(0, Math.min(0.9, Number(feedback) || 0.3));
    const m = Math.max(0, Math.min(1, Number(mix) || 0));
    this.delayNode.delayTime.value = t;
    this.delayFeedback.gain.value = f;
    this.delayWet.gain.value = m;
    this.delayDry.gain.value = 1 - m * 0.5;
  }

  dispose() {
    try { this.chorusLfo.stop(); } catch { /* ok */ }
    const nodes = [
      this.distInput, this.shaper, this.distDry, this.distWet, this.distOutput,
      this.chorusDry, this.chorusWet, this.chorusDelay, this.chorusLfoDepth,
      this.chorusOutput, this.delayDry, this.delayWet, this.delayNode,
      this.delayFeedback, this.delayOutput
    ];
    for (const n of nodes) { try { n.disconnect(); } catch { /* ok */ } }
  }
}