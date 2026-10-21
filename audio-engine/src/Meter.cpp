#include "Meter.h"
#include <cmath>
#include <chrono>

Meter::Meter() = default;

void Meter::measure(const float* samples, uint32_t frames, uint32_t channels) noexcept {
    float localPeak = 0.0f;
    const uint32_t count = frames * channels;
    for (uint32_t i = 0; i < count; ++i) {
        const float a = std::fabs(samples[i]);
        if (a > localPeak) localPeak = a;
    }

    // Atomic max via CAS loop
    float prev = peak_.load(std::memory_order_relaxed);
    while (localPeak > prev &&
           !peak_.compare_exchange_weak(prev, localPeak,
                                        std::memory_order_release,
                                        std::memory_order_relaxed)) {
        // prev updated by CAS
    }

    // Clip detection — 0.99 or higher triggers the LED
    if (localPeak >= 0.99f) {
        clipFlag_.store(true, std::memory_order_release);
        const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count();
        lastClipAt_.store(static_cast<uint64_t>(now), std::memory_order_release);
    }
}

float Meter::peak() const noexcept {
    return peak_.load(std::memory_order_acquire);
}

bool Meter::clip() const noexcept {
    if (!clipFlag_.load(std::memory_order_acquire)) return false;
    const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::steady_clock::now().time_since_epoch()).count();
    const auto last = lastClipAt_.load(std::memory_order_acquire);
    if (now - last > CLIP_HOLD_MS) {
        const_cast<Meter*>(this)->clipFlag_.store(false, std::memory_order_release);
        return false;
    }
    return true;
}

uint64_t Meter::dropouts() const noexcept {
    return dropouts_.load(std::memory_order_acquire);
}

void Meter::reset() noexcept {
    peak_.store(0.0f, std::memory_order_release);
    clipFlag_.store(false, std::memory_order_release);
    dropouts_.store(0, std::memory_order_release);
}

void Meter::countDropout() noexcept {
    dropouts_.fetch_add(1, std::memory_order_relaxed);
}