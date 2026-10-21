#include "WasapiLoopback.h"
#include "Engine.h"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <vector>
#include <cstring>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "uuid.lib")

// ── Helper cast functions ────────────────────────────────────────────
static inline IMMDeviceEnumerator*  asEnumerator(void* p)    { return static_cast<IMMDeviceEnumerator*>(p); }
static inline IMMDevice*            asDevice(void* p)        { return static_cast<IMMDevice*>(p); }
static inline IAudioClient*         asAudioClient(void* p)   { return static_cast<IAudioClient*>(p); }
static inline IAudioCaptureClient*  asCaptureClient(void* p) { return static_cast<IAudioCaptureClient*>(p); }
static inline HANDLE                asEvent(void* p)         { return static_cast<HANDLE>(p); }

static std::wstring toWide(const std::string& s) {
    if (s.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring out(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &out[0], n);
    if (!out.empty() && out.back() == L'\0') out.pop_back();
    return out;
}

WasapiLoopback::WasapiLoopback() = default;

WasapiLoopback::~WasapiLoopback() {
    stop();

    if (mixFormat_)     { CoTaskMemFree(mixFormat_); mixFormat_ = nullptr; }
    if (captureClient_) { asCaptureClient(captureClient_)->Release(); captureClient_ = nullptr; }
    if (audioClient_)   { asAudioClient(audioClient_)->Release();     audioClient_ = nullptr; }
    if (device_)        { asDevice(device_)->Release();               device_ = nullptr; }
    if (enumerator_)    { asEnumerator(enumerator_)->Release();       enumerator_ = nullptr; }
    if (eventHandle_)   { CloseHandle(asEvent(eventHandle_));         eventHandle_ = nullptr; }
}

bool WasapiLoopback::init(Engine* engine, const std::string& deviceId, std::string& error) {
    engine_ = engine;

    IMMDeviceEnumerator* enumerator = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr,
                                  CLSCTX_ALL, IID_PPV_ARGS(&enumerator));
    if (FAILED(hr)) { error = "CoCreateInstance(MMDeviceEnumerator) failed"; return false; }
    enumerator_ = enumerator;

    IMMDevice* device = nullptr;
    if (deviceId.empty()) {
        hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    } else {
        hr = enumerator->GetDevice(toWide(deviceId).c_str(), &device);
    }
    if (FAILED(hr)) { error = "Loopback GetDevice failed"; return false; }
    device_ = device;

    IAudioClient* audioClient = nullptr;
    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                          (void**)&audioClient);
    if (FAILED(hr)) { error = "Loopback Activate(IAudioClient) failed"; return false; }
    audioClient_ = audioClient;

    WAVEFORMATEX* fmt = nullptr;
    hr = audioClient->GetMixFormat(&fmt);
    if (FAILED(hr)) { error = "Loopback GetMixFormat failed"; return false; }
    mixFormat_ = fmt;

    sampleRate_ = fmt->nSamplesPerSec;
    channels_ = fmt->nChannels;

    // Loopback requires AUDCLNT_STREAMFLAGS_LOOPBACK. Event callback drives
    // the capture thread. Duration must be 0 in shared mode for loopback.
    hr = audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        200000,  // 20ms
        0,
        fmt,
        nullptr
    );
    if (FAILED(hr)) {
        error = "Loopback Initialize failed (0x" + std::to_string((uint32_t)hr) + ")";
        return false;
    }

    IAudioCaptureClient* captureClient = nullptr;
    hr = audioClient->GetService(__uuidof(IAudioCaptureClient), (void**)&captureClient);
    if (FAILED(hr)) { error = "Loopback GetService(IAudioCaptureClient) failed"; return false; }
    captureClient_ = captureClient;

    HANDLE hEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (!hEvent) { error = "Loopback CreateEvent failed"; return false; }
    eventHandle_ = hEvent;

    hr = audioClient->SetEventHandle(hEvent);
    if (FAILED(hr)) { error = "Loopback SetEventHandle failed"; return false; }

    return true;
}

bool WasapiLoopback::start(std::string& error) {
    if (running_.load()) return true;
    HRESULT hr = asAudioClient(audioClient_)->Start();
    if (FAILED(hr)) { error = "Loopback Start failed"; return false; }

    shutdown_.store(false);
    running_.store(true);
    thread_ = std::thread(&WasapiLoopback::captureThreadLoop, this);
    return true;
}

void WasapiLoopback::stop() {
    if (!running_.load() && !shutdown_.load()) return;
    shutdown_.store(true);
    if (audioClient_) asAudioClient(audioClient_)->Stop();
    if (thread_.joinable()) thread_.join();
    running_.store(false);
}

uint64_t WasapiLoopback::totalFramesCaptured() const noexcept {
    return totalFrames_.load(std::memory_order_acquire);
}

void WasapiLoopback::captureThreadLoop() {
    // Real-time capture thread.
    IAudioCaptureClient* captureClient = asCaptureClient(captureClient_);
    HANDLE               hEvent        = asEvent(eventHandle_);

    std::vector<float> frameBuf;
    frameBuf.reserve(4096 * channels_);

    while (!shutdown_.load(std::memory_order_acquire)) {
        DWORD waitRes = WaitForSingleObject(hEvent, 100);
        if (shutdown_.load()) break;

        UINT32 packetFrames = 0;
        if (FAILED(captureClient->GetNextPacketSize(&packetFrames))) continue;

        while (packetFrames > 0) {
            BYTE* data = nullptr;
            UINT32 framesAvailable = 0;
            DWORD flags = 0;
            if (FAILED(captureClient->GetBuffer(&data, &framesAvailable, &flags,
                                                nullptr, nullptr))) {
                break;
            }

            const uint32_t ch = channels_;
            const uint32_t totalFloats = framesAvailable * ch;

            if (totalFloats > frameBuf.size()) frameBuf.resize(totalFloats);

            if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                std::memset(frameBuf.data(), 0, sizeof(float) * totalFloats);
            } else {
                std::memcpy(frameBuf.data(), data, sizeof(float) * totalFloats);
            }

            engine_->onLoopbackData(frameBuf.data(), framesAvailable);

            captureClient->ReleaseBuffer(framesAvailable);
            totalFrames_.fetch_add(framesAvailable, std::memory_order_relaxed);

            if (FAILED(captureClient->GetNextPacketSize(&packetFrames))) break;
        }
    }
}