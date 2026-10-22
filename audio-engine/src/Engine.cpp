#include "Engine.h"
#include "WasapiRender.h"
#include "WasapiLoopback.h"
#include <cstring>
#include <algorithm>

Engine::Engine() = default;

Engine::~Engine() {
    dispose();
}

bool Engine::init(uint32_t sampleRate, uint32_t channels, uint32_t bufferSize,
                  const std::string& outputDeviceId,
                  const std::string& loopbackDeviceId,
                  std::string& error) {
    std::lock_guard<std::mutex> lock(initMutex_);

    if (initialized_.load()) {
        dispose();
    }

    sampleRate_.store(sampleRate);
    channels_.store(channels);
    bufferSize_.store(bufferSize);

    // Ring buffers: 2 seconds of audio
    const size_t ringCapacity = size_t(sampleRate) * channels * 2;
    musicRing_ = std::make_unique<RingBuffer>(ringCapacity);
    systemRing_ = std::make_unique<RingBuffer>(ringCapacity);

    // Scratch: 1 second per source
    scratchCapacity_ = size_t(sampleRate) * channels;
    musicScratch_ = std::make_unique<float[]>(scratchCapacity_);
    systemScratch_ = std::make_unique<float[]>(scratchCapacity_);

    // ── DSP prepare ─────────────────────────────────────────────────────
    hpf_.prepare(double(sampleRate), 80.0f, 0.707f);
    hpf_.reset();

    eq_.prepare(double(sampleRate), channels);
    eq_.setEnabled(true);
    // Flat EQ by default — user will adjust in Equalizer page
    eq_.resetGains();

    compressor_.prepare(double(sampleRate), channels);
    // Spec defaults for the anti-duck chain
    compressor_.setThresholdDb(-30.0f);
    compressor_.setRatio(20.0f);
    compressor_.setAttackMs(3.0f);
    compressor_.setReleaseMs(40.0f);
    compressor_.setKneeDb(0.0f);
    compressor_.setMakeupDb(15.0f);
    compressor_.setEnabled(true);

    limiter_.prepare(double(sampleRate), channels, bufferSize);
    limiter_.setCeilingDb(-1.0f);
    limiter_.setReleaseMs(80.0f);
    limiter_.setLookaheadMs(3.0f);
    limiter_.setEnabled(true);

    dtx_.prepare(double(sampleRate), channels);
    dtx_.setEnabled(true);
    dtx_.setLevelDb(-55.0f);

    // ── WASAPI ──────────────────────────────────────────────────────────
    render_ = std::make_unique<WasapiRender>();
    if (!render_->init(this, outputDeviceId, error)) {
        render_.reset();
        return false;
    }

    if (render_->sampleRate() != sampleRate) {
        error = "Render device sample rate mismatch — set CABLE Input to " +
                std::to_string(sampleRate) + " Hz in Windows Sound";
        render_.reset();
        return false;
    }

    loopback_ = std::make_unique<WasapiLoopback>();
    std::string loopErr;
    if (!loopback_->init(this, loopbackDeviceId, loopErr)) {
        loopback_.reset();  // Non-fatal — system capture unavailable
    }

    initialized_.store(true);
    error.clear();
    return true;
}

bool Engine::start(std::string& error) {
    if (!initialized_.load()) { error = "Engine not initialized"; return false; }
    if (running_.load()) return true;

    if (loopback_) {
        std::string loopErr;
        loopback_->start(loopErr);  // Non-fatal on failure
    }

    if (!render_->start(error)) {
        if (loopback_) loopback_->stop();
        return false;
    }

    running_.store(true);
    return true;
}

void Engine::stop() {
    if (!running_.load()) return;
    running_.store(false);
    if (render_) render_->stop();
    if (loopback_) loopback_->stop();
}

void Engine::dispose() {
    std::lock_guard<std::mutex> lock(initMutex_);

    stop();

    loopback_.reset();
    render_.reset();

    musicRing_.reset();
    systemRing_.reset();
    musicScratch_.reset();
    systemScratch_.reset();
    scratchCapacity_ = 0;

    initialized_.store(false);
}

void Engine::pushAudio(const float* samples, uint32_t frames) {
    if (!musicRing_) return;
    const uint32_t ch = channels_.load();
    musicRing_->write(samples, size_t(frames) * ch);
}

// ── Mixer config ────────────────────────────────────────────────────────
void Engine::setMusicGain(float gain)          { mixer_.setMusicGain(gain); }
void Engine::setSystemGain(float gain)         { mixer_.setSystemGain(gain); }
void Engine::setSystemEnabled(bool enabled)    { mixer_.setSystemEnabled(enabled); }

// ── DTX config ──────────────────────────────────────────────────────────
void Engine::setDtxEnabled(bool enabled)       { dtx_.setEnabled(enabled); }
void Engine::setDtxLevelDb(float db)           { dtx_.setLevelDb(db); }

// ── EQ config ───────────────────────────────────────────────────────────
void Engine::setEqEnabled(bool on)             { eq_.setEnabled(on); }
bool Engine::isEqEnabled() const               { return eq_.enabled(); }
void Engine::setEqBandGain(int band, float db) { eq_.setBandGain(band, db); }
float Engine::getEqBandGain(int band) const    { return eq_.getBandGain(band); }
void Engine::setEqAllGains(const float* g)     { eq_.setAllGains(g); }
void Engine::resetEqGains()                    { eq_.resetGains(); }

// ── Compressor config ───────────────────────────────────────────────────
void Engine::setCompressorEnabled(bool on)          { compressor_.setEnabled(on); }
bool Engine::isCompressorEnabled() const            { return compressor_.enabled(); }
void Engine::setCompressorThresholdDb(float db)     { compressor_.setThresholdDb(db); }
void Engine::setCompressorRatio(float ratio)        { compressor_.setRatio(ratio); }
void Engine::setCompressorAttackMs(float ms)        { compressor_.setAttackMs(ms); }
void Engine::setCompressorReleaseMs(float ms)       { compressor_.setReleaseMs(ms); }
void Engine::setCompressorKneeDb(float db)          { compressor_.setKneeDb(db); }
void Engine::setCompressorMakeupDb(float db)        { compressor_.setMakeupDb(db); }
float Engine::getCompressorThresholdDb() const      { return compressor_.getThresholdDb(); }
float Engine::getCompressorRatio() const            { return compressor_.getRatio(); }
float Engine::getCompressorAttackMs() const         { return compressor_.getAttackMs(); }
float Engine::getCompressorReleaseMs() const        { return compressor_.getReleaseMs(); }
float Engine::getCompressorKneeDb() const           { return compressor_.getKneeDb(); }
float Engine::getCompressorMakeupDb() const         { return compressor_.getMakeupDb(); }
float Engine::getCompressorGainReductionDb() const  { return compressor_.currentGainReductionDb(); }

// ── Limiter config ──────────────────────────────────────────────────────
void Engine::setLimiterEnabled(bool on)             { limiter_.setEnabled(on); }
bool Engine::isLimiterEnabled() const               { return limiter_.enabled(); }
void Engine::setLimiterCeilingDb(float db)          { limiter_.setCeilingDb(db); }
void Engine::setLimiterReleaseMs(float ms)          { limiter_.setReleaseMs(ms); }
void Engine::setLimiterLookaheadMs(float ms)        { limiter_.setLookaheadMs(ms); }
float Engine::getLimiterCeilingDb() const           { return limiter_.getCeilingDb(); }
float Engine::getLimiterReleaseMs() const           { return limiter_.getReleaseMs(); }
float Engine::getLimiterLookaheadMs() const         { return limiter_.getLookaheadMs(); }
float Engine::getLimiterGainReductionDb() const     { return limiter_.currentGainReductionDb(); }

// ── Diagnostics ─────────────────────────────────────────────────────────
float Engine::getPeak() const                  { return meter_.peak(); }
bool Engine::getClip() const                   { return meter_.clip(); }
uint64_t Engine::getDropouts() const           { return meter_.dropouts(); }
uint64_t Engine::getFramesRendered() const     { return render_ ? render_->totalFramesRendered() : 0; }
uint64_t Engine::getLoopbackFrames() const     { return loopback_ ? loopback_->totalFramesCaptured() : 0; }
uint32_t Engine::getSampleRate() const         { return sampleRate_.load(); }
uint32_t Engine::getChannels() const           { return channels_.load(); }

// ── Real-time render ────────────────────────────────────────────────────
void Engine::renderBlock(uint32_t frames, float* out) noexcept {
    // ═════════════════════════════════════════════════════════════════
    // REAL-TIME THREAD. NO malloc, NO lock, NO I/O.
    // ═════════════════════════════════════════════════════════════════
    const uint32_t ch = channels_.load(std::memory_order_relaxed);
    const size_t total = size_t(frames) * ch;

    if (total > scratchCapacity_) {
        std::memset(out, 0, sizeof(float) * total);
        return;
    }

    // 1. Read music from JS ring
    size_t musicRead = musicRing_ ? musicRing_->read(musicScratch_.get(), total) : 0;
    if (musicRead < total) {
        std::memset(musicScratch_.get() + musicRead, 0,
                    sizeof(float) * (total - musicRead));
        if (running_.load(std::memory_order_relaxed) && musicRead == 0) {
            meter_.countDropout();
        }
    }

    // 2. Read system (loopback) from ring
    size_t systemRead = systemRing_ ? systemRing_->read(systemScratch_.get(), total) : 0;
    if (systemRead < total) {
        std::memset(systemScratch_.get() + systemRead, 0,
                    sizeof(float) * (total - systemRead));
    }

    // 3. Priority mix (music always wins — see PriorityMixer.h)
    mixer_.mix(musicScratch_.get(), systemScratch_.get(), out, frames, ch);

    // 4. HPF 80 Hz — rumble removal, frees headroom for compressor
    hpf_.process(out, frames, ch);

    // 5. 10-band EQ — tone shaping BEFORE compression
    eq_.process(out, frames);

    // 6. Compressor — anti-duck gain reduction + makeup
    compressor_.process(out, frames);

    // 7. Limiter — brickwall at -1 dBFS. Replaces the old soft-clip loop.
    limiter_.process(out, frames);

    // 8. DTX injector — pink noise bed at -55 dBFS, post-limiter so it
    //    survives untouched and lands at exactly -55 dBFS for the game.
    dtx_.inject(out, frames);

    // 9. Meter — reads final output that the game will receive
    meter_.measure(out, frames, ch);
}

void Engine::onLoopbackData(const float* data, uint32_t frames) noexcept {
    if (!systemRing_) return;
    const uint32_t ch = channels_.load(std::memory_order_relaxed);
    systemRing_->write(data, size_t(frames) * ch);
}