#include "Equalizer.h"
#include <cmath>
#include <algorithm>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

// ── Lifecycle ──────────────────────────────────────────────────────────

void Equalizer::prepare(double sampleRate, uint32_t channels) {
    sampleRate_ = sampleRate;
    channels_ = std::min<uint32_t>(channels, MAX_CHANNELS);

    for (int b = 0; b < NUM_BANDS; ++b) {
        gains_[b].store(0.0f, std::memory_order_relaxed);
        bands_[b].clearState();
    }
    // All bands need coefficient computation (flat gains → unity pass)
    dirtyMask_.store(0xFFFFFFFFu, std::memory_order_release);
    enabled_.store(true, std::memory_order_release);
}

void Equalizer::reset() {
    for (int b = 0; b < NUM_BANDS; ++b) {
        bands_[b].clearState();
    }
}

// ── Toggles ────────────────────────────────────────────────────────────

void Equalizer::setEnabled(bool on) noexcept {
    enabled_.store(on, std::memory_order_release);
}

bool Equalizer::enabled() const noexcept {
    return enabled_.load(std::memory_order_acquire);
}

// ── Gain control ───────────────────────────────────────────────────────

void Equalizer::setBandGain(int band, float db) noexcept {
    if (band < 0 || band >= NUM_BANDS) return;
    const float clamped = std::max(-12.0f, std::min(12.0f, db));
    gains_[band].store(clamped, std::memory_order_release);
    // Mark dirty — render thread recomputes coefficients on next process().
    dirtyMask_.fetch_or(1u << band, std::memory_order_release);
}

float Equalizer::getBandGain(int band) const noexcept {
    if (band < 0 || band >= NUM_BANDS) return 0.0f;
    return gains_[band].load(std::memory_order_acquire);
}

void Equalizer::setAllGains(const float* gainsDb) noexcept {
    if (!gainsDb) return;
    for (int b = 0; b < NUM_BANDS; ++b) {
        setBandGain(b, gainsDb[b]);
    }
}

void Equalizer::resetGains() noexcept {
    for (int b = 0; b < NUM_BANDS; ++b) {
        gains_[b].store(0.0f, std::memory_order_release);
    }
    dirtyMask_.store(0xFFFFFFFFu, std::memory_order_release);
}

// ── Coefficient computation (RBJ cookbook) ─────────────────────────────
// Runs on the render thread when a dirty bit is detected. Trig here is
// expensive but only happens once per gain change per band.

void Equalizer::updateCoefficients(int band) {
    const float db = gains_[band].load(std::memory_order_acquire);
    Biquad& bq = bands_[band];

    // Unity gain shortcut — flat band is exactly transparent.
    if (std::fabs(db) < 0.01f) {
        bq.b0 = 1.0f; bq.b1 = 0.0f; bq.b2 = 0.0f;
        bq.a1 = 0.0f; bq.a2 = 0.0f;
        return;
    }

    const double fs = sampleRate_;
    const double f0 = FREQS[band];
    const double w0 = 2.0 * M_PI * f0 / fs;
    const double cosw0 = std::cos(w0);
    const double sinw0 = std::sin(w0);

    // A = 10^(dBgain/40) — amplitude ratio for shelving/peaking
    const double A = std::pow(10.0, db / 40.0);

    double b0, b1, b2, a0, a1, a2;

    if (band == 0) {
        // LOW SHELF — RBJ cookbook
        // Q here is shelf slope. We use 0.707 (Butterworth-like).
        const double alpha = sinw0 / 2.0 * std::sqrt((A + 1.0 / A) * (1.0 / 0.707 + -1.0) + 2.0);
        // Note: 1/0.707 ≈ 1.414, minus 1 → 0.414. Alpha is small at low freq.

        const double sqrtA2alpha = 2.0 * std::sqrt(A) * alpha;

        b0 = A * ((A + 1.0) - (A - 1.0) * cosw0 + sqrtA2alpha);
        b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cosw0);
        b2 = A * ((A + 1.0) - (A - 1.0) * cosw0 - sqrtA2alpha);
        a0 = (A + 1.0) + (A - 1.0) * cosw0 + sqrtA2alpha;
        a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cosw0);
        a2 = (A + 1.0) + (A - 1.0) * cosw0 - sqrtA2alpha;
    } else if (band == NUM_BANDS - 1) {
        // HIGH SHELF — RBJ cookbook
        const double alpha = sinw0 / 2.0 * std::sqrt((A + 1.0 / A) * (1.0 / 0.707 + -1.0) + 2.0);
        const double sqrtA2alpha = 2.0 * std::sqrt(A) * alpha;

        b0 = A * ((A + 1.0) + (A - 1.0) * cosw0 + sqrtA2alpha);
        b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cosw0);
        b2 = A * ((A + 1.0) + (A - 1.0) * cosw0 - sqrtA2alpha);
        a0 = (A + 1.0) - (A - 1.0) * cosw0 + sqrtA2alpha;
        a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cosw0);
        a2 = (A + 1.0) - (A - 1.0) * cosw0 - sqrtA2alpha;
    } else {
        // PEAKING EQ — RBJ cookbook
        const double Q = 1.0;
        const double alpha = sinw0 / (2.0 * Q);

        b0 = 1.0 + alpha * A;
        b1 = -2.0 * cosw0;
        b2 = 1.0 - alpha * A;
        a0 = 1.0 + alpha / A;
        a1 = -2.0 * cosw0;
        a2 = 1.0 - alpha / A;
    }

    // Normalize so a0 == 1
    const double inv_a0 = 1.0 / a0;
    bq.b0 = float(b0 * inv_a0);
    bq.b1 = float(b1 * inv_a0);
    bq.b2 = float(b2 * inv_a0);
    bq.a1 = float(a1 * inv_a0);
    bq.a2 = float(a2 * inv_a0);
}

// ── Process ────────────────────────────────────────────────────────────

void Equalizer::process(float* samples, uint32_t frames) noexcept {
    if (!enabled_.load(std::memory_order_acquire)) return;
    if (!samples || frames == 0) return;

    // Check for pending coefficient updates. Runs at most once per block
    // per changed band.
    uint32_t dirty = dirtyMask_.load(std::memory_order_acquire);
    if (dirty != 0) {
        for (int b = 0; b < NUM_BANDS; ++b) {
            if (dirty & (1u << b)) {
                updateCoefficients(b);
                dirtyMask_.fetch_and(~(1u << b), std::memory_order_release);
            }
        }
    }

    const uint32_t ch = channels_;

    // Main processing: cascade all 10 bands per sample, per channel.
    // The order of band processing doesn't matter (biquads are LTI and
    // independent), but we go low→high to mirror the UI layout.
    for (uint32_t f = 0; f < frames; ++f) {
        for (uint32_t c = 0; c < ch; ++c) {
            float x = samples[f * ch + c];
            for (int b = 0; b < NUM_BANDS; ++b) {
                x = bands_[b].processSample(x, int(c));
            }
            samples[f * ch + c] = x;
        }
    }
}