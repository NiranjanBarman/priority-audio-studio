#include "Compressor.h"
#include <cmath>
#include <algorithm>

// Epsilon to keep log() away from 0
static constexpr float PEAK_EPSILON = 1e-9f;

// ── Lifecycle ──────────────────────────────────────────────────────────

void Compressor::prepare(double sampleRate, uint32_t channels) {
    sampleRate_ = sampleRate;
    channels_ = std::max<uint32_t>(1, std::min<uint32_t>(channels, 8));

    envelope_ = 1.0f;
    lastGrDb_.store(0.0f, std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

void Compressor::reset() {
    envelope_ = 1.0f;
    lastGrDb_.store(0.0f, std::memory_order_release);
}

// ── Toggles ────────────────────────────────────────────────────────────

void Compressor::setEnabled(bool on) noexcept {
    enabled_.store(on, std::memory_order_release);
    if (!on) {
        envelope_ = 1.0f;
        lastGrDb_.store(0.0f, std::memory_order_release);
    }
}

bool Compressor::enabled() const noexcept {
    return enabled_.load(std::memory_order_acquire);
}

// ── Parameters ─────────────────────────────────────────────────────────

void Compressor::setThresholdDb(float db) noexcept {
    thresholdDb_.store(std::max(-60.0f, std::min(0.0f, db)),
                       std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

void Compressor::setRatio(float ratio) noexcept {
    ratio_.store(std::max(1.0f, std::min(30.0f, ratio)),
                 std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

void Compressor::setAttackMs(float ms) noexcept {
    attackMs_.store(std::max(0.1f, std::min(100.0f, ms)),
                    std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

void Compressor::setReleaseMs(float ms) noexcept {
    releaseMs_.store(std::max(5.0f, std::min(1000.0f, ms)),
                     std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

void Compressor::setKneeDb(float db) noexcept {
    kneeDb_.store(std::max(0.0f, std::min(24.0f, db)),
                  std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

void Compressor::setMakeupDb(float db) noexcept {
    makeupDb_.store(std::max(0.0f, std::min(24.0f, db)),
                    std::memory_order_release);
    paramsDirty_.store(1, std::memory_order_release);
}

float Compressor::getThresholdDb() const noexcept {
    return thresholdDb_.load(std::memory_order_acquire);
}
float Compressor::getRatio() const noexcept {
    return ratio_.load(std::memory_order_acquire);
}
float Compressor::getAttackMs() const noexcept {
    return attackMs_.load(std::memory_order_acquire);
}
float Compressor::getReleaseMs() const noexcept {
    return releaseMs_.load(std::memory_order_acquire);
}
float Compressor::getKneeDb() const noexcept {
    return kneeDb_.load(std::memory_order_acquire);
}
float Compressor::getMakeupDb() const noexcept {
    return makeupDb_.load(std::memory_order_acquire);
}

// ── Rebuild derived parameters ─────────────────────────────────────────
// Runs on render thread when paramsDirty_ is set. Trig is fine because
// this only fires when the user moves a slider.

void Compressor::rebuildParams() {
    const float threshDb  = thresholdDb_.load(std::memory_order_acquire);
    const float ratio     = ratio_.load(std::memory_order_acquire);
    const float attackMs  = attackMs_.load(std::memory_order_acquire);
    const float releaseMs = releaseMs_.load(std::memory_order_acquire);
    const float kneeDb    = kneeDb_.load(std::memory_order_acquire);
    const float makeupDb  = makeupDb_.load(std::memory_order_acquire);

    thresholdLin_  = std::pow(10.0f, threshDb / 20.0f);
    ratioMinus1_   = 1.0f - (1.0f / ratio);
    kneeLin_       = kneeDb;
    makeupLin_     = std::pow(10.0f, makeupDb / 20.0f);

    // One-pole smoothing coefficients. Same formula as Limiter.
    const double fs = sampleRate_;
    const double attackTau  = double(attackMs)  / 1000.0;
    const double releaseTau = double(releaseMs) / 1000.0;

    attackCoef_  = float(1.0 - std::exp(-1.0 / (attackTau  * fs)));
    releaseCoef_ = float(1.0 - std::exp(-1.0 / (releaseTau * fs)));
}

// ── Process ────────────────────────────────────────────────────────────
//
// Per-frame algorithm:
//   1. peak = max(|sample|) across channels of this frame
//   2. peakDb = 20*log10(peak)
//   3. Compute desired gain reduction in dB:
//        hard knee:  grDb = (peakDb - threshold) * (1 - 1/ratio)    if peakDb > threshold
//        soft knee:  quadratic blend in [threshold - knee/2, threshold + knee/2]
//   4. targetGain = 10^(-grDb/20)   (linear 0..1)
//   5. Smooth: attack if targetGain < envelope else release
//   6. Apply envelope + makeup to every channel
//
// STEREO LINKING:
//   peak is computed across ALL channels. One envelope. All channels get
//   the same gain. This is non-negotiable for music — otherwise a bass
//   hit on the left channel would make the right channel duck, shifting
//   the image. Web Audio's DynamicsCompressorNode is also stereo-linked.

void Compressor::process(float* samples, uint32_t frames) noexcept {
    if (!enabled_.load(std::memory_order_acquire)) {
        lastGrDb_.store(0.0f, std::memory_order_release);
        return;
    }
    if (!samples || frames == 0 || channels_ == 0) return;

    // Rebuild coefficients if any parameter changed
    if (paramsDirty_.load(std::memory_order_acquire) != 0) {
        rebuildParams();
        paramsDirty_.store(0, std::memory_order_release);
    }

    const uint32_t ch = channels_;
    const float threshDb  = thresholdDb_.load(std::memory_order_acquire);
    const float halfKnee  = kneeDb_.load(std::memory_order_acquire) * 0.5f;
    const float mk        = makeupLin_;

    for (uint32_t f = 0; f < frames; ++f) {
        // 1. Peak across channels
        float peak = 0.0f;
        for (uint32_t c = 0; c < ch; ++c) {
            const float a = std::fabs(samples[f * ch + c]);
            if (a > peak) peak = a;
        }

        // 2. Peak in dB (add epsilon to avoid log(0))
        const float peakDb = 20.0f * std::log10(peak + PEAK_EPSILON);

        // 3. Desired gain reduction in dB (positive = reduce)
        float grDb = 0.0f;
        if (peakDb > threshDb + halfKnee) {
            // Above the knee — full compression
            grDb = (peakDb - threshDb) * ratioMinus1_;
        } else if (halfKnee > 0.0f && peakDb > threshDb - halfKnee) {
            // Inside soft knee — quadratic blend
            // ref: Reiss & McPherson, "Audio Effects", eq 4.11
            const float x = peakDb - threshDb + halfKnee;
            grDb = ratioMinus1_ * (x * x) / (2.0f * (halfKnee * 2.0f));
        }
        // else: below knee → grDb stays 0

        // 4. Target linear gain
        float targetGain = 1.0f;
        if (grDb > 0.0f) {
            targetGain = std::pow(10.0f, -grDb / 20.0f);
        }

        // 5. Envelope follower — attack fast, release slow
        const float coef = (targetGain < envelope_) ? attackCoef_ : releaseCoef_;
        envelope_ += (targetGain - envelope_) * coef;

        // 6. Apply envelope + makeup to every channel
        const float appliedGain = envelope_ * mk;
        for (uint32_t c = 0; c < ch; ++c) {
            samples[f * ch + c] *= appliedGain;
        }
    }

    // Report gain reduction for the meter
    const float grDbNow = 20.0f * std::log10(std::max(envelope_, 1e-6f));
    lastGrDb_.store(grDbNow, std::memory_order_release);
}

// ── Diagnostics ────────────────────────────────────────────────────────

float Compressor::currentGainReductionDb() const noexcept {
    return lastGrDb_.load(std::memory_order_acquire);
}