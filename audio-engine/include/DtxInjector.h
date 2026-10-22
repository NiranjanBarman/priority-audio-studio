#pragma once
#include <atomic>
#include <cstdint>
#include <vector>

// Generates a pink-noise bed at a fixed dBFS level and mixes it into the
// output so the game's VAD never sees "silence" during quiet passages.
// The render thread calls inject() once per block.
class DtxInjector {
public:
    DtxInjector();
    ~DtxInjector() = default;

    // Called once after construction (from engine init). Sample rate + channels.
    void prepare(double sampleRate, uint32_t channels);

    // Called from render thread. Adds the noise bed to `samples` (interleaved).
    void inject(float* samples, uint32_t frames) noexcept;

    // Thread-safe toggles — JS thread sets these.
    void setEnabled(bool enabled) noexcept;
    void setLevelDb(float db) noexcept;
    bool enabled() const noexcept;

private:
    std::atomic<bool> enabled_{true};
    std::atomic<float> levelLinear_{0.00178f};  // -55 dBFS

    double sampleRate_ = 48000.0;
    uint32_t channels_ = 2;
    std::vector<float> noiseBuffer_;            // mono pink noise, loops
    size_t readPos_ = 0;

    // Pink noise filter state (Paul Kellet)
    float b0_ = 0.0f, b1_ = 0.0f, b2_ = 0.0f, b3_ = 0.0f;
    float b4_ = 0.0f, b5_ = 0.0f, b6_ = 0.0f;

    void generateNoise();
};