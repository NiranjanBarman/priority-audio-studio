# Priority Audio Studio

Windows desktop app that plays local PC music through a loud, non-stop
audio chain and routes it to BlueStacks as a virtual microphone via VB-CABLE.

**Core goal:** Music always loud. Never ducked. Never silenced by Free Fire's VAD.

---

## What This App Does

- 🎵 Plays local music (MP3, WAV, FLAC, OGG, M4A, AAC, OPUS, WEBM)
- 🔊 Processes through an aggressive anti-duck chain (compressor + limiter + makeup gain)
- 🎚️ Injects a -55 dBFS DTX tone so Free Fire's VAD never sees silence
- 🎤 Routes processed output to VB-CABLE's `CABLE Input` → BlueStacks reads it as `CABLE Output`
- ❌ **No auto-ducking. No auto-volume-reduction. Ever.**

## What This App Does NOT Do (M1)

- ❌ No system/Chrome loopback capture (M2)
- ❌ No priority mixer (M2)
- ❌ No 10-band EQ (M3)
- ❌ No custom virtual audio driver
- ❌ No server-side Free Fire control (impossible — see Limitations)

---

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | 22 LTS | Build + dev |
| VB-CABLE | latest | Virtual audio cable — MANDATORY |
| BlueStacks 5 | 5.20+ | Target runtime |
| Visual Studio Build Tools | 2022 | Only for M2+ C++ engine |

---

## Quick Start

```powershell
# 1. Install dependencies
npm install

# 2. Run dev mode
npm run dev