#pragma once
#include <atomic>
#include <cstdint>

/**
 * Equalizer — 10-band biquad graphic EQ.
 *
 * BANDS (Hz): 31, 62, 125, 250, 500, 1k, 2k, 4k, 8k, 16k
 *   - 31 Hz  → low shelf
 *   - 16 kHz → high shelf
 *   - middle → peaking (Q=1.0)
 *
 * GAIN RANGE: -12..+12 dB per band.
 *
 * THREADING:
 *   - setBandGain() called from JS/main thread (atomic write to gains_).
 *   - process() called from render thread. On first call after a gain
 *     change, it recomputes coefficients on the audio thread (trig is
 *     expensive but happens rarely — only when the user moves a slider).
 *
 * COEFFICIENT FORMULA: RBJ Audio EQ Cookbook, Direct Form II Transposed.
 *   Chosen for numerical stability at low frequencies (31 Hz at 48 kHz
 *   has a very narrow bandwidth; other forms accumulate error).
 *
 * NO ALLOCATION at process time. All state is in the Biquad struct.
 */
class Equalizer {
public:
    static constexpr int NUM_BANDS = 10;
    static constexpr int MAX_CHANNELS = 8;

    Equalizer() = default;
    ~Equalizer() = default;

    Equalizer(const Equalizer&) = delete;
    Equalizer& operator=(const Equalizer&) = delete;

    // ── Lifecycle ───────────────────────────────────────────────────────
    // Called once after construction (from engine init).
    void prepare(double sampleRate, uint32_t channels);
    void reset();

    // ── Toggles ─────────────────────────────────────────────────────────
    void setEnabled(bool on) noexcept;
    bool enabled() const noexcept;

    // ── Gain control ────────────────────────────────────────────────────
    void setBandGain(int band, float db) noexcept;
    float getBandGain(int band) const noexcept;
    void setAllGains(const float* gainsDb) noexcept;
    void resetGains() noexcept;

    // ── Process ─────────────────────────────────────────────────────────
    // Processes interleaved float buffer IN PLACE.
    // Called from render thread. Real-time safe.
    void process(float* samples, uint32_t frames) noexcept;

private:
    struct Biquad {
        // Coefficients (normalized so a0 = 1)
        float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f;
        float a1 = 0.0f, a2 = 0.0f;

        // Per-channel state (Direct Form II Transposed)
        float z1[MAX_CHANNELS] = { 0.0f };
        float z2[MAX_CHANNELS] = { 0.0f };

        inline float processSample(float x, int ch) noexcept {
            const float y = b0 * x + z1[ch];
            z1[ch] = b1 * x - a1 * y + z2[ch];
            z2[ch] = b2 * x - a2 * y;
            return y;
        }

        void clearState() noexcept {
            for (int c = 0; c < MAX_CHANNELS; ++c) {
                z1[c] = 0.0f;
                z2[c] = 0.0f;
            }
        }
    };

    // Compute biquad coefficients for a given band + gain.
    void updateCoefficients(int band);

    double sampleRate_ = 48000.0;
    uint32_t channels_ = 2;

    std::atomic<bool> enabled_{ true };
    // Bit per band — set when a gain changes, cleared after coeff update.
    std::atomic<uint32_t> dirtyMask_{ 0xFFFFFFFFu };  // all dirty on init
    std::atomic<float> gains_[NUM_BANDS];

    Biquad bands_[NUM_BANDS];

    static constexpr float FREQS[NUM_BANDS] = {
        31.0f, 62.0f, 125.0f, 250.0f, 500.0f,
        1000.0f, 2000.0f, 4000.0f, 8000.0f, 16000.0f
    };
};