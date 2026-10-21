#pragma once
#include <atomic>
#include <cstdint>

/**
 * Compressor — feed-forward, stereo-linked, soft-knee compressor.
 *
 * WHY THIS EXISTS IN M3:
 *   The JS Web Audio chain (M1) uses DynamicsCompressorNode for the
 *   anti-duck chain. In M2/M3, once file playback flows through the
 *   native engine, we need the SAME compressor semantics in C++ so the
 *   "anti-duck" behavior is preserved on the native path.
 *
 * CHAIN POSITION (per spec):
 *   HPF → COMPRESSOR → MAKEUP → LIMITER → DTX → METER
 *
 *   Makeup is applied HERE (as a final gain multiply) rather than as a
 *   separate stage — same math, one fewer node, no behavioral change.
 *
 * PARAMETERS (matching the spec's anti-duck defaults):
 *   threshold  -30 dB      (signal above this gets compressed)
 *   ratio      20 : 1      (aggressive — spec says "loud priority")
 *   attack     3 ms        (fast enough to catch transients)
 *   release    40 ms       (fast enough to avoid audible pumping on music)
 *   knee       0 dB         (hard knee at threshold — spec calls it out)
 *   makeup     +15 dB       (brings crushed signal back up)
 *
 * DETECTION:
 *   Peak detection on the frame's max absolute sample across all
 *   channels. Stereo-linked: ONE envelope, same gain reduction applied
 *   to all channels. Per-channel envelopes would shift the stereo image
 *   when only one channel has a peak — unacceptable for music.
 *
 * IMPORTANT — NO AUTO-DUCKING:
 *   This compressor reduces gain based on the INPUT PEAK level, not
 *   based on any other source. It has NO knowledge of "other players
 *   talking". There is no sidechain input, no external detector. The
 *   only thing that can reduce music gain is the music itself crossing
 *   the threshold — which is exactly what the anti-duck chain wants.
 *
 * THREADING:
 *   - setXXX: JS/main thread. All atomic.
 *   - process(): render thread. No allocation, no locks, no I/O.
 *     Parameters are rebuilt lazily on the render thread via a dirty
 *     flag — same pattern as Limiter.
 */
class Compressor {
public:
    Compressor() = default;
    ~Compressor() = default;

    Compressor(const Compressor&) = delete;
    Compressor& operator=(const Compressor&) = delete;

    // ── Lifecycle ───────────────────────────────────────────────────────
    // Called once after construction (from engine init).
    void prepare(double sampleRate, uint32_t channels);
    void reset();

    // ── Toggles ─────────────────────────────────────────────────────────
    void setEnabled(bool on) noexcept;
    bool enabled() const noexcept;

    // ── Parameters ──────────────────────────────────────────────────────
    void setThresholdDb(float db) noexcept;   // -60 .. 0
    void setRatio(float ratio) noexcept;      // 1 .. 30
    void setAttackMs(float ms) noexcept;      // 0.1 .. 100
    void setReleaseMs(float ms) noexcept;     // 5 .. 1000
    void setKneeDb(float db) noexcept;        // 0 .. 24
    void setMakeupDb(float db) noexcept;      // 0 .. 24

    float getThresholdDb() const noexcept;
    float getRatio() const noexcept;
    float getAttackMs() const noexcept;
    float getReleaseMs() const noexcept;
    float getKneeDb() const noexcept;
    float getMakeupDb() const noexcept;

    // ── Process ─────────────────────────────────────────────────────────
    // In-place, interleaved float buffer. Real-time safe.
    void process(float* samples, uint32_t frames) noexcept;

    // ── Diagnostics ─────────────────────────────────────────────────────
    // Current gain reduction in dB (0 = no compression, -6 = 6 dB down).
    // Read from JS thread for a GR meter.
    float currentGainReductionDb() const noexcept;

private:
    void rebuildParams();

    double sampleRate_ = 48000.0;
    uint32_t channels_ = 2;

    // Config — atomic, set from JS thread
    std::atomic<bool>   enabled_{ true };
    std::atomic<float>  thresholdDb_{ -30.0f };
    std::atomic<float>  ratio_{ 20.0f };
    std::atomic<float>  attackMs_{ 3.0f };
    std::atomic<float>  releaseMs_{ 40.0f };
    std::atomic<float>  kneeDb_{ 0.0f };
    std::atomic<float>  makeupDb_{ 15.0f };
    std::atomic<uint32_t> paramsDirty_{ 1 };  // 1 = needs rebuild

    // Derived — rebuilt on paramsDirty_
    float thresholdLin_ = 0.0316f;   // 10^(-30/20)
    float ratioMinus1_ = 19.0f;      // 1 - 1/ratio, computed once
    float attackCoef_ = 0.021f;
    float releaseCoef_ = 0.00026f;
    float kneeLin_ = 0.0f;
    float makeupLin_ = 1.0f;

    // Envelope (linear gain multiplier, 0..1+)
    float envelope_ = 1.0f;

    // Diagnostics
    std::atomic<float> lastGrDb_{ 0.0f };
};