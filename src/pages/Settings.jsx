import React, { useEffect, useState } from 'react';
import { Trash2, RefreshCw, Info, RotateCcw } from 'lucide-react';
import { useSettings } from '../hooks/useSettings.js';
import { useNativeEngine } from '../hooks/useNativeEngine.js';
import { getAppInfo } from '../services/ipc.js';
import { getEngine } from '../audio/engine.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Toast from '../components/layout/Toast.jsx';
import Toggle from '../components/controls/Toggle.jsx';
import LogViewer from '../components/diagnostics/LogViewer.jsx';
import StatsPanel from '../components/diagnostics/StatsPanel.jsx';

export default function Settings() {
  const { settings, set: setSetting, reset: resetSettings, saving } = useSettings();
  const { available: nativeAvailable, reason: nativeReason, reload: reloadNative } =
    useNativeEngine({ pollHz: 1 });
  const [info, setInfo] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAppInfo().then(setInfo).catch((e) => {
      setToast({ level: 'error', message: e.message });
    });
  }, []);

  async function handleReset() {
    if (!window.confirm('Reset all settings to defaults? This cannot be undone.')) {
      return;
    }
    resetSettings();
    setToast({ level: 'success', message: 'Settings reset — reload recommended' });
  }

  async function handleEngineRestart() {
    setBusy(true);
    try {
      const engine = getEngine();
      await engine.dispose();
      await engine.init();
      setToast({ level: 'success', message: 'Audio engine restarted' });
    } catch (e) {
      setToast({ level: 'error', message: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleNativeReload() {
    setBusy(true);
    try {
      const r = await reloadNative();
      if (r && r.available) {
        setToast({ level: 'success', message: 'Native engine reloaded' });
      } else {
        setToast({
          level: 'warn',
          message: r?.reason || 'Native engine not available'
        });
      }
    } catch (e) {
      setToast({ level: 'error', message: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleReload() {
    window.location.reload();
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Diagnostics, logs, engine control, preferences"
        actions={
          <button
            className="btn"
            onClick={handleReload}
            title="Reload the app (picks up saved settings)"
          >
            <RefreshCw size={12} /> Reload app
          </button>
        }
      />

      {/* Runtime info */}
      <div className="card">
        <h3 className="card-title">
          <Info size={11} style={{ marginRight: 6 }} />
          Runtime
        </h3>
        <div className="small mono" style={{ lineHeight: 1.8 }}>
          {info ? (
            <>
              <div>Electron: {info.electron || '—'}</div>
              <div>Chromium: {info.chrome || '—'}</div>
              <div>Node: {info.node || '—'}</div>
              <div>Platform: {info.platform} {info.arch ? `(${info.arch})` : ''}</div>
              <div>Mode: {info.mode}</div>
            </>
          ) : (
            <div className="muted">Loading…</div>
          )}
        </div>
      </div>

      {/* Stats / health */}
      <StatsPanel />

      {/* Native engine status */}
      <div className="card">
        <h3 className="card-title">Native C++ engine (M2)</h3>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div className="small">
              Status:{' '}
              <span
                className="mono"
                style={{
                  color: nativeAvailable ? 'var(--ok)' : 'var(--warn)'
                }}
              >
                {nativeAvailable ? 'available' : 'not built'}
              </span>
            </div>
            {nativeReason && (
              <div className="small muted" style={{ marginTop: 4 }}>
                {nativeReason}
              </div>
            )}
          </div>
          <button
            className="btn"
            onClick={handleNativeReload}
            disabled={busy}
          >
            <RefreshCw size={12} /> Reload addon
          </button>
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          Build with: <span className="mono">scripts\build-native.ps1</span>
        </div>
      </div>

      {/* Preferences */}
      <div className="card">
        <h3 className="card-title">Preferences</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Toggle
            label="Launch on Windows startup"
            checked={!!settings.launchOnBoot}
            onChange={(on) => setSetting('launchOnBoot', on)}
            description="Ships in M4. Currently a placeholder preference."
          />
          <div className="sep" />
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div className="small">Settings persistence</div>
              <div className="small muted">
                {saving ? 'Saving…' : 'All changes saved'}
              </div>
            </div>
            <button
              className="btn danger"
              onClick={handleReset}
            >
              <RotateCcw size={12} /> Reset all settings
            </button>
          </div>
        </div>
      </div>

      {/* Engine control */}
      <div className="card">
        <h3 className="card-title">Audio engine</h3>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="small muted">
            Restart the Web Audio engine. All playback stops; subscriptions resume.
          </div>
          <button
            className="btn"
            onClick={handleEngineRestart}
            disabled={busy}
          >
            <RefreshCw size={12} /> Restart engine
          </button>
        </div>
      </div>

      {/* Log viewer */}
      <LogViewer />

      {/* About */}
      <div className="card">
        <h3 className="card-title">About</h3>
        <div className="small muted" style={{ lineHeight: 1.8 }}>
          <div><strong>Voice Priority Audio</strong> v2.0.0</div>
          <div>Priority music and microphone audio for PC games via a virtual audio cable.</div>
          <div style={{ marginTop: 8 }}>
            <strong>M1 scope:</strong> local file playback, anti-duck chain
            (compressor + limiter + DTX), device routing, priority mixer UI,
            EQ, full diagnostics.
          </div>
          <div style={{ marginTop: 4 }}>
            <strong>M2+:</strong> native C++ WASAPI engine, system loopback,
            mic capture, sample-rate auto-resample.
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