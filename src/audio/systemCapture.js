
export class SystemCapture {
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;
    this.stream = null;
    this.source = null;
    this.gainNode = null;
  }

  /**
   * Prompt the user to share their screen + system audio.
   * @returns {Promise<MediaStream>} the audio-only stream
   */
  async start() {
    if (this.stream) return this.stream;

    this.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 1 }, // required by Chromium; we discard it
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });

    const audioTracks = this.stream.getAudioTracks();
    if (audioTracks.length === 0) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      throw new Error(
        'No audio track captured. In the screen picker, choose "Entire Screen" ' +
        'and enable "Share system audio". On some Chromium builds this option ' +
        'is hidden unless Electron registers a display-media handler (M2 setup).'
      );
    }

    // We don't need video; kill it to save CPU.
    this.stream.getVideoTracks().forEach(t => t.stop());

    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.gainNode = this.ctx.createGain();
    this.gainNode.gain.value = 1.0;
    this.source.connect(this.gainNode);
    this.gainNode.connect(this.dest);

    // Auto-cleanup if the user stops sharing from the Chrome bar
    audioTracks[0].addEventListener('ended', () => this.stop());

    return this.stream;
  }

  setGain(v) {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, Number(v) || 0));
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