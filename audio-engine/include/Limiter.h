#pragma once
#include <atomic>
#include <cstdint>
#include <vector>

/**
 * Limiter — look-ahead brickwall limiter.
 *
 * DESIGN:
 *   - Look-ahead: 3 ms default (144 samples @ 48 kHz). This gives the
 *     envelope enough time to smoothly reduce gain BEFORE a peak arrives
 *     at the output, avoiding the "pumping" that non-look-ahead limiters
 *     produce.
 *   - Attack: instant in effect (the delay line is the "attack" — the
 *     envelope has already dropped by the time the peak reaches output).
 *     A ~1 ms smoothing coefficient prevents harshness.
 *   - Release: exponential, 80 ms default.
 *   - Stereo-linked: single envelope, same gain applied to all channels.
 *     (Per-channel envelopes would distort the stereo image.)
 *
 * LATENCY:
 *   This limiter introduces `lookaheadMs` of latency. Combined with the
 *   WASAPI buffer that's ~5–25 ms total — inaudible for music playback,
 *   but the caller must NOT claim "zero latency."
 *
 * RATIONALE (spec):
 *   "Music ke loud hone se agar phate (distortion) to chalega — loud
 *   priority hai, clean secondary hai." This limiter allows aggressive
 *   makeup gain without producing digital clipping that would break
 *   the virtual microphone path to the game.
 *
 * THREADING:
 *   - setCeilingDb/setReleaseMs/setLookaheadMs: from JS/main thread.
 *   - process(): from render thread. Zero allocation, zero locks.
 *     The delay buffer is preallocated at prepare() time with the
 *     maximum look-ahead size.
 */
class Limiter {
public:
    Limiter() = default;
    ~Limiter() = default;

    Limiter(const Limiter&) = delete;
    Limiter& operator=(const Limiter&) = delete;

    // ── Lifecycle ───────────────────────────────────────────────────────
    // maxFrames = largest block size process() will ever be called with.
    // (Used to size internal scratch buffers, not the delay line.)
    void prepare(double sampleRate, uint32_t channels, uint32_t maxFrames);
    void reset();

    // ── Toggles ─────────────────────────────────────────────────────────
    void setEnabled(bool on) noexcept;
    bool enabled() const noexcept;

    // ── Parameters ──────────────────────────────────────────────────────
    void setCeilingDb(float db) noexcept;      // -20 .. 0
    void setReleaseMs(float ms) noexcept;      // 10 .. 500
    void setLookaheadMs(float ms) noexcept;    // 0 .. 10
    float getCeilingDb() const noexcept;
    float getReleaseMs() const noexcept;
    float getLookaheadMs() const noexcept;

    // ── Process ─────────────────────────────────────────────────────────
    // In-place processing of interleaved buffer. Real-time safe.
    void process(float* samples, uint32_t frames) noexcept;

    // ── Diagnostics ─────────────────────────────────────────────────────
    // Current gain reduction in dB (negative = attenuating).
    // Read from JS thread for GR meter.
    float currentGainReductionDb() const noexcept;

private:
    void rebuildParams();

    double sampleRate_ = 48000.0;
    uint32_t channels_ = 2;

    // Config (atomic — set from JS thread, read by render thread)
    std::atomic<bool> enabled_{ true };
    std::atomic<float> ceilingDb_{ -1.0f };
    std::atomic<float> releaseMs_{ 80.0f };
    std::atomic<float> lookaheadMs_{ 3.0f };
    std::atomic<uint32_t> paramsDirty_{ 1 };  // 1 = needs rebuild

    // Derived (rebuilt on paramsDirty_)
    float targetCeiling_ = 0.891f;      // -1 dBFS
    float attackCoef_ = 0.021f;
    float releaseCoef_ = 0.00026f;
    size_t lookaheadFrames_ = 144;      // 3 ms @ 48 kHz

    // Delay line (per-sample ring, interleaved)
    std::vector<float> delayBuf_;
    size_t delayPos_ = 0;

    // Envelope
    float envelope_ = 1.0f;

    // Diagnostics
    std::atomic<float> lastGrDb_{ 0.0f };
};