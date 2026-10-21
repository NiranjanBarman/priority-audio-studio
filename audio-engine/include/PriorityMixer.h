#pragma once
#include <cstdint>
#include <atomic>

// Mixes two sources (music + system loopback) with rank-based priority.
//
// RULES:
//   1. Music is rank 1 (highest).
//   2. System is rank 2.
//   3. Both play at their user-set gain.
//   4. If music + system would clip (>1.0), ONLY system ducks.
//      Music is NEVER scaled down. This is the anti-duck guarantee.
//   5. There is no code path that reduces music gain. Ever.
class PriorityMixer {
public:
    PriorityMixer() = default;
    ~PriorityMixer() = default;

    // Called from JS thread.
    void setMusicGain(float g) noexcept;
    void setSystemGain(float g) noexcept;
    void setSystemEnabled(bool enabled) noexcept;

    float musicGain() const noexcept;
    float systemGain() const noexcept;

    // Called from render thread.
    // music/system/output are interleaved float buffers of `frames*channels`.
    // Missing/empty buffers must be zeroed by caller.
    void mix(const float* music, const float* system, float* output,
             uint32_t frames, uint32_t channels) noexcept;

private:
    std::atomic<float> musicGain_{1.0f};
    std::atomic<float> systemGain_{1.0f};
    std::atomic<bool> systemEnabled_{true};
};