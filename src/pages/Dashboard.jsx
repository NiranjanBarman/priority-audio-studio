import React, { useEffect, useState, useRef } from 'react';
import {
  Volume2, Radio, Zap, AlertTriangle, Power,
  Music, Headphones, Activity, Mic2, AudioWaveform, Cable
} from 'lucide-react';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { useDevices } from '../hooks/useDevices.js';
import { useMeters } from '../hooks/useMeters.js';
import { useSettings } from '../hooks/useSettings.js';
import { PRESETS } from '../audio/presets.js';
import { findCableInput } from '../audio/devices.js';

import PageHeader from '../components/layout/PageHeader.jsx';
import Toast from '../components/layout/Toast.jsx';
import Transport from '../components/player/Transport.jsx';
import SeekBar from '../components/player/SeekBar.jsx';
import NowPlaying from '../components/player/NowPlaying.jsx';
import PeakMeter from '../components/meters/PeakMeter.jsx';
import ClipLed from '../components/meters/ClipLed.jsx';
import Slider from '../components/controls/Slider.jsx';
import Toggle from '../components/controls/Toggle.jsx';
import PresetPicker from '../components/controls/PresetPicker.jsx';
import DeviceSelect from '../components/routing/DeviceSelect.jsx';
import PathDiagram from '../components/routing/PathDiagram.jsx';
import { getDiagnostics } from '../services/diagnostics.js';

export default function Dashboard() {
  const { engine, state, ready } = useAudioEngine();
  const { outputs, inputs, cableInput, error: devError, refresh } = useDevices();
  const { peak, clip } = useMeters({ hz: 30 });
  const { settings, set: setSetting } = useSettings();

  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState(null);
  const [micDeviceId, setMicDeviceId] = useState(
    () => engine.state.micDeviceId || ''
  );
  const [micGain, setMicGain] = useState(() => engine.micGain);
  const [healthScore, setHealthScore] = useState(() => getDiagnostics().getHealthScore());
  const autoPickedRef = useRef(false);

  useEffect(() => {
    const diagnostics = getDiagnostics();
    diagnostics.attach(engine);
    diagnostics.start();
    const unsubscribe = diagnostics.subscribe(() => {
      setHealthScore(diagnostics.getHealthScore());
    });
    setHealthScore(diagnostics.getHealthScore());
    return unsubscribe;
  }, [engine]);

  // Auto-pick CABLE Input as output on first load
  useEffect(() => {
    if (autoPickedRef.current) return;
    if (!settings.outputDeviceId && cableInput) {
      setSetting('outputDeviceId', cableInput.deviceId);
      autoPickedRef.current = true;
    }
  }, [cableInput, settings.outputDeviceId, setSetting]);

  // Surface engine errors as toasts
  useEffect(() => {
    if (state.error && state.error !== localError) {
      setLocalError(state.error);
      setToast({ level: 'error', message: state.error });
    }
  }, [state.error, localError]);

  // ── Actions ────────────────────────────────────────────────────────
  /**
   * Initialize the engine and apply all current settings.
   * Returns true on success, false on failure.
   *
   * The return value matters: handlePlay() uses it to abort playback if
   * routing or preset application failed — otherwise music would play
   * through the wrong sink (audit finding M8).
   */
  async function ensureStarted() {
    setBusy(true);
    setLocalError(null);
    try {
      await engine.init();
      engine.setMicEffect(settings.micEffect || 'normal');
      if (settings.outputDeviceId) {
        await engine.setOutputDevice(settings.outputDeviceId);
      }
      engine.setPreset(settings.preset);
      engine.setMakeupGain(settings.makeupDb);
      engine.setDtxEnabled(settings.dtxEnabled);
      engine.setVolume(settings.volume);
      return true;
    } catch (e) {
      setLocalError(e.message);
      setToast({ level: 'error', message: e.message });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleOutputChange(deviceId) {
    setSetting('outputDeviceId', deviceId);
    if (!engine.ctx) return;
    try {
      await engine.setOutputDevice(deviceId);
      const label =
        outputs.find((d) => d.deviceId === deviceId)?.label || deviceId;
      setToast({ level: 'success', message: `Output → ${label}` });
    } catch (e) {
      setLocalError(e.message);
      setToast({ level: 'error', message: e.message });
    }
  }

  async function handlePlay() {
    try {
      if (!engine.ctx) {
        const ok = await ensureStarted();
        // Abort if init or routing failed — prevents playback through
        // the wrong sink (audit finding M8).
        if (!ok) return;
      }
      await engine.play();
    } catch (e) {
      setLocalError(e.message);
      setToast({ level: 'error', message: e.message });
    }
  }

  function handlePause() {
    try {
      engine.pause();
    } catch (e) {
      setToast({ level: 'error', message: e.message });
    }
  }

  function handleStop() {
    try {
      engine.stop();
    } catch (e) {
      setToast({ level: 'error', message: e.message });
    }
  }

  function handleSeek(t) {
    try {
      engine.seek(t);
    } catch (e) {
      setToast({ level: 'error', message: e.message });
    }
  }

  function handleVolume(v) {
    setSetting('volume', v);
    engine.setVolume(v);
  }

  function handlePreset(id) {
    setSetting('preset', id);
    // Sync makeup + dtx per preset (mirrors antiDuck.js logic)
    const presetDef = PRESETS.find((p) => p.id === id);
    let makeup = settings.makeupDb;
    let dtx = settings.dtxEnabled;
    if (id === 'antiDuck') {
      makeup = 15;
      dtx = true;
    } else if (id === 'loud') {
      makeup = 8;
      dtx = false;
    } else if (id === 'natural') {
      makeup = 0;
      dtx = false;
    } else if (id === 'bass') {
      makeup = 10;
      dtx = false;
    }
    setSetting('makeupDb', makeup);
    setSetting('dtxEnabled', dtx);

    if (engine.ctx) {
      engine.setPreset(id);
    }
    setToast({
      level: 'info',
      message: `Preset: ${presetDef?.label || id}`
    });
  }

  function handleMakeup(v) {
    setSetting('makeupDb', v);
    if (engine.ctx) engine.setMakeupGain(v);
  }

  function handleDtx(on) {
    setSetting('dtxEnabled', on);
    if (engine.ctx) engine.setDtxEnabled(on);
    setToast({
      level: on ? 'success' : 'warn',
      message: `DTX injector ${on ? 'ON' : 'OFF'}`
    });
  }

  async function handleMicToggle(enabled) {
    try {
      if (enabled) {
        const started = await ensureStarted();
        if (!started) return;
      }
      await engine.enableMic(micDeviceId, enabled);
      setToast({
        level: 'success',
        message: `Microphone ${enabled ? 'enabled' : 'disabled'}`
      });
    } catch (e) {
      setToast({ level: 'error', message: `Microphone failed: ${e.message}` });
    }
  }

  async function handleMicDeviceChange(deviceId) {
    setMicDeviceId(deviceId);
    if (!state.micEnabled) return;

    try {
      await engine.enableMic(deviceId, true);
      const label = inputs.find((device) => device.deviceId === deviceId)?.label;
      setToast({
        level: 'success',
        message: `Microphone input → ${label || 'default input'}`
      });
    } catch (e) {
      setToast({ level: 'error', message: `Microphone failed: ${e.message}` });
    }
  }

  function handleMicGain(value) {
    setMicGain(value);
    engine.setMicGain(value);
  }

  function handleMicEffectChange(event) {
    const effect = event.target.value;
    try {
      engine.setMicEffect(effect);
      setSetting('micEffect', effect);
    } catch (e) {
      setToast({ level: 'error', message: `Could not apply microphone effect: ${e.message}` });
    }
  }

  const routedToCable =
    cableInput &&
    settings.outputDeviceId &&
    cableInput.deviceId === settings.outputDeviceId;
  const noCableInstalled = outputs.length > 0 && !cableInput;

  return (
    <div className="dashboard-page">
      <PageHeader
        title="Audio Control Studio"
        subtitle="Loud, non-stop music and microphone audio → virtual cable"
        actions={
          <button
            className={'btn ' + (ready ? '' : 'primary')}
            onClick={ensureStarted}
            disabled={busy}
          >
            <Power size={13} /> {busy ? 'Starting…' : ready ? 'Restart engine' : 'Start engine'}
          </button>
        }
      />

      <div className="dashboard-status-grid">
        <div className="status-card">
          <div className="status-card-label"><Cable size={13} /> Output device</div>
          <div className="status-card-value">{routedToCable ? 'VB-CABLE connected' : 'Output not routed'}</div>
          <div className={'small ' + (routedToCable ? 'ok' : 'warn')}>
            {routedToCable ? 'Ready for game input' : 'Select CABLE Input below'}
          </div>
        </div>
        <div className="status-card">
          <div className="status-card-label"><Mic2 size={13} /> Microphone</div>
          <div className="status-card-value">{state.micEnabled ? 'Live input' : 'Disabled'}</div>
          <div className="small muted">{state.micEnabled ? 'Mixed at Rank 2' : 'Enable to add mic audio'}</div>
        </div>
        <div className="status-card">
          <div className="status-card-label"><AudioWaveform size={13} /> Audio engine</div>
          <div className="status-card-value">{engine.ctx?.state === 'running' ? 'Running' : 'Standby'}</div>
          <div className={'small ' + (engine.ctx?.state === 'running' ? 'ok' : 'muted')}>
            {engine.ctx?.state === 'running' ? 'Processing audio' : 'Start when ready'}
          </div>
        </div>
        <div className="status-card">
          <div className="status-card-label"><Activity size={13} /> Audio latency</div>
          <div className="status-card-value">
            {engine.ctx?.baseLatency ? `${(engine.ctx.baseLatency * 1000).toFixed(1)} ms` : '—'}
          </div>
          <div className="small muted">
            {engine.ctx?.sampleRate ? `${engine.ctx.sampleRate} Hz sample rate` : 'Waiting for engine'}
          </div>
        </div>
        <div className="status-card">
          <div className="status-card-label"><Zap size={13} /> Audio health</div>
          <div className="status-card-value">{healthScore}<span className="status-score-unit"> / 100</span></div>
          <div className={'small ' + (healthScore >= 90 ? 'ok' : healthScore >= 70 ? 'warn' : 'err')}>
            {healthScore >= 90 ? 'Nominal' : healthScore >= 70 ? 'Attention' : 'Degraded'}
          </div>
        </div>
      </div>

      <div className="dashboard-primary-grid">
        <div>
      {/* ─── Routing card ───────────────────────────────────────────── */}
      <div className="card">
        <h3 className="card-title">Routing</h3>
        <div className="grid-2">
          <DeviceSelect
            label="Output device (target = CABLE Input)"
            devices={outputs}
            value={settings.outputDeviceId}
            onChange={handleOutputChange}
            onRefresh={refresh}
            allowEmpty={true}
            emptyLabel="— Windows default —"
            disabled={busy}
          />
          <div className="field">
            <span>Status</span>
            <div className="row" style={{ marginTop: 6 }}>
              {routedToCable ? (
                <span className="ok small">✔ Routing to CABLE Input</span>
              ) : noCableInstalled ? (
                <span className="warn small">⚠ CABLE Input not installed</span>
              ) : outputs.length === 0 ? (
                <span className="muted small">Scanning devices…</span>
              ) : (
                <span className="warn small">Not routed to CABLE Input</span>
              )}
            </div>
          </div>
        </div>
        {noCableInstalled && (
          <div className="row" style={{ marginTop: 10 }}>
            <AlertTriangle size={14} color="var(--warn)" />
            <span className="small warn">
              Install VB-CABLE (vb-audio.com/Cable) and reboot. Then Refresh.
            </span>
          </div>
        )}
        {devError && (
          <div className="row" style={{ marginTop: 10 }}>
            <AlertTriangle size={14} color="var(--danger)" />
            <span className="small err">{devError}</span>
          </div>
        )}
      </div>

      {/* ─── Player card ────────────────────────────────────────────── */}
      <div className="card">
        <h3 className="card-title">
          <Music size={11} style={{ marginRight: 6 }} />
          Player
        </h3>
        <NowPlaying
          trackName={state.currentTrack?.name}
          source="file"
        />
        <div style={{ marginTop: 10 }}>
          <SeekBar
            currentTime={state.currentTime}
            duration={state.duration}
            onSeek={handleSeek}
            disabled={!state.duration}
          />
        </div>
        <div style={{ marginTop: 12 }}>
          <Transport
            playing={state.playing}
            onPlay={handlePlay}
            onPause={handlePause}
            onStop={handleStop}
          />
        </div>
      </div>
        </div>

      {/* ─── M2 microphone mixed after the music compressor ─────────── */}
        <div>
      <div className="card">
        <h3 className="card-title">Microphone (M2)</h3>
        <div className="row" style={{ gap: 16, marginBottom: 14 }}>
          <span className="small">
            <strong>Music: HIGH Priority (Rank 1)</strong>
          </span>
          <span className="small muted">
            Mic: NORMAL Priority (Rank 2)
          </span>
        </div>
        <div className="small muted" style={{ marginBottom: 12 }}>
          Music and mic use separate processing paths, so mic peaks will not
          turn the music down. Use headphones to keep game voices from leaking
          into your physical mic; game-side processing can still affect the mix.
        </div>
        <div className="grid-2">
          <div>
            <Toggle
              label="Enable microphone"
              checked={state.micEnabled}
              onChange={handleMicToggle}
            />
            <div style={{ marginTop: 12 }}>
              <DeviceSelect
                label="Physical microphone input"
                devices={inputs}
                value={micDeviceId}
                onChange={handleMicDeviceChange}
                onRefresh={refresh}
                allowEmpty
                emptyLabel="— Windows default microphone —"
              />
            </div>
            <label className="field" style={{ marginTop: 12 }}>
              <span>Mic Voice Effect</span>
              <select
                value={settings.micEffect || 'normal'}
                onChange={handleMicEffectChange}
              >
                <option value="normal">Normal</option>
                <option value="distorted">Trash Mic (Distorted)</option>
                <option value="radio">Walkie-Talkie (Radio)</option>
              </select>
            </label>
          </div>
          <Slider
            label="Mic gain"
            value={micGain}
            min={0}
            max={2}
            step={0.01}
            onChange={handleMicGain}
          />
        </div>
      </div>
        </div>
      </div>

      {/* ─── Volume + meter ─────────────────────────────────────────── */}
      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">
            <Volume2 size={11} style={{ marginRight: 6 }} />
            Output volume
          </h3>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={settings.volume}
            onChange={(e) => handleVolume(parseFloat(e.target.value))}
          />
          <div className="small muted" style={{ marginTop: 4 }}>
            {Math.round(settings.volume * 100)}%
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">
            <Radio size={11} style={{ marginRight: 6 }} />
            Output meter
          </h3>
          <PeakMeter peak={peak} height={10} />
          <div style={{ marginTop: 8 }}>
            <ClipLed clipping={clip} />
          </div>
        </div>
      </div>

      <div className="dashboard-overview-grid">
        <div className="card">
          <h3 className="card-title"><Music size={13} /> Mixer overview</h3>
          <div className="overview-source">
            <div className="row"><Music size={14} /><strong>Music</strong><span className="tag">Rank 1</span></div>
            <div className="small muted">{Math.round(settings.volume * 100)}% output gain</div>
            <div className="overview-track"><span style={{ width: `${Math.round(settings.volume * 100)}%` }} /></div>
          </div>
          <div className="overview-source">
            <div className="row"><Mic2 size={14} /><strong>Microphone</strong><span className="tag muted-tag">Rank 2</span></div>
            <div className="small muted">{state.micEnabled ? 'Live' : 'Disabled'} · gain ×{engine.micGain.toFixed(2)}</div>
            <div className="overview-track"><span style={{ width: `${Math.round((engine.micGain / 2) * 100)}%` }} /></div>
          </div>
        </div>
        <div className="card">
          <h3 className="card-title"><AudioWaveform size={13} /> Equalizer overview</h3>
          <div className={'tag ' + (settings.eqEnabled ? 'ok-tag' : 'muted-tag')}>
            {settings.eqEnabled ? 'Equalizer enabled' : 'Equalizer bypassed'}
          </div>
          <div className="small muted" style={{ marginTop: 12 }}>
            10-band EQ · Bass {Number(settings.eqBassBoost || 0) > 0 ? '+' : ''}{Number(settings.eqBassBoost || 0).toFixed(1)} dB
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Treble {Number(settings.eqTreble || 0) > 0 ? '+' : ''}{Number(settings.eqTreble || 0).toFixed(1)} dB
          </div>
        </div>
        <PathDiagram
          fileActive={state.playing}
          micActive={state.micEnabled}
          monitorActive={settings.monitorEnabled}
          outputLabel={outputs.find((device) => device.deviceId === settings.outputDeviceId)?.label || 'CABLE Input'}
          monitorLabel={outputs.find((device) => device.deviceId === settings.monitorDeviceId)?.label || 'Monitor'}
        />
      </div>

      {/* ─── Anti-duck processing ───────────────────────────────────── */}
      <div className="card">
        <h3 className="card-title">
          <Zap size={11} style={{ marginRight: 6 }} />
          Anti-Duck processing
        </h3>
        <div className="grid-2">
          <PresetPicker
            value={settings.preset}
            onChange={handlePreset}
          />
          <Slider
            label="Makeup gain"
            value={settings.makeupDb}
            min={0}
            max={18}
            step={0.5}
            unit="dB"
            formatValue={(v) => `+${v} dB`}
            onChange={handleMakeup}
          />
        </div>
        <div className="sep" />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Toggle
            label="DTX tone injector (-55 dBFS pink noise)"
            checked={settings.dtxEnabled}
            onChange={handleDtx}
            description="Prevents the game's VAD from cutting transmission during quiet music."
          />
          <span className="tag">Auto-ducking intentionally disabled</span>
        </div>
      </div>

      {/* ─── Engine status ──────────────────────────────────────────── */}
      <div className="card">
        <h3 className="card-title">
          <Activity size={11} style={{ marginRight: 6 }} />
          Engine status
        </h3>
        <div className="grid-3">
          <div>
            <div className="small muted">Context</div>
            <div className="mono small">{engine.ctx?.state || '—'}</div>
          </div>
          <div>
            <div className="small muted">Sample rate</div>
            <div className="mono small">
              {engine.ctx?.sampleRate ? `${engine.ctx.sampleRate} Hz` : '—'}
            </div>
          </div>
          <div>
            <div className="small muted">Base latency</div>
            <div className="mono small">
              {engine.ctx?.baseLatency
                ? `${(engine.ctx.baseLatency * 1000).toFixed(1)} ms`
                : '—'}
            </div>
          </div>
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          level={toast.level}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}