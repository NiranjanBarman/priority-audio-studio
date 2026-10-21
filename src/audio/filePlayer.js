/**
 * File playback via <audio> element + MediaElementSourceNode.
 *
 * WHY <audio> AND NOT decodeAudioData():
 *   - decodeAudioData holds the entire decoded PCM in RAM. A 5-minute
 *     FLAC becomes ~150 MB of Float32Array. <audio> streams.
 *   - <audio> supports seek/pause/duration natively.
 *
 * CRITICAL GOTCHA:
 *   When you call ctx.createMediaElementSource(el), the element's output
 *   is REROUTED into the Web Audio graph. The element no longer plays to
 *   speakers directly — you MUST wire it into the graph.
 */
export class FilePlayer {
  constructor(ctx, destination, onState) {
    this.ctx = ctx;
    this.dest = destination;
    this.onState = onState;

    this.audioEl = new Audio();
    this.audioEl.preload = 'auto';

    // Per-source gain. User's "Volume" slider lives here.
    this.gainNode = ctx.createGain();
    this.gainNode.gain.value = 0.8;
    this.gainNode.connect(destination);

    this.srcNode = null;
    this._wired = false;
    this.currentUrl = null;

    // ── Element event wiring ────────────────────────────────────────
    this.audioEl.addEventListener('timeupdate', () => {
      this.onState({
        currentTime: this.audioEl.currentTime || 0,
        duration: isFinite(this.audioEl.duration) ? this.audioEl.duration : 0
      });
    });

    this.audioEl.addEventListener('ended', () => {
      this.onState({ playing: false });
    });

    this.audioEl.addEventListener('error', () => {
      const code = this.audioEl.error?.code;
      const msg =
        code === 1 ? 'Playback aborted by user'
        : code === 2 ? 'Network error while loading file'
        : code === 3 ? 'Decode error — unsupported or corrupt file'
        : code === 4 ? 'Format not supported by this Chromium build'
        : 'Unknown playback error';
      this.onState({ playing: false, error: msg });
    });
  }

  /** Wire the <audio> element into the Web Audio graph. Runs once. */
  _wire() {
    if (this._wired) return;
    this.srcNode = this.ctx.createMediaElementSource(this.audioEl);
    this.srcNode.connect(this.gainNode);
    this._wired = true;
  }

  /**
   * Load a new File object.
   * @param {File} file — from an <input type="file">
   */
  async load(file) {
    this.stop();
    if (this.currentUrl) {
      URL.revokeObjectURL(this.currentUrl);
      this.currentUrl = null;
    }

    this.currentUrl = URL.createObjectURL(file);
    this.audioEl.src = this.currentUrl;
    this._wire();

    this.onState({
      currentTrack: { name: file.name, size: file.size, type: file.type },
      currentTime: 0,
      duration: 0,
      error: null
    });
  }

  async play() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.audioEl.play();
    this.onState({ playing: true, error: null });
  }

  pause() {
    this.audioEl.pause();
    this.onState({ playing: false });
  }

  stop() {
    this.audioEl.pause();
    try { this.audioEl.currentTime = 0; } catch { /* not yet ready */ }
    this.onState({ playing: false, currentTime: 0 });
  }

  seek(seconds) {
    if (!isFinite(seconds)) return;
    const dur = isFinite(this.audioEl.duration) ? this.audioEl.duration : 0;
    const clamped = Math.max(0, Math.min(dur || seconds, seconds));
    this.audioEl.currentTime = clamped;
  }

  setVolume(v) {
    const clamped = Math.max(0, Math.min(1, v));
    this.gainNode.gain.value = clamped;
  }

  /** Clean shutdown — revoke blob URLs so they don't leak. */
  dispose() {
    this.stop();
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = null;
    if (this.srcNode) {
      try { this.srcNode.disconnect(); } catch { /* ok */ }
      this.srcNode = null;
    }
    try { this.gainNode.disconnect(); } catch { /* ok */ }
    this._wired = false;
  }
}