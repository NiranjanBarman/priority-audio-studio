#pragma once
#include <atomic>
#include <cstdint>

class Meter {
public:
    Meter();
    ~Meter() = default;

    // Called from render thread once per block.
    // samples = interleaved float, frames = number of frames, channels = 1 or 2
    void measure(const float* samples, uint32_t frames, uint32_t channels) noexcept;

    // Called from any thread — reads current peak (0..1) and clip flag.
    float peak() const noexcept;
    bool clip() const noexcept;
    uint64_t dropouts() const noexcept;
    void reset() noexcept;

    // Called when render thread detects an underrun (ring buffer empty).
    void countDropout() noexcept;

private:
    std::atomic<float> peak_{0.0f};
    std::atomic<bool> clipFlag_{false};
    std::atomic<uint64_t> dropouts_{0};
    std::atomic<uint64_t> lastClipAt_{0};   // ms
    static constexpr uint64_t CLIP_HOLD_MS = 1000;
};