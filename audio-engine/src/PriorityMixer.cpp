#include "PriorityMixer.h"
#include <algorithm>
#include <cmath>

void PriorityMixer::setMusicGain(float g) noexcept {
    musicGain_.store(std::clamp(g, 0.0f, 2.0f), std::memory_order_release);
}

void PriorityMixer::setSystemGain(float g) noexcept {
    systemGain_.store(std::clamp(g, 0.0f, 2.0f), std::memory_order_release);
}

void PriorityMixer::setSystemEnabled(bool enabled) noexcept {
    systemEnabled_.store(enabled, std::memory_order_release);
}

float PriorityMixer::musicGain() const noexcept {
    return musicGain_.load(std::memory_order_acquire);
}

float PriorityMixer::systemGain() const noexcept {
    return systemGain_.load(std::memory_order_acquire);
}

void PriorityMixer::mix(const float* music, const float* system, float* output,
                        uint32_t frames, uint32_t channels) noexcept {
    const float mg = musicGain_.load(std::memory_order_acquire);
    const float sg = systemEnabled_.load(std::memory_order_acquire)
                     ? systemGain_.load(std::memory_order_acquire)
                     : 0.0f;

    const uint32_t count = frames * channels;
    for (uint32_t i = 0; i < count; ++i) {
        // Music plays at its full gain — NO ducking possible.
        // There is no code path that reduces `m` based on `s` or any
        // other source. This is the anti-duck guarantee at the mixing
        // layer.
        const float m = music ? music[i] * mg : 0.0f;

        // System (loopback) plays at its own gain.
        float s = system ? system[i] * sg : 0.0f;

        // PRIORITY ENFORCEMENT:
        // If music + system would exceed ±1.0 full scale, duck ONLY the
        // system. Music is never scaled. This is not auto-ducking: no
        // sidechain, no gain reduction on music, ever.
        //
        // HEADROOM CLAMP (m3 fix):
        // When |m| >= 1.0, headroom is zero or negative. A negative
        // headroom would flip the polarity of `s` and add it on top of
        // music (m + (-|headroom|) = m - |headroom|), creating audible
        // artifacts. Clamping to 0 means: if music already fills the
        // range, system gets zero contribution. Music wins absolutely.
        const float sum = m + s;
        if (std::fabs(sum) > 1.0f) {
            const float headroom = std::max(0.0f, 1.0f - std::fabs(m));
            const float absS = std::fabs(s);
            if (absS > headroom) {
                s = (s >= 0.0f ? headroom : -headroom);
            }
        }

        output[i] = m + s;
    }
}