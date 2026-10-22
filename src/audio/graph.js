/**
 * Builds the fixed anti-duck processing chain.
 *
 * CHAIN ORDER:
 *   Music: sourceInput → HPF/EQ → distortion → compressor → makeup
 *          → limiter ─┐
 *   Mic: micInput → micLimiter ─┴→ mixBus → safetyTrim → analyser → destination
 *
 * The EQ section is controlled by Equalizer.jsx. Its nodes are returned
 * in the graph so the page can tweak gains live.
 */
export function buildGraph(ctx) {
  // ── SOURCE INPUT ──────────────────────────────────────────────────
  // Music runs through the anti-duck compressor without mic activity
  // triggering gain reduction on the music bus.
  const sourceInput = ctx.createGain();
  sourceInput.gain.value = 1.0;

  // Mic has its own limiter so its peaks cannot trigger music gain reduction.
  const micInput = ctx.createGain();
  micInput.gain.value = 1.0;

  const micLimiter = ctx.createDynamicsCompressor();
  micLimiter.threshold.value = -18;
  micLimiter.knee.value = 0;
  micLimiter.ratio.value = 20;
  micLimiter.attack.value = 0.001;
  micLimiter.release.value = 0.1;

  const mixBus = ctx.createGain();
  mixBus.gain.value = 1.0;

  // ── HPF 80 Hz ─────────────────────────────────────────────────────
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.frequency.value = 80;
  hpf.Q.value = 0.7;

  // ── 10-BAND EQ ────────────────────────────────────────────────────
  const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const eqBands = EQ_FREQS.map((freq, i) => {
    const f = ctx.createBiquadFilter();
    if (i === 0) f.type = 'lowshelf';
    else if (i === EQ_FREQS.length - 1) f.type = 'highshelf';
    else f.type = 'peaking';
    f.frequency.value = freq;
    f.Q.value = 1.0;
    f.gain.value = 0;
    return f;
  });

  // ── BASS SHELF (extra control beyond band 0) ──────────────────────
  const bassShelf = ctx.createBiquadFilter();
  bassShelf.type = 'lowshelf';
  bassShelf.frequency.value = 100;
  bassShelf.gain.value = 0;

  // ── TREBLE SHELF ──────────────────────────────────────────────────
  const trebleShelf = ctx.createBiquadFilter();
  trebleShelf.type = 'highshelf';
  trebleShelf.frequency.value = 16000;
  trebleShelf.gain.value = 0;

  // ── DISTORTION (soft-clip waveshaper with dry/wet) ────────────────
  const distortionIn = ctx.createGain();
  const distortionDry = ctx.createGain();
  const distortionWet = ctx.createGain();
  const distortionShaper = ctx.createWaveShaper();
  const distortionOut = ctx.createGain();

  distortionDry.gain.value = 1;
  distortionWet.gain.value = 0;
  distortionShaper.curve = makeSoftClipCurve(2.0);
  distortionShaper.oversample = '2x';

  distortionIn.connect(distortionDry);
  distortionIn.connect(distortionShaper);
  distortionShaper.connect(distortionWet);
  distortionDry.connect(distortionOut);
  distortionWet.connect(distortionOut);

  // ── COMPRESSOR (anti-duck core) ───────────────────────────────────
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -30;
  comp.knee.value = 0;
  comp.ratio.value = 20;
  comp.attack.value = 0.003;
  comp.release.value = 0.04;

  // ── MAKEUP GAIN ───────────────────────────────────────────────────
  const makeup = ctx.createGain();
  makeup.gain.value = Math.pow(10, 15 / 20);

  // ── LIMITER ───────────────────────────────────────────────────────
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.0;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.1;

  // ── SAFETY TRIM ───────────────────────────────────────────────────
  const safetyTrim = ctx.createGain();
  safetyTrim.gain.value = 0.89;

  // ── ANALYSER ──────────────────────────────────────────────────────
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.5;

  // ── MONITOR TAP ───────────────────────────────────────────────────
  const monitorGain = ctx.createGain();
  monitorGain.gain.value = 0;
  const mediaStreamDest = ctx.createMediaStreamDestination();

  // ── WIRING ────────────────────────────────────────────────────────
  // The music and mic branches are processed independently before mixing.
  sourceInput.connect(hpf);

  let prev = hpf;
  for (const band of eqBands) {
    prev.connect(band);
    prev = band;
  }
  prev.connect(bassShelf);
  bassShelf.connect(trebleShelf);
  trebleShelf.connect(distortionIn);
  distortionOut.connect(comp);
  comp.connect(makeup);
  makeup.connect(limiter);
  limiter.connect(mixBus);
  micInput.connect(micLimiter);
  micLimiter.connect(mixBus);
  mixBus.connect(safetyTrim);

  safetyTrim.connect(analyser);
  analyser.connect(ctx.destination);

  safetyTrim.connect(monitorGain);
  monitorGain.connect(mediaStreamDest);

  return {
    sourceInput,
    micInput,
    micLimiter,
    mixBus,
    hpf,
    eqBands,
    bassShelf,
    trebleShelf,
    distortionIn,
    distortionDry,
    distortionWet,
    distortionShaper,
    distortionOut,
    comp,
    makeup,
    limiter,
    safetyTrim,
    analyser,
    monitorGain,
    mediaStreamDest
  };
}

/**
 * Soft-clip waveshaper curve for the distortion effect.
 * @param {number} drive — 1.0 = gentle, 4.0 = heavy
 */
function makeSoftClipCurve(drive) {
  const n = 1024;
  const curve = new Float32Array(n);
  const k = drive;
  const tanhK = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = Math.tanh(k * x) / tanhK;
  }
  return curve;
}