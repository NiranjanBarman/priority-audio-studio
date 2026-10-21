import React, { useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle } from 'lucide-react';
import { useDevices } from '../hooks/useDevices.js';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { useSettings } from '../hooks/useSettings.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import DeviceSelect from '../components/routing/DeviceSelect.jsx';
import PathDiagram from '../components/routing/PathDiagram.jsx';
import Toast from '../components/layout/Toast.jsx';

const CABLE_DOWNLOAD_URL = 'https://vb-audio.com/Cable/';

export default function Routing() {
  const { outputs, inputs, cableInput, error, refresh, loading } = useDevices();
  const { engine, state } = useAudioEngine();
  const { settings, set: setSetting } = useSettings();
  const [toast, setToast] = useState(null);

  async function handleOutputChange(id) {
    setSetting('outputDeviceId', id);
    if (!engine.ctx) {
      setToast({ level: 'info', message: 'Saved. Will apply when engine starts.' });
      return;
    }
    try {
      await engine.setOutputDevice(id);
      const label = outputs.find((d) => d.deviceId === id)?.label || id || 'Windows default';
      setToast({ level: 'success', message: `Output → ${label}` });
    } catch (e) {
      setToast({ level: 'error', message: `Failed to switch output: ${e.message}` });
    }
  }

  function labelFor(id) {
    return outputs.find((d) => d.deviceId === id)?.label || id || '—';
  }

  const cableOutputFound = inputs.some((d) => /CABLE Output/i.test(d.label || ''));

  const checks = [
    { ok: !!cableInput, label: 'CABLE Input visible in playback devices' },
    { ok: cableOutputFound, label: 'CABLE Output visible in recording devices' },
    { ok: settings.outputDeviceId === (cableInput?.deviceId || ''), label: 'App output device = CABLE Input' },
    { ok: !!engine.ctx, label: 'Audio engine running' }
  ];

  const allPassed = checks.every((c) => c.ok);

  return (
    <div>
      <PageHeader
        title="Device Routing"
        subtitle="Select output device, verify CABLE, follow the checklist."
        actions={
          <button className="btn" onClick={refresh} disabled={loading}>
            <RefreshCw size={12} /> {loading ? 'Scanning…' : 'Refresh devices'}
          </button>
        }
      />

      {error && (
        <div className="error-block" style={{ marginBottom: 14 }}>
          <AlertTriangle size={14} />
          <span>{error}</span>
        </div>
      )}

      <div className="card">
        <h3 className="card-title">Output selection</h3>
        <div className="grid-2">
          <DeviceSelect
            label="Playback (target = CABLE Input)"
            devices={outputs}
            value={settings.outputDeviceId}
            onChange={handleOutputChange}
            onRefresh={refresh}
            allowEmpty={true}
            emptyLabel="— Windows default —"
          />
          <DeviceSelect
            label="Monitor (optional, M4)"
            devices={outputs}
            value={settings.monitorDeviceId}
            onChange={(id) => setSetting('monitorDeviceId', id)}
            allowEmpty={true}
            emptyLabel="— Disabled —"
            disabled={!settings.monitorEnabled}
          />
        </div>
      </div>

      <PathDiagram
        fileActive={state.playing}
        systemActive={false}
        micActive={false}
        monitorActive={settings.monitorEnabled}
        outputLabel={labelFor(settings.outputDeviceId)}
        monitorLabel={labelFor(settings.monitorDeviceId) || 'Monitor'}
      />

      <div className="card">
        <h3 className="card-title">Detected devices</h3>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Playback ({outputs.length})
        </div>
        <ul className="small mono" style={{ margin: '0 0 14px 18px', padding: 0 }}>
          {outputs.length === 0 && <li className="muted">— none —</li>}
          {outputs.map((d) => (
            <li
              key={d.deviceId}
              style={{ color: d.deviceId === state.outputDeviceId ? 'var(--accent-2)' : undefined }}
            >
              {d.label || `Device ${d.deviceId.slice(0, 8)}`}
              {d.deviceId === state.outputDeviceId && (
                <span className="small" style={{ marginLeft: 6 }}>◀ active</span>
              )}
            </li>
          ))}
        </ul>
        <div className="small muted" style={{ marginBottom: 6 }}>
          Recording ({inputs.length})
        </div>
        <ul className="small mono" style={{ margin: '0 0 0 18px', padding: 0 }}>
          {inputs.length === 0 && <li className="muted">— none —</li>}
          {inputs.map((d) => (
            <li key={d.deviceId}>{d.label || `Device ${d.deviceId.slice(0, 8)}`}</li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3 className="card-title">Setup verification</h3>
        <div className="list" style={{ gap: 6 }}>
          {checks.map((c, i) => (
            <div key={i} className="row" style={{ gap: 8 }}>
              {c.ok
                ? <CheckCircle size={14} color="var(--ok)" />
                : <AlertTriangle size={14} color="var(--warn)" />}
              <span className={c.ok ? 'ok small' : 'warn small'}>{c.label}</span>
            </div>
          ))}
        </div>
        {allPassed && (
          <div className="row" style={{ marginTop: 12 }}>
            <CheckCircle size={14} color="var(--ok)" />
            <span className="small ok">All checks pass. You're ready.</span>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">BlueStacks setup checklist</h3>
        <ol className="small" style={{ lineHeight: 1.9, paddingLeft: 20 }}>
          <li>Install VB-CABLE from <span className="mono">{CABLE_DOWNLOAD_URL}</span> → reboot.</li>
          <li>Windows Sound → Playback tab shows <span className="mono">CABLE Input</span>.</li>
          <li>Windows Sound → Recording tab shows <span className="mono">CABLE Output</span>.</li>
          <li>Set both CABLE devices to <strong>same sample rate</strong> — Windows Sound → Properties → Advanced → <span className="mono">48000 Hz, 24-bit</span>.</li>
          <li>In this app: Dashboard → Output = <span className="mono">CABLE Input</span>.</li>
          <li>BlueStacks 5 → Settings → Devices → Microphone = <span className="mono">CABLE Output</span>.</li>
          <li>Restart BlueStacks to apply microphone change.</li>
          <li>In-game (Free Fire): Voice Chat = Loud, Noise Suppression = OFF, Mic Auto-adjust = OFF.</li>
        </ol>
      </div>

      <div className="card" style={{ borderColor: 'var(--warn)' }}>
        <h3 className="card-title" style={{ color: 'var(--warn)' }}>Honest limitations</h3>
        <ul className="small muted" style={{ lineHeight: 1.9, paddingLeft: 20 }}>
          <li><strong>Server-side control is impossible.</strong> If Free Fire's server attenuates your mic for any reason, no client app can prevent it.</li>
          <li><strong>Sample rate mismatch is the #1 cause of crackle.</strong> Set both CABLE devices to identical rates.</li>
          <li><strong>Electron cannot create a virtual mic.</strong> VB-CABLE is the bridge — that's a Windows driver concern, not an app concern.</li>
        </ul>
      </div>

      {toast && (
        <Toast message={toast.message} level={toast.level} onClose={() => setToast(null)} />
      )}
    </div>
  );
}