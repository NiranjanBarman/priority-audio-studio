#include "DtxInjector.h"
#include <cmath>
#include <random>

DtxInjector::DtxInjector() = default;

void DtxInjector::prepare(double sampleRate, uint32_t channels) {
    sampleRate_ = sampleRate;
    channels_ = channels;
    generateNoise();
    readPos_ = 0;
}

void DtxInjector::generateNoise() {
    // 2-second pink-noise buffer, normalized to RMS 1.0
    const size_t len = static_cast<size_t>(sampleRate_ * 2.0);
    noiseBuffer_.resize(len);

    std::mt19937 rng(1337);
    std::uniform_real_distribution<float> dist(-1.0f, 1.0f);

    float b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (size_t i = 0; i < len; ++i) {
        const float white = dist(rng);
        b0 = 0.99886f * b0 + white * 0.0555179f;
        b1 = 0.99332f * b1 + white * 0.0750759f;
        b2 = 0.96900f * b2 + white * 0.1538520f;
        b3 = 0.86650f * b3 + white * 0.3104856f;
        b4 = 0.55000f * b4 + white * 0.5329522f;
        b5 = -0.7616f * b5 - white * 0.0168980f;
        const float pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362f;
        b6 = white * 0.115926f;
        noiseBuffer_[i] = pink * 0.11f;
    }

    // Normalize RMS to 1.0
    double sumSq = 0.0;
    for (float s : noiseBuffer_) sumSq += double(s) * s;
    const double rms = std::sqrt(sumSq / double(len));
    if (rms > 1e-9) {
        const float scale = float(1.0 / rms);
        for (float& s : noiseBuffer_) s *= scale;
    }
}

void DtxInjector::inject(float* samples, uint32_t frames) noexcept {
    if (!enabled_.load(std::memory_order_acquire)) return;
    const float level = levelLinear_.load(std::memory_order_relaxed);
    const size_t bufLen = noiseBuffer_.size();
    if (bufLen == 0) return;

    size_t pos = readPos_;
    for (uint32_t f = 0; f < frames; ++f) {
        const float n = noiseBuffer_[pos] * level;
        if (channels_ == 2) {
            samples[f * 2 + 0] += n;
            samples[f * 2 + 1] += n;
        } else {
            samples[f] += n;
        }
        if (++pos >= bufLen) pos = 0;
    }
    readPos_ = pos;
}

void DtxInjector::setEnabled(bool enabled) noexcept {
    enabled_.store(enabled, std::memory_order_release);
}

void DtxInjector::setLevelDb(float db) noexcept {
    // Clamp to a sane range — DTX should be very quiet
    if (db < -80.0f) db = -80.0f;
    if (db > -30.0f) db = -30.0f;
    levelLinear_.store(std::pow(10.0f, db / 20.0f), std::memory_order_release);
}

bool DtxInjector::enabled() const noexcept {
    return enabled_.load(std::memory_order_acquire);
}