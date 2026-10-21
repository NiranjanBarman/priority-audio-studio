#include "Limiter.h"
#include <cmath>
#include <algorithm>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static constexpr size_t MAX_LOOKAHEAD_FRAMES = 48000 / 10;  // 10 ms @ 48 kHz

// ── Lifecycle ──────────────────────────────────────────────────────────

void Limiter::prepare(double sampleRate, uint32_t channels, uint32_t maxFrames) {
    (void)maxFrames;  // Delay line is sized by look-ahead, not block size.
    sampleRate_ = sampleRate;
    channels_ = std::max<uint32_t>(1, std::min<uint32_t>(channels, 8));

    // Preallocate delay line at max look-ahead size (allocation only here).
    delayBuf_.assign(MAX_LOOKAHEAD_FRAMES * channels_, 0.0f);
    delayPos_ = 0;
    envelope_ = 1.0f;

    paramsDirty_.store(1, std::memory_order_release);
}

void Limiter::reset() {
    std::fill(delayBuf_.begin(), delayBuf_.end(), 0.0f);
    delayPos_ = 0;
    envelope_ = 1.0f;
    lastGrDb_.store(0.0f, std::memory_order_release);
}

// ── Toggles ────────────────────────────────────────────────────────────

void Limiter::setEnabled(bool on) noexcept {
    enabled_.store(on, std::memory_order_release);
    if (!on) {
        envelope_ = 1.0f;
        lastGrDb_.store(0.0f, std::memory_order_release);
    }
}

bool Limiter::enabled() const noexcept {
    return enabled_.load(std::memory_order_acquire);
}

// ── Parameters ─────────────────────────────────────────────────────────

void Limiter::setCeilingDb(float db) noexcept {
    const float clamped = std::max(-20.0f, std::min(0.0f, db));
    ceilingDb_.store(clamped, std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

void Limiter::setReleaseMs(float ms) noexcept {
    const float clamped = std::max(10.0f, std::min(500.0f, ms));
    releaseMs_.store(clamped, std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

void Limiter::setLookaheadMs(float ms) noexcept {
    const float clamped = std::max(0.0f, std::min(10.0f, ms));
    lookaheadMs_.store(clamped, std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

float Limiter::getCeilingDb() const noexcept {
    return ceilingDb_.load(std::memory_order_acquire);
}

float Limiter::getReleaseMs() const noexcept {
    return releaseMs_.load(std::memory_order_acquire);
}

float Limiter::getLookaheadMs() const noexcept {
    return lookaheadMs_.load(std::memory_order_acquire);
}

// ── Rebuild derived parameters ─────────────────────────────────────────
// Called on render thread when paramsDirty_ is set. Trig is fine — this
// runs only when the user changes a slider.

void Limiter::rebuildParams() {
    const float ceilingDb = ceilingDb_.load(std::memory_order_acquire);
    const float releaseMs = releaseMs_.load(std::memory_order_acquire);
    const float lookaheadMs = lookaheadMs_.load(std::memory_order_acquire);

    targetCeiling_ = std::pow(10.0f, ceilingDb / 20.0f);

    // Time constants for one-pole smoothing (per sample).
    // coef = 1 - exp(-1 / (tau * sampleRate))
    const double fs = sampleRate_;
    // Attack ~1 ms — smooths the sudden gain drop even with look-ahead.
    const double attackTau = 0.001;
    // Release = user-controlled
    const double releaseTau = double(releaseMs) / 1000.0;

    attackCoef_  = float(1.0 - std::exp(-1.0 / (attackTau * fs)));
    releaseCoef_ = float(1.0 - std::exp(-1.0 / (releaseTau * fs)));

    size_t laf = size_t(double(lookaheadMs) * fs / 1000.0);
    if (laf < 1) laf = 1;
    if (laf > MAX_LOOKAHEAD_FRAMES) laf = MAX_LOOKAHEAD_FRAMES;
    lookaheadFrames_ = laf;

    // If delay position is now outside the smaller look-ahead window,
    // wrap it in so old data isn't read.
    if (delayPos_ >= laf) delayPos_ = 0;
}

// ── Process ────────────────────────────────────────────────────────────

void Limiter::process(float* samples, uint32_t frames) noexcept {
    if (!enabled_.load(std::memory_order_acquire)) {
        lastGrDb_.store(0.0f, std::memory_order_release);
        return;
    }
    if (!samples || frames == 0 || channels_ == 0) return;

    // Rebuild if any parameter changed
    if (paramsDirty_.load(std::memory_order_acquire) != 0) {
        rebuildParams();
        paramsDirty_.store(0, std::memory_order_release);
    }

    const uint32_t ch = channels_;
    const size_t la = lookaheadFrames_;

    // Ensure buffer has at least `la * channels` entries.
    // delayBuf_ is preallocated at MAX_LOOKAHEAD_FRAMES.
    const size_t bufLenFrames = delayBuf_.size() / ch;

    // ── Per-sample loop ────────────────────────────────────────────────
    for (uint32_t f = 0; f < frames; ++f) {
        // 1. Peak of current (undelayed) frame
        float peak = 0.0f;
        for (uint32_t c = 0; c < ch; ++c) {
            const float a = std::fabs(samples[f * ch + c]);
            if (a > peak) peak = a;
        }

        // 2. Target gain for this frame
        float targetGain = 1.0f;
        if (peak > targetCeiling_) {
            targetGain = targetCeiling_ / peak;
        }

        // 3. Envelope follower — attack fast, release slow
        const float coef = (targetGain < envelope_) ? attackCoef_ : releaseCoef_;
        envelope_ += (targetGain - envelope_) * coef;

        // 4. Write current sample to delay line
        const size_t writeIdx = (delayPos_ % bufLenFrames) * ch;
        for (uint32_t c = 0; c < ch; ++c) {
            delayBuf_[writeIdx + c] = samples[f * ch + c];
        }

        // 5. Read delayed sample (L frames ago) and apply envelope
        //    Read position = (delayPos_ + bufLenFrames - la) % bufLenFrames
        const size_t readPosFrames = (delayPos_ + bufLenFrames - la) % bufLenFrames;
        const size_t readIdx = readPosFrames * ch;

        for (uint32_t c = 0; c < ch; ++c) {
            const float delayed = delayBuf_[readIdx + c];
            // Apply gain + hard ceiling clamp (belt-and-suspenders —
            // the envelope should already keep us under, but a digital
            // overshoot from round-off is possible at exactly ceiling).
            float out = delayed * envelope_;
            if (out > targetCeiling_)       out = targetCeiling_;
            else if (out < -targetCeiling_) out = -targetCeiling_;
            samples[f * ch + c] = out;
        }

        // 6. Advance delay position
        delayPos_ = (delayPos_ + 1) % bufLenFrames;
    }

    // Report gain reduction for the meter.
    const float grDb = 20.0f * std::log10(std::max(envelope_, 1e-6f));
    lastGrDb_.store(grDb, std::memory_order_release);
}

// ── Diagnostics ────────────────────────────────────────────────────────

float Limiter::currentGainReductionDb() const noexcept {
    return lastGrDb_.load(std::memory_order_acquire);
}