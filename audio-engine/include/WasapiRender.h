#pragma once
#include <atomic>
#include <thread>
#include <cstdint>
#include <string>

// All Windows/COM types are stored as void* in this header to avoid
// forward-declaration conflicts with Windows SDK typedefs. The .cpp file
// does the actual casting where the real Windows headers are available.
//
// The COM interfaces (IMMDevice*, IAudioClient*, etc.) and WAVEFORMATEX
// cannot be forward-declared safely — WAVEFORMATEX is a typedef, and the
// COM interfaces use MIDL_INTERFACE with __declspec(uuid(...)) which
// conflicts with a plain `struct Foo;` forward decl on MSVC.

class Engine;  // fwd

class WasapiRender {
public:
    WasapiRender();
    ~WasapiRender();

    WasapiRender(const WasapiRender&) = delete;
    WasapiRender& operator=(const WasapiRender&) = delete;

    /**
     * Open the given device (empty = default render endpoint) and
     * initialize shared-mode. Returns true on success; error string
     * filled on failure.
     */
    bool init(Engine* engine, const std::string& deviceId, std::string& error);

    bool start(std::string& error);
    void stop();

    bool isRunning() const noexcept { return running_.load(); }

    uint32_t bufferFrameCount() const noexcept { return bufferFrames_; }
    uint32_t sampleRate() const noexcept { return sampleRate_; }
    uint32_t channels() const noexcept { return channels_; }

    // Diagnostics
    uint64_t totalFramesRendered() const noexcept;
    uint64_t underruns() const noexcept;

private:
    void renderThreadLoop();

    Engine* engine_ = nullptr;
    std::thread thread_;
    std::atomic<bool> running_{false};
    std::atomic<bool> shutdown_{false};

    // ── Opaque Windows handles (all void*) ─────────────────────────────
    void* enumerator_   = nullptr;   // IMMDeviceEnumerator*
    void* device_       = nullptr;   // IMMDevice*
    void* audioClient_  = nullptr;   // IAudioClient*
    void* renderClient_ = nullptr;   // IAudioRenderClient*
    void* mixFormat_    = nullptr;   // WAVEFORMATEX* (owned by CoTaskMem)
    void* eventHandle_  = nullptr;   // HANDLE

    uint32_t bufferFrames_ = 0;
    uint32_t sampleRate_ = 0;
    uint32_t channels_ = 0;

    std::atomic<uint64_t> totalFrames_{0};
    std::atomic<uint64_t> underruns_{0};
};