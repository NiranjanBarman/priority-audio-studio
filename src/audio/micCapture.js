
export class MicCapture {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;
    this.stream = null;
    this.source = null;
    this.gainNode = null;
    this.effect = 'normal';
    this.targetGain = 1;

    this.lowFiShaper = ctx.createWaveShaper();
    this.lowFiShaper.curve = makeBitCrushCurve();
    this.lowFiShaper.oversample = 'none';

    this.lowFiLowpass = ctx.createBiquadFilter();
    this.lowFiLowpass.type = 'lowpass';
    this.lowFiLowpass.frequency.value = 2400;

    this.lowFiBass = ctx.createBiquadFilter();
    this.lowFiBass.type = 'lowshelf';
    this.lowFiBass.frequency.value = 140;
    this.lowFiBass.gain.value = 8;

    this.horrorLowpass = ctx.createBiquadFilter();
    this.horrorLowpass.type = 'lowpass';
    this.horrorLowpass.frequency.value = 1500;

    this.horrorDistortion = ctx.createWaveShaper();
    this.horrorDistortion.curve = makeDistortionCurve();
    this.horrorDistortion.oversample = '4x';

    this.horrorTremolo = ctx.createGain();
    this.horrorTremolo.gain.value = 0.78;
    this.horrorLfo = ctx.createOscillator();
    this.horrorLfo.type = 'sine';
    this.horrorLfo.frequency.value = 4.2;
    this.horrorLfoDepth = ctx.createGain();
    this.horrorLfoDepth.gain.value = 0.22;
    this.horrorLfo.connect(this.horrorLfoDepth);
    this.horrorLfoDepth.connect(this.horrorTremolo.gain);
    this.horrorLfoStarted = false;
  }

  /**
   * @param {string} deviceId — from enumerateDevices(); empty = default mic
   */
  async start(deviceId = '') {
    if (this.stream) this.stop();

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: false
      }
    });

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.gainNode = this.ctx.createGain();
    const now = this.ctx.currentTime;
    this.gainNode.gain.setValueAtTime(0, now);
    this.source.connect(this.gainNode);
    this._connectEffect();
    this.gainNode.gain.linearRampToValueAtTime(this.targetGain, now + 0.08);

    this.stream.getAudioTracks()[0].addEventListener('ended', () => this.stop());
    return this.stream;
  }

  setEffect(effectName) {
    if (!['normal', 'lowFiBass', 'horror'].includes(effectName)) {
      throw new TypeError(`Unsupported microphone effect: ${effectName}`);
    }
    this.effect = effectName;
    if (effectName === 'horror' && !this.horrorLfoStarted) {
      this.horrorLfo.start();
      this.horrorLfoStarted = true;
    }
    this._connectEffect();
  }

  _connectEffect() {
    if (!this.gainNode) return;

    this.gainNode.disconnect();
    this.lowFiShaper.disconnect();
    this.lowFiLowpass.disconnect();
    this.lowFiBass.disconnect();
    this.horrorLowpass.disconnect();
    this.horrorDistortion.disconnect();
    this.horrorTremolo.disconnect();

    if (this.effect === 'lowFiBass') {
      this.gainNode.connect(this.lowFiShaper);
      this.lowFiShaper.connect(this.lowFiBass);
      this.lowFiBass.connect(this.lowFiLowpass);
      this.lowFiLowpass.connect(this.dest);
    } else if (this.effect === 'horror') {
      this.gainNode.connect(this.horrorLowpass);
      this.horrorLowpass.connect(this.horrorDistortion);
      this.horrorDistortion.connect(this.horrorTremolo);
      this.horrorTremolo.connect(this.dest);
    } else {
      this.gainNode.connect(this.dest);
    }
  }

  setGain(v) {
    this.targetGain = Math.max(0, Math.min(2, Number(v) || 0));
    if (this.gainNode) this.gainNode.gain.value = this.targetGain;
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    try { this.source?.disconnect(); } catch { /* ok */ }
    try { this.gainNode?.disconnect(); } catch { /* ok */ }
    try { this.lowFiShaper.disconnect(); } catch { /* ok */ }
    try { this.lowFiLowpass.disconnect(); } catch { /* ok */ }
    try { this.lowFiBass.disconnect(); } catch { /* ok */ }
    try { this.horrorLowpass.disconnect(); } catch { /* ok */ }
    try { this.horrorDistortion.disconnect(); } catch { /* ok */ }
    try { this.horrorTremolo.disconnect(); } catch { /* ok */ }
    this.stream = null;
    this.source = null;
    this.gainNode = null;
  }

  dispose() {
    this.stop();
    if (this.horrorLfoStarted) {
      try { this.horrorLfo.stop(); } catch { /* already stopped */ }
    }
    try { this.horrorLfo.disconnect(); } catch { /* ok */ }
    try { this.horrorLfoDepth.disconnect(); } catch { /* ok */ }
  }

  get active() { return !!this.stream; }
}

function makeBitCrushCurve() {
  const samples = 2048;
  const levels = 32;
  const curve = new Float32Array(samples);

  for (let index = 0; index < samples; index += 1) {
    const input = (index * 2) / (samples - 1) - 1;
    curve[index] = (Math.round(((input + 1) / 2) * (levels - 1)) / (levels - 1)) * 2 - 1;
  }

  return curve;
}

function makeDistortionCurve() {
  const samples = 2048;
  const curve = new Float32Array(samples);
  const amount = 60;
  const normalization = Math.tanh(amount);

  for (let index = 0; index < samples; index += 1) {
    const input = (index * 2) / samples - 1;
    curve[index] = Math.tanh(amount * input) / normalization;
  }

  return curve;
}