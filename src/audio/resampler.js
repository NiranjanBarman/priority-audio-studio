/**
 * Resampler — sample-rate converter between two AudioContexts (or within one).
 *
 * MILESTONE: M3. Not used in M1 — M1 documents "user should set 48000 Hz in
 * Windows Sound" as a manual workaround.
 *
 * WHY AudioWorklet:
 *   Web Audio's AudioContext resamples at the browser level when two contexts
 *   with different sampleRates are connected. That resampling is opaque and
 *   can be disabled/broken in some Electron versions. An explicit resampler
 *   gives us control and diagnostics.
 *
 * ARCHITECTURE:
 *   inputNode → (AudioWorklet resampler) → outputNode
 *
 * The worklet is loaded from an inline Blob URL — no extra static file.
 */
const WORKLET_SOURCE = `
class ResamplerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ratio', defaultValue: 1.0, minValue: 0.5, maxValue: 2.0 }
    ];
  }
  constructor(options) {
    super();
    const opts = options.processorOptions || {};
    this.ratio = opts.ratio || 1.0;
    this.phase = 0;
    this.prevSample = 0;
    this.nextSample = 0;
    this._primed = false;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    const inputChannel = input[0];
    const outputChannel = output[0];
    if (!inputChannel || !outputChannel) return true;

    // parameter might be constant or per-sample
    const ratioArr = parameters.ratio;
    const ratio = ratioArr.length > 1 ? ratioArr[0] : this.ratio;

    // Linear interpolation resample
    // For each output sample, advance phase by (1/ratio) in input space.
    let inIdx = 0;
    const step = 1 / ratio;

    for (let outIdx = 0; outIdx < outputChannel.length; outIdx++) {
      const frac = this.phase;
      const i0 = Math.floor(inIdx + frac);
      const i1 = i0 + 1;
      const s0 = i0 < inputChannel.length ? inputChannel[i0] : inputChannel[inputChannel.length - 1];
      const s1 = i1 < inputChannel.length ? inputChannel[i1] : s0;
      const interp = s0 + (s1 - s0) * (frac - Math.floor(frac));
      outputChannel[outIdx] = interp;

      this.phase += step;
      while (this.phase >= 1) {
        this.phase -= 1;
        inIdx += 1;
      }
      if (inIdx >= inputChannel.length) {
        // underrun: hold last sample
        outputChannel[outIdx] = inputChannel[inputChannel.length - 1];
      }
    }
    return true;
  }
}
registerProcessor('resampler-processor', ResamplerProcessor);
`;

export class Resampler {
  /**
   * @param {AudioContext} ctx — the context this node lives in
   * @param {AudioNode} inputNode
   * @param {AudioNode} outputNode
   * @param {number} ratio — outputRate / inputRate (e.g. 48000/44100 ≈ 1.088)
   */
  constructor(ctx, inputNode, outputNode, ratio = 1.0) {
    this.ctx = ctx;
    this.inputNode = inputNode;
    this.outputNode = outputNode;
    this.ratio = ratio;
    this.node = null;
    this.blobUrl = null;
    this.ready = false;
    this._readyPromise = this._init();
  }

  async _init() {
    // Build a Blob URL for the worklet module — avoids needing a static file.
    const blob = new Blob([WORKLET_SOURCE], { type: 'application/javascript' });
    this.blobUrl = URL.createObjectURL(blob);

    try {
      await this.ctx.audioWorklet.addModule(this.blobUrl);
      this.node = new AudioWorkletNode(this.ctx, 'resampler-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
        processorOptions: { ratio: this.ratio }
      });

      this.inputNode.connect(this.node);
      this.node.connect(this.outputNode);
      this.ready = true;
    } catch (e) {
      // Fallback: pass-through (no resample)
      this.inputNode.connect(this.outputNode);
      this.ready = false;
      throw new Error(`AudioWorklet unavailable: ${e.message}. Using passthrough.`);
    } finally {
      if (this.blobUrl) {
        URL.revokeObjectURL(this.blobUrl);
        this.blobUrl = null;
      }
    }
  }

  async setRatio(ratio) {
    await this._readyPromise;
    this.ratio = Math.max(0.5, Math.min(2.0, Number(ratio) || 1.0));
    if (this.node) {
      this.node.parameters.get('ratio').setValueAtTime(this.ratio, this.ctx.currentTime);
    }
  }

  /** Auto-detect ratio from source and target contexts. */
  static autoRatio(sourceCtx, targetCtx) {
    return targetCtx.sampleRate / sourceCtx.sampleRate;
  }

  dispose() {
    try { this.node?.disconnect(); } catch { /* ok */ }
    try { this.inputNode.disconnect(this.node); } catch { /* ok */ }
    this.node = null;
  }
}