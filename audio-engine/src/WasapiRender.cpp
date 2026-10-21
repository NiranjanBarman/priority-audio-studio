#include "WasapiRender.h"
#include "Engine.h"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <wrl/client.h>
#include <vector>
#include <cstring>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "uuid.lib")

using Microsoft::WRL::ComPtr;

// ── Helper cast functions ────────────────────────────────────────────
// All opaque void* handles are cast here so the rest of the file can
// use proper Windows types.
static inline IMMDeviceEnumerator*  asEnumerator(void* p)    { return static_cast<IMMDeviceEnumerator*>(p); }
static inline IMMDevice*            asDevice(void* p)        { return static_cast<IMMDevice*>(p); }
static inline IAudioClient*         asAudioClient(void* p)   { return static_cast<IAudioClient*>(p); }
static inline IAudioRenderClient*   asRenderClient(void* p)  { return static_cast<IAudioRenderClient*>(p); }
static inline WAVEFORMATEX*         asMixFormat(void* p)     { return static_cast<WAVEFORMATEX*>(p); }
static inline HANDLE                asEvent(void* p)         { return static_cast<HANDLE>(p); }

// Convert UTF-8 std::string to wide string for WASAPI APIs
static std::wstring toWide(const std::string& s) {
    if (s.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
    std::wstring out(n, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, &out[0], n);
    if (!out.empty() && out.back() == L'\0') out.pop_back();
    return out;
}

WasapiRender::WasapiRender() = default;

WasapiRender::~WasapiRender() {
    stop();

    if (mixFormat_)   { CoTaskMemFree(mixFormat_); mixFormat_ = nullptr; }
    if (renderClient_){ asRenderClient(renderClient_)->Release(); renderClient_ = nullptr; }
    if (audioClient_) { asAudioClient(audioClient_)->Release();  audioClient_ = nullptr; }
    if (device_)      { asDevice(device_)->Release();            device_ = nullptr; }
    if (enumerator_)  { asEnumerator(enumerator_)->Release();    enumerator_ = nullptr; }
    if (eventHandle_) { CloseHandle(asEvent(eventHandle_));      eventHandle_ = nullptr; }
}

bool WasapiRender::init(Engine* engine, const std::string& deviceId, std::string& error) {
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
    if (FAILED(hr)) { error = "GetDevice failed — check device ID"; return false; }
    device_ = device;

    IAudioClient* audioClient = nullptr;
    hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                          (void**)&audioClient);
    if (FAILED(hr)) { error = "Activate(IAudioClient) failed"; return false; }
    audioClient_ = audioClient;

    WAVEFORMATEX* fmt = nullptr;
    hr = audioClient->GetMixFormat(&fmt);
    if (FAILED(hr)) { error = "GetMixFormat failed"; return false; }
    mixFormat_ = fmt;

    // We require 32-bit float format (WASAPI shared mode default on modern Windows)
    if (fmt->wFormatTag != WAVE_FORMAT_EXTENSIBLE) {
        error = "Unexpected mix format (not WAVE_FORMAT_EXTENSIBLE)";
        return false;
    }
    WAVEFORMATEXTENSIBLE* ext = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(fmt);
    if (ext->SubFormat != KSDATAFORMAT_SUBTYPE_IEEE_FLOAT) {
        error = "Mix format is not IEEE float — please set CABLE Input to 24-bit/32-bit float";
        return false;
    }

    sampleRate_ = fmt->nSamplesPerSec;
    channels_ = fmt->nChannels;

    // 20ms shared-mode buffer
    REFERENCE_TIME bufferDuration = 200000;  // 100ns units → 20ms

    hr = audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
        bufferDuration,
        0,
        fmt,
        nullptr
    );
    if (FAILED(hr)) { error = "IAudioClient::Initialize failed"; return false; }

    hr = audioClient->GetBufferSize(&bufferFrames_);
    if (FAILED(hr)) { error = "GetBufferSize failed"; return false; }

    IAudioRenderClient* renderClient = nullptr;
    hr = audioClient->GetService(__uuidof(IAudioRenderClient), (void**)&renderClient);
    if (FAILED(hr)) { error = "GetService(IAudioRenderClient) failed"; return false; }
    renderClient_ = renderClient;

    HANDLE hEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
    if (!hEvent) { error = "CreateEvent failed"; return false; }
    eventHandle_ = hEvent;

    hr = audioClient->SetEventHandle(hEvent);
    if (FAILED(hr)) { error = "SetEventHandle failed"; return false; }

    return true;
}

bool WasapiRender::start(std::string& error) {
    if (running_.load()) return true;

    HRESULT hr = asAudioClient(audioClient_)->Start();
    if (FAILED(hr)) { error = "IAudioClient::Start failed"; return false; }

    shutdown_.store(false);
    running_.store(true);
    thread_ = std::thread(&WasapiRender::renderThreadLoop, this);
    return true;
}

void WasapiRender::stop() {
    if (!running_.load() && !shutdown_.load()) return;
    shutdown_.store(true);
    if (audioClient_) asAudioClient(audioClient_)->Stop();
    if (thread_.joinable()) thread_.join();
    running_.store(false);
}

uint64_t WasapiRender::totalFramesRendered() const noexcept {
    return totalFrames_.load(std::memory_order_acquire);
}

uint64_t WasapiRender::underruns() const noexcept {
    return underruns_.load(std::memory_order_acquire);
}

void WasapiRender::renderThreadLoop() {
    // Real-time audio thread — NO allocation, NO locks, NO I/O.

    IAudioClient*       audioClient  = asAudioClient(audioClient_);
    IAudioRenderClient* renderClient = asRenderClient(renderClient_);
    HANDLE              hEvent       = asEvent(eventHandle_);

    const uint32_t ch = channels_;
    const uint32_t maxFrames = bufferFrames_;

    std::vector<float> mixBuf(maxFrames * ch, 0.0f);

    while (!shutdown_.load(std::memory_order_acquire)) {
        DWORD waitRes = WaitForSingleObject(hEvent, 100);
        if (shutdown_.load()) break;

        UINT32 padding = 0;
        if (FAILED(audioClient->GetCurrentPadding(&padding))) continue;
        UINT32 available = bufferFrames_ - padding;
        if (available == 0) continue;

        BYTE* data = nullptr;
        if (FAILED(renderClient->GetBuffer(available, &data))) continue;

        engine_->renderBlock(available, mixBuf.data());

        std::memcpy(data, mixBuf.data(), sizeof(float) * available * ch);

        renderClient->ReleaseBuffer(available, 0);
        totalFrames_.fetch_add(available, std::memory_order_relaxed);
    }
}