# Voice Priority Audio Studio

Voice Priority Audio Studio is a Windows desktop app that mixes local music
with a physical microphone and routes the combined audio to PC games through a
virtual audio cable. Configure your game or Android emulator to use the cable's
recording endpoint as its microphone.

**Core goal:** Music is Rank 1 and is never ducked by the Rank 2 microphone.

## Features

- Plays local music in common formats, including MP3, WAV, FLAC, OGG, M4A,
  AAC, OPUS, and WEBM.
- Keeps the playlist and absolute file paths across application restarts.
- Mixes an optional physical microphone with music.
- Offers Normal, Low-Fi Bass, and Creepy Horror microphone effects.
- Processes music through an anti-duck chain; microphone audio uses a separate
  limiter so mic peaks do not trigger music gain reduction.
- Can inject a quiet DTX tone to help prevent the game's VAD from cutting
  transmission during quiet passages.
- Routes processed output to VB-CABLE's `CABLE Input`; games use `CABLE Output`
  as their microphone input.

## Limitations

- Does not capture system or application loopback audio.
- Does not install a custom virtual audio driver. VB-CABLE must be installed
  separately.
- Cannot control audio processing or microphone attenuation performed by a
  game or its servers.

## Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| Node.js | 22 LTS | Build and development |
| VB-CABLE | Latest | Virtual audio cable |
| PC game or Android emulator | Current | Target audio application |
| Visual Studio Build Tools | 2022 | Rebuilding the native audio addon |

## Quick Start

```powershell
npm install
npm run dev
```

## Build

```powershell
npm run build
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\package-win.ps1 -SkipNativeRebuild
```

The Windows installer is written to `release`.

Current release: **v2.4.0**.

## License

MIT. See [LICENSE](./LICENSE).
