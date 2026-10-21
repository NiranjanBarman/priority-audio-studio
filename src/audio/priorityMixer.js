/**
 * PriorityMixer — enforces source ranking so music always wins.
 *
 * MILESTONE: M2 (JS scaffold). M2's C++ engine ships PriorityMixer.h with
 * the same semantics at the audio-thread level.
 *
 * HOW PRIORITY WORKS:
 *   Each source has a rank (1 = highest). At any moment:
 *     - If solo is active on a source → only soloed sources are audible.
 *     - Otherwise → all unmuted sources audible, with their own gain.
 *     - Rank is NOT "duck the lower ranks" (that would be auto-ducking,
 *       forbidden by the spec). Rank is for *solo fallback order* and
 *       for the M2 C++ compressor to weight the mix when it detects
 *       near-clipping (music is trimmed last).
 *
 *   In M1 there's only one source (file), so the mixer is inert. Wired
 *   in M4 when Mixer.jsx gets source strips.
 */
export class PriorityMixer {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination — where the mixed output goes (sourceInput of main graph)
   */
  constructor(ctx, destination) {
    this.ctx = ctx;
    this.dest = destination;

    // key -> { rank, gainNode, muted, solo, level, label }
    this.sources = new Map();
    this._soloSet = new Set();
  }

  /**
   * Register a source.
   * @param {string} key — 'music' | 'system' | 'mic' (extensible)
   * @param {AudioNode} upstreamNode — the source's output node
   * @param {number} rank — 1 = highest priority
   * @param {string} label — display name
   */
  register(key, upstreamNode, rank, label = key) {
    if (this.sources.has(key)) return this.sources.get(key);

    const gainNode = this.ctx.createGain();
    gainNode.gain.value = 1.0;
    upstreamNode.connect(gainNode);
    gainNode.connect(this.dest);

    const entry = {
      rank,
      gainNode,
      upstreamNode,
      label,
      muted: false,
      solo: false,
      level: 1.0 // user-controlled gain before mute
    };
    this.sources.set(key, entry);
    this._recomputeGains();
    return entry;
  }

  unregister(key) {
    const e = this.sources.get(key);
    if (!e) return;
    try { e.upstreamNode.disconnect(e.gainNode); } catch { /* ok */ }
    try { e.gainNode.disconnect(); } catch { /* ok */ }
    this.sources.delete(key);
    this._soloSet.delete(key);
    this._recomputeGains();
  }

  setMute(key, muted) {
    const e = this.sources.get(key);
    if (!e) return;
    e.muted = !!muted;
    this._recomputeGains();
  }

  setSolo(key, solo) {
    const e = this.sources.get(key);
    if (!e) return;
    e.solo = !!solo;
    if (solo) this._soloSet.add(key);
    else this._soloSet.delete(key);
    this._recomputeGains();
  }

  /** Per-source user gain, 0..2 (allow slight boost). */
  setLevel(key, level) {
    const e = this.sources.get(key);
    if (!e) return;
    e.level = Math.max(0, Math.min(2, Number(level) || 0));
    this._recomputeGains();
  }

  /** Change a source's rank. Higher rank (lower number) wins solo fallback. */
  setRank(key, rank) {
    const e = this.sources.get(key);
    if (!e) return;
    e.rank = rank;
  }

  /**
   * Apply the effective gain to every source's gainNode.
   * Rule:
   *   - If any solo is active → sources not in _soloSet are 0.
   *   - Muted sources are always 0.
   *   - Otherwise → source gain = user level.
   */
  _recomputeGains() {
    const anySolo = this._soloSet.size > 0;

    for (const [key, e] of this.sources) {
      let effective = e.level;

      if (e.muted) effective = 0;
      else if (anySolo && !this._soloSet.has(key)) effective = 0;

      // Smooth ramp avoids clicks
      const now = this.ctx.currentTime;
      e.gainNode.gain.cancelScheduledValues(now);
      e.gainNode.gain.setTargetAtTime(effective, now, 0.005);
    }
  }

  /** Snapshot for the UI. */
  getState() {
    const out = {};
    for (const [key, e] of this.sources) {
      out[key] = {
        rank: e.rank,
        label: e.label,
        muted: e.muted,
        solo: e.solo,
        level: e.level
      };
    }
    return out;
  }

  dispose() {
    for (const key of [...this.sources.keys()]) this.unregister(key);
  }
}