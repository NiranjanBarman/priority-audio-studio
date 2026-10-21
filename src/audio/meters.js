
export class Meters {
  constructor(analyser) {
    this.analyser = analyser;
    this.buf = new Uint8Array(analyser.fftSize);
    this.raf = null;
    this.clipUntil = 0;
    this.clipHoldMs = 1000;
  }

  /**
   * Start the meter loop.
   * @param {(peak: number, clip: boolean) => void} cb
   *   peak = 0.0..1.0 normalized (1.0 = 0 dBFS)
   *   clip = true while clip latch is active
   */
  start(cb) {
    if (this.raf) return;

    const tick = () => {
      this.analyser.getByteTimeDomainData(this.buf);

      // Time-domain data is 0..255 with 128 = silence.
      // Normalize: |v - 128| / 128 gives 0..1 where 1 = full scale.
      let peak = 0;
      for (let i = 0; i < this.buf.length; i++) {
        const v = Math.abs(this.buf[i] - 128) / 128;
        if (v > peak) peak = v;
      }

      const now = performance.now();
      if (peak >= 0.99) this.clipUntil = now + this.clipHoldMs;

      cb(peak, now < this.clipUntil);
      this.raf = requestAnimationFrame(tick);
    };

    tick();
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  resetClip() {
    this.clipUntil = 0;
  }
}