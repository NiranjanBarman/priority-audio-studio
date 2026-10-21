// N-API bindings for the native Engine.
// Exposes the full surface: mixer + DTX + EQ + Compressor + Limiter.
// All methods are synchronous — the render thread is separate from JS.

#include <napi.h>
#include <memory>
#include <string>

#include "Engine.h"

namespace {

std::unique_ptr<Engine> gEngine;

static std::string asString(const Napi::Value& v) {
    if (!v.IsString()) return "";
    return v.As<Napi::String>().Utf8Value();
}

// ── init ────────────────────────────────────────────────────────────────
Napi::Value Init(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object opts = info.Length() > 0 && info[0].IsObject()
                        ? info[0].As<Napi::Object>()
                        : Napi::Object::New(env);

    uint32_t sampleRate = opts.Has("sampleRate")
        ? opts.Get("sampleRate").As<Napi::Number>().Uint32Value() : 48000;
    uint32_t channels = opts.Has("channels")
        ? opts.Get("channels").As<Napi::Number>().Uint32Value() : 2;
    uint32_t bufferSize = opts.Has("bufferSize")
        ? opts.Get("bufferSize").As<Napi::Number>().Uint32Value() : 512;
    std::string outputDeviceId = opts.Has("outputDeviceId")
        ? asString(opts.Get("outputDeviceId")) : "";
    std::string loopbackDeviceId = opts.Has("loopbackDeviceId")
        ? asString(opts.Get("loopbackDeviceId")) : "";

    gEngine = std::make_unique<Engine>();

    std::string error;
    bool ok = gEngine->init(sampleRate, channels, bufferSize,
                            outputDeviceId, loopbackDeviceId, error);
    if (!ok) {
        gEngine.reset();
        Napi::Error::New(env, error).ThrowAsJavaScriptException();
        return env.Undefined();
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("sampleRate", Napi::Number::New(env, gEngine->getSampleRate()));
    result.Set("channels", Napi::Number::New(env, gEngine->getChannels()));
    return result;
}

// ── lifecycle ───────────────────────────────────────────────────────────
Napi::Value Start(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!gEngine) { Napi::Error::New(env, "Engine not initialized").ThrowAsJavaScriptException(); return env.Undefined(); }
    std::string error;
    if (!gEngine->start(error)) {
        Napi::Error::New(env, error).ThrowAsJavaScriptException();
    }
    return env.Undefined();
}

Napi::Value Stop(const Napi::CallbackInfo& info) {
    if (gEngine) gEngine->stop();
    return info.Env().Undefined();
}

Napi::Value SetOutputDevice(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!gEngine) { Napi::Error::New(env, "Engine not initialized").ThrowAsJavaScriptException(); return env.Undefined(); }
    std::string deviceId = info.Length() > 0 ? asString(info[0]) : "";

    const uint32_t sr = gEngine->getSampleRate();
    const uint32_t ch = gEngine->getChannels();
    gEngine->stop();
    gEngine->dispose();
    gEngine = std::make_unique<Engine>();

    std::string error;
    if (!gEngine->init(sr, ch, 512, deviceId, "", error)) {
        Napi::Error::New(env, error).ThrowAsJavaScriptException();
    }
    return env.Undefined();
}

Napi::Value SetInputSource(const Napi::CallbackInfo& info) {
    // Reserved for M2.5 file-source paths. No-op today.
    return info.Env().Undefined();
}

// ── audio feed ──────────────────────────────────────────────────────────
Napi::Value PushAudio(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!gEngine) return env.Undefined();
    if (info.Length() < 2 || !info[0].IsTypedArray()) {
        Napi::TypeError::New(env, "pushAudio expects (Float32Array, frames)")
            .ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Float32Array arr = info[0].As<Napi::Float32Array>();
    uint32_t frames = info[1].As<Napi::Number>().Uint32Value();
    gEngine->pushAudio(arr.Data(), frames);
    return env.Undefined();
}

// ── meters ──────────────────────────────────────────────────────────────
Napi::Value GetMeters(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object out = Napi::Object::New(env);
    if (!gEngine) {
        out.Set("peakL", 0.0f);
        out.Set("peakR", 0.0f);
        out.Set("clip", false);
        out.Set("dropouts", Napi::Number::New(env, 0));
        out.Set("compressorGrDb", 0.0f);
        out.Set("limiterGrDb", 0.0f);
        return out;
    }
    const float p = gEngine->getPeak();
    out.Set("peakL", Napi::Number::New(env, p));
    out.Set("peakR", Napi::Number::New(env, p));
    out.Set("clip", Napi::Boolean::New(env, gEngine->getClip()));
    out.Set("dropouts", Napi::Number::New(env, (double)gEngine->getDropouts()));
    out.Set("compressorGrDb", Napi::Number::New(env, gEngine->getCompressorGainReductionDb()));
    out.Set("limiterGrDb", Napi::Number::New(env, gEngine->getLimiterGainReductionDb()));
    return out;
}

Napi::Value GetDiagnostics(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object out = Napi::Object::New(env);
    if (!gEngine) {
        out.Set("underruns", Napi::Number::New(env, 0));
        out.Set("overruns", Napi::Number::New(env, 0));
        out.Set("framesRendered", Napi::Number::New(env, 0));
        out.Set("framesLoopback", Napi::Number::New(env, 0));
        out.Set("sampleRate", Napi::Number::New(env, 0));
        out.Set("channels", Napi::Number::New(env, 0));
        return out;
    }
    out.Set("underruns", Napi::Number::New(env, (double)gEngine->getDropouts()));
    out.Set("overruns", Napi::Number::New(env, 0));
    out.Set("framesRendered", Napi::Number::New(env, (double)gEngine->getFramesRendered()));
    out.Set("framesLoopback", Napi::Number::New(env, (double)gEngine->getLoopbackFrames()));
    out.Set("sampleRate", Napi::Number::New(env, gEngine->getSampleRate()));
    out.Set("channels", Napi::Number::New(env, gEngine->getChannels()));
    out.Set("compressorGrDb", Napi::Number::New(env, gEngine->getCompressorGainReductionDb()));
    out.Set("limiterGrDb", Napi::Number::New(env, gEngine->getLimiterGainReductionDb()));
    return out;
}

// ── mixer setters ───────────────────────────────────────────────────────
Napi::Value SetMusicGain(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setMusicGain(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetSystemGain(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setSystemGain(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetSystemEnabled(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setSystemEnabled(info[0].As<Napi::Boolean>().Value());
    }
    return info.Env().Undefined();
}

// ── DTX setters ─────────────────────────────────────────────────────────
Napi::Value SetDtxEnabled(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setDtxEnabled(info[0].As<Napi::Boolean>().Value());
    }
    return info.Env().Undefined();
}
Napi::Value SetDtxLevelDb(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setDtxLevelDb(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}

// ── EQ setters/getters ──────────────────────────────────────────────────
Napi::Value SetEqEnabled(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setEqEnabled(info[0].As<Napi::Boolean>().Value());
    }
    return info.Env().Undefined();
}
Napi::Value SetEqBandGain(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() >= 2) {
        int band = info[0].As<Napi::Number>().Int32Value();
        float db = info[1].As<Napi::Number>().FloatValue();
        gEngine->setEqBandGain(band, db);
    }
    return info.Env().Undefined();
}
Napi::Value SetEqAllGains(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (gEngine && info.Length() > 0 && info[0].IsTypedArray()) {
        Napi::Float32Array arr = info[0].As<Napi::Float32Array>();
        if (arr.ElementLength() >= 10) {
            gEngine->setEqAllGains(arr.Data());
        }
    }
    return env.Undefined();
}
Napi::Value ResetEqGains(const Napi::CallbackInfo& info) {
    if (gEngine) gEngine->resetEqGains();
    return info.Env().Undefined();
}
Napi::Value GetEqBandGain(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!gEngine || info.Length() < 1) return Napi::Number::New(env, 0.0f);
    int band = info[0].As<Napi::Number>().Int32Value();
    return Napi::Number::New(env, gEngine->getEqBandGain(band));
}

// ── Compressor setters/getters ──────────────────────────────────────────
Napi::Value SetCompressorEnabled(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setCompressorEnabled(info[0].As<Napi::Boolean>().Value());
    }
    return info.Env().Undefined();
}
Napi::Value SetCompressorThresholdDb(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setCompressorThresholdDb(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetCompressorRatio(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setCompressorRatio(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetCompressorAttackMs(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setCompressorAttackMs(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetCompressorReleaseMs(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setCompressorReleaseMs(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetCompressorKneeDb(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setCompressorKneeDb(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetCompressorMakeupDb(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setCompressorMakeupDb(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}

// ── Limiter setters/getters ─────────────────────────────────────────────
Napi::Value SetLimiterEnabled(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setLimiterEnabled(info[0].As<Napi::Boolean>().Value());
    }
    return info.Env().Undefined();
}
Napi::Value SetLimiterCeilingDb(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setLimiterCeilingDb(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetLimiterReleaseMs(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setLimiterReleaseMs(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}
Napi::Value SetLimiterLookaheadMs(const Napi::CallbackInfo& info) {
    if (gEngine && info.Length() > 0) {
        gEngine->setLimiterLookaheadMs(info[0].As<Napi::Number>().FloatValue());
    }
    return info.Env().Undefined();
}

// ── dispose ─────────────────────────────────────────────────────────────
Napi::Value Dispose(const Napi::CallbackInfo& info) {
    if (gEngine) {
        gEngine->dispose();
        gEngine.reset();
    }
    return info.Env().Undefined();
}

// ── Module init ─────────────────────────────────────────────────────────
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
    // Lifecycle
    exports.Set("init",            Napi::Function::New(env, Init));
    exports.Set("start",           Napi::Function::New(env, Start));
    exports.Set("stop",            Napi::Function::New(env, Stop));
    exports.Set("dispose",         Napi::Function::New(env, Dispose));
    exports.Set("setOutputDevice", Napi::Function::New(env, SetOutputDevice));
    exports.Set("setInputSource",  Napi::Function::New(env, SetInputSource));

    // Audio feed
    exports.Set("pushAudio",       Napi::Function::New(env, PushAudio));

    // Meters / diagnostics
    exports.Set("getMeters",       Napi::Function::New(env, GetMeters));
    exports.Set("getDiagnostics",  Napi::Function::New(env, GetDiagnostics));

    // Mixer
    exports.Set("setMusicGain",     Napi::Function::New(env, SetMusicGain));
    exports.Set("setSystemGain",    Napi::Function::New(env, SetSystemGain));
    exports.Set("setSystemEnabled", Napi::Function::New(env, SetSystemEnabled));

    // DTX
    exports.Set("setDtxEnabled",    Napi::Function::New(env, SetDtxEnabled));
    exports.Set("setDtxLevelDb",    Napi::Function::New(env, SetDtxLevelDb));

    // EQ
    exports.Set("setEqEnabled",     Napi::Function::New(env, SetEqEnabled));
    exports.Set("setEqBandGain",    Napi::Function::New(env, SetEqBandGain));
    exports.Set("setEqAllGains",    Napi::Function::New(env, SetEqAllGains));
    exports.Set("resetEqGains",     Napi::Function::New(env, ResetEqGains));
    exports.Set("getEqBandGain",    Napi::Function::New(env, GetEqBandGain));

    // Compressor
    exports.Set("setCompressorEnabled",     Napi::Function::New(env, SetCompressorEnabled));
    exports.Set("setCompressorThresholdDb", Napi::Function::New(env, SetCompressorThresholdDb));
    exports.Set("setCompressorRatio",       Napi::Function::New(env, SetCompressorRatio));
    exports.Set("setCompressorAttackMs",    Napi::Function::New(env, SetCompressorAttackMs));
    exports.Set("setCompressorReleaseMs",   Napi::Function::New(env, SetCompressorReleaseMs));
    exports.Set("setCompressorKneeDb",      Napi::Function::New(env, SetCompressorKneeDb));
    exports.Set("setCompressorMakeupDb",    Napi::Function::New(env, SetCompressorMakeupDb));

    // Limiter
    exports.Set("setLimiterEnabled",     Napi::Function::New(env, SetLimiterEnabled));
    exports.Set("setLimiterCeilingDb",   Napi::Function::New(env, SetLimiterCeilingDb));
    exports.Set("setLimiterReleaseMs",   Napi::Function::New(env, SetLimiterReleaseMs));
    exports.Set("setLimiterLookaheadMs", Napi::Function::New(env, SetLimiterLookaheadMs));

    return exports;
}

}  // namespace

NODE_API_MODULE(pas_engine, InitModule)