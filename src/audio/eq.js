/**
 * EQ — 10-band graphic equalizer built from cascaded peaking filters.
 *
 * MILESTONE: M3. Not wired into M1's engine — Equalizer.jsx is a stub in M1.
 *
 * BAND FREQUENCIES (Hz): standard 1/3-octave-ish spacing
 *   31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k
 *
 * All filters are 'peaking' type except 31 Hz (lowshelf) and 16 kHz
 * (highshelf), which sound more natural at the extremes.
 *
 * Chain: input → B1 → B2 → ... → B10 → output
 */
const BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export class EQ {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} inputNode  — upstream node
   * @param {AudioNode} outputNode — downstream node
   */
  constructor(ctx, inputNode, outputNode) {
    this.ctx = ctx;
    this.filters = [];

    let prev = inputNode;

    for (let i = 0; i < BANDS.length; i++) {
      const f = ctx.createBiquadFilter();
      f.frequency.value = BANDS[i];
      f.Q.value = 1.0;
      f.gain.value = 0;

      if (i === 0) f.type = 'lowshelf';
      else if (i === BANDS.length - 1) f.type = 'highshelf';
      else f.type = 'peaking';

      prev.connect(f);
      prev = f;
      this.filters.push(f);
    }

    prev.connect(outputNode);
    this.outputNode = outputNode;
    this.enabled = true;
  }

  getBands() { return BANDS.slice(); }

  /** @param {number} index 0..9 @param {number} db -12..+12 */
  setBandGain(index, db) {
    if (index < 0 || index >= this.filters.length) return;
    const clamped = Math.max(-12, Math.min(12, Number(db) || 0));
    this.filters[index].gain.value = clamped;
  }

  /** Set all bands at once. @param {number[]} gainsDb length 10 */
  setAllGains(gainsDb) {
    for (let i = 0; i < Math.min(gainsDb.length, this.filters.length); i++) {
      this.setBandGain(i, gainsDb[i]);
    }
  }

  /** Flat = all bands 0 dB. */
  reset() { this.setAllGains(new Array(BANDS.length).fill(0)); }

  /** Bass boost via low shelf at 100 Hz. */
  setBassBoost(db) {
    if (this.filters.length === 0) return;
    const clamped = Math.max(-12, Math.min(12, Number(db) || 0));
    this.filters[0].gain.value = clamped;
    this.filters[1].gain.value = clamped * 0.6;
  }

  /** Treble via high shelf at 16k. */
  setTreble(db) {
    if (this.filters.length === 0) return;
    const clamped = Math.max(-12, Math.min(12, Number(db) || 0));
    this.filters[this.filters.length - 1].gain.value = clamped;
    this.filters[this.filters.length - 2].gain.value = clamped * 0.6;
  }

  dispose() {
    for (const f of this.filters) {
      try { f.disconnect(); } catch { /* ok */ }
    }
    this.filters = [];
  }
}