
export class MicCapture {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;
    this.stream = null;
    this.source = null;
    this.gainNode = null;
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
    this.gainNode.connect(this.dest);

    this.stream.getAudioTracks()[0].addEventListener('ended', () => this.stop());
    return this.stream;
  }

  setGain(v) {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(2, Number(v) || 0));
  }

  stop() {
    if (this.stream) this.stream.getTracks().forEach(t => t.stop());
    try { this.source?.disconnect(); } catch { /* ok */ }
    try { this.gainNode?.disconnect(); } catch { /* ok */ }
    this.stream = null;
    this.source = null;
    this.gainNode = null;
  }

  get active() { return !!this.stream; }
}