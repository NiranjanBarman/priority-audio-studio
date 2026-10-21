#pragma once
#include <atomic>
#include <cstdint>
#include <string>
#include <memory>
#include <mutex>
#include <cmath>

#include "RingBuffer.h"
#include "Meter.h"
#include "DtxInjector.h"
#include "PriorityMixer.h"
#include "Equalizer.h"
#include "Limiter.h"
#include "Compressor.h"

class WasapiRender;
class WasapiLoopback;

// Engine — top-level orchestrator for the native audio pipeline.
//
// PROCESSING CHAIN (per spec):
//   source → mixer → HPF(80Hz) → EQ(10-band) → Compressor → Limiter → DTX → Meter
//
//   - HPF removes sub-bass rumble so the compressor has headroom.
//   - EQ shapes the tone before compression (standard mastering order).
//   - Compressor enforces the anti-duck gain (20:1, -30 dB, 3/40 ms).
//   - Limiter brickwalls output at -1 dBFS.
//   - DTX injects -55 dBFS pink noise AFTER the limiter so VAD never
//     sees silence, and the DTX bed is never compressed/limited.
//   - Meter reads the final output that BlueStacks will receive.
//
// THREADS:
//   - JS/main thread:          init/start/stop/pushAudio/config/*
//   - WASAPI render thread:    renderBlock()
//   - WASAPI loopback thread:  onLoopbackData()
//
// REAL-TIME SAFETY:
//   renderBlock and onLoopbackData touch NO mutex, NO malloc, NO I/O.
class Engine {
public:
    Engine();
    ~Engine();

    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;

    // ── Lifecycle ───────────────────────────────────────────────────────
    bool init(uint32_t sampleRate, uint32_t channels, uint32_t bufferSize,
              const std::string& outputDeviceId,
              const std::string& loopbackDeviceId,
              std::string& error);

    bool start(std::string& error);
    void stop();
    void dispose();

    // ── Audio feed ──────────────────────────────────────────────────────
    void pushAudio(const float* samples, uint32_t frames);

    // ── Mixer config ────────────────────────────────────────────────────
    void setMusicGain(float gain);
    void setSystemGain(float gain);
    void setSystemEnabled(bool enabled);

    // ── DTX config ──────────────────────────────────────────────────────
    void setDtxEnabled(bool enabled);
    void setDtxLevelDb(float db);

    // ── EQ config (10-band) ─────────────────────────────────────────────
    void setEqEnabled(bool on);
    bool isEqEnabled() const;
    void setEqBandGain(int band, float db);
    float getEqBandGain(int band) const;
    void setEqAllGains(const float* gainsDb);
    void resetEqGains();

    // ── Compressor config ───────────────────────────────────────────────
    void setCompressorEnabled(bool on);
    bool isCompressorEnabled() const;
    void setCompressorThresholdDb(float db);
    void setCompressorRatio(float ratio);
    void setCompressorAttackMs(float ms);
    void setCompressorReleaseMs(float ms);
    void setCompressorKneeDb(float db);
    void setCompressorMakeupDb(float db);
    float getCompressorThresholdDb() const;
    float getCompressorRatio() const;
    float getCompressorAttackMs() const;
    float getCompressorReleaseMs() const;
    float getCompressorKneeDb() const;
    float getCompressorMakeupDb() const;
    float getCompressorGainReductionDb() const;

    // ── Limiter config ──────────────────────────────────────────────────
    void setLimiterEnabled(bool on);
    bool isLimiterEnabled() const;
    void setLimiterCeilingDb(float db);
    void setLimiterReleaseMs(float ms);
    void setLimiterLookaheadMs(float ms);
    float getLimiterCeilingDb() const;
    float getLimiterReleaseMs() const;
    float getLimiterLookaheadMs() const;
    float getLimiterGainReductionDb() const;

    // ── Diagnostics ─────────────────────────────────────────────────────
    float getPeak() const;
    bool getClip() const;
    uint64_t getDropouts() const;
    uint64_t getFramesRendered() const;
    uint64_t getLoopbackFrames() const;
    uint32_t getSampleRate() const;
    uint32_t getChannels() const;

    // ── Real-time callbacks ─────────────────────────────────────────────
    void renderBlock(uint32_t frames, float* out) noexcept;
    void onLoopbackData(const float* data, uint32_t frames) noexcept;

private:
    // Inline 80 Hz HPF — single biquad, stereo (or up to 8 ch) linked state.
    struct HpfBiquad {
        float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f, a1 = 0.0f, a2 = 0.0f;
        float z1[8] = { 0.0f };
        float z2[8] = { 0.0f };

        void prepare(double fs, float freqHz, float q) {
            const double w0 = 2.0 * 3.14159265358979323846 * freqHz / fs;
            const double cosw0 = std::cos(w0);
            const double sinw0 = std::sin(w0);
            const double alpha = sinw0 / (2.0 * q);
            const double b0d = (1.0 + cosw0) * 0.5;
            const double b1d = -(1.0 + cosw0);
            const double b2d = (1.0 + cosw0) * 0.5;
            const double a0d = 1.0 + alpha;
            const double a1d = -2.0 * cosw0;
            const double a2d = 1.0 - alpha;
            const double inv = 1.0 / a0d;
            b0 = float(b0d * inv);
            b1 = float(b1d * inv);
            b2 = float(b2d * inv);
            a1 = float(a1d * inv);
            a2 = float(a2d * inv);
        }

        void reset() {
            for (int c = 0; c < 8; ++c) { z1[c] = 0.0f; z2[c] = 0.0f; }
        }

        void process(float* samples, uint32_t frames, uint32_t ch) noexcept {
            for (uint32_t f = 0; f < frames; ++f) {
                const uint32_t base = f * ch;
                for (uint32_t c = 0; c < ch && c < 8; ++c) {
                    const float x = samples[base + c];
                    const float y = b0 * x + z1[c];
                    z1[c] = b1 * x - a1 * y + z2[c];
                    z2[c] = b2 * x - a2 * y;
                    samples[base + c] = y;
                }
            }
        }
    };

    // Config
    std::atomic<uint32_t> sampleRate_{48000};
    std::atomic<uint32_t> channels_{2};
    std::atomic<uint32_t> bufferSize_{512};

    // Ring buffers (SPSC)
    std::unique_ptr<RingBuffer> musicRing_;
    std::unique_ptr<RingBuffer> systemRing_;

    // DSP (all prepared once, called from render thread)
    PriorityMixer mixer_;
    DtxInjector dtx_;
    Meter meter_;
    Equalizer eq_;
    Compressor compressor_;
    Limiter limiter_;
    HpfBiquad hpf_;

    // WASAPI
    std::unique_ptr<WasapiRender> render_;
    std::unique_ptr<WasapiLoopback> loopback_;

    // Scratch buffers (render thread only)
    std::unique_ptr<float[]> musicScratch_;
    std::unique_ptr<float[]> systemScratch_;
    size_t scratchCapacity_ = 0;

    std::atomic<bool> initialized_{false};
    std::atomic<bool> running_{false};

    mutable std::mutex initMutex_;
};