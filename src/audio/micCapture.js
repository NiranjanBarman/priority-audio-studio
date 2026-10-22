
export class MicCapture {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;
    this.stream = null;
    this.source = null;
    this.gainNode = null;
    this.effect = 'normal';

    this.distortion = ctx.createWaveShaper();
    this.distortion.curve = makeDistortionCurve();
    this.distortion.oversample = '4x';

    this.radioHighpass = ctx.createBiquadFilter();
    this.radioHighpass.type = 'highpass';
    this.radioHighpass.frequency.value = 300;

    this.radioBandpass = ctx.createBiquadFilter();
    this.radioBandpass.type = 'bandpass';
    this.radioBandpass.frequency.value = 1650;
    this.radioBandpass.Q.value = 0.7;

    this.radioLowpass = ctx.createBiquadFilter();
    this.radioLowpass.type = 'lowpass';
    this.radioLowpass.frequency.value = 3000;
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
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 1.0;
    this.source.connect(this.gainNode);
    this._connectEffect();

    this.stream.getAudioTracks()[0].addEventListener('ended', () => this.stop());
    return this.stream;
  }

  setEffect(effectName) {
    if (!['normal', 'distorted', 'radio'].includes(effectName)) {
      throw new TypeError(`Unsupported microphone effect: ${effectName}`);
    }
    this.effect = effectName;
    this._connectEffect();
  }

  _connectEffect() {
    if (!this.gainNode) return;

    this.gainNode.disconnect();
    this.distortion.disconnect();
    this.radioHighpass.disconnect();
    this.radioBandpass.disconnect();
    this.radioLowpass.disconnect();

    if (this.effect === 'distorted') {
      this.gainNode.connect(this.distortion);
      this.distortion.connect(this.dest);
    } else if (this.effect === 'radio') {
      this.gainNode.connect(this.radioHighpass);
      this.radioHighpass.connect(this.radioBandpass);
      this.radioBandpass.connect(this.radioLowpass);
      this.radioLowpass.connect(this.dest);
    } else {
      this.gainNode.connect(this.dest);
    }
  }

  setGain(v) {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(2, Number(v) || 0));
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    try { this.source?.disconnect(); } catch { /* ok */ }
    try { this.gainNode?.disconnect(); } catch { /* ok */ }
    try { this.distortion.disconnect(); } catch { /* ok */ }
    try { this.radioHighpass.disconnect(); } catch { /* ok */ }
    try { this.radioBandpass.disconnect(); } catch { /* ok */ }
    try { this.radioLowpass.disconnect(); } catch { /* ok */ }
    this.stream = null;
    this.source = null;
    this.gainNode = null;
  }

  get active() { return !!this.stream; }
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