#pragma once
#include <atomic>
#include <thread>
#include <cstdint>
#include <string>

// Same principle as WasapiRender.h: opaque void* for Windows/COM types.
// The .cpp file casts to actual types.

class Engine;

class WasapiLoopback {
public:
    WasapiLoopback();
    ~WasapiLoopback();

    WasapiLoopback(const WasapiLoopback&) = delete;
    WasapiLoopback& operator=(const WasapiLoopback&) = delete;

    bool init(Engine* engine, const std::string& deviceId, std::string& error);
    bool start(std::string& error);
    void stop();

    bool isRunning() const noexcept { return running_.load(); }

    uint32_t sampleRate() const noexcept { return sampleRate_; }
    uint32_t channels() const noexcept { return channels_; }

    uint64_t totalFramesCaptured() const noexcept;

private:
    void captureThreadLoop();

    Engine* engine_ = nullptr;
    std::thread thread_;
    std::atomic<bool> running_{false};
    std::atomic<bool> shutdown_{false};

    // ── Opaque Windows handles (all void*) ─────────────────────────────
    void* enumerator_    = nullptr;   // IMMDeviceEnumerator*
    void* device_        = nullptr;   // IMMDevice*
    void* audioClient_   = nullptr;   // IAudioClient*
    void* captureClient_ = nullptr;   // IAudioCaptureClient*
    void* mixFormat_     = nullptr;   // WAVEFORMATEX* (owned by CoTaskMem)
    void* eventHandle_   = nullptr;   // HANDLE

    uint32_t sampleRate_ = 0;
    uint32_t channels_ = 0;

    std::atomic<uint64_t> totalFrames_{0};
};