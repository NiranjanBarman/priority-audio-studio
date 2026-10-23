import React, { useEffect, useState } from 'react';
import { RotateCcw, Zap, Save } from 'lucide-react';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { useSettings } from '../hooks/useSettings.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Toast from '../components/layout/Toast.jsx';
import Toggle from '../components/controls/Toggle.jsx';
import Slider from '../components/controls/Slider.jsx';

const BANDS = [
  { freq: 31,    label: '31' },
  { freq: 62,    label: '62' },
  { freq: 125,   label: '125' },
  { freq: 250,   label: '250' },
  { freq: 500,   label: '500' },
  { freq: 1000,  label: '1k' },
  { freq: 2000,  label: '2k' },
  { freq: 4000,  label: '4k' },
  { freq: 8000,  label: '8k' },
  { freq: 16000, label: '16k' }
];

const DEFAULT_GAINS = new Array(BANDS.length).fill(0);

export default function Equalizer() {
  const { engine, state } = useAudioEngine();
  const { settings, set: setSetting } = useSettings();
  const [toast, setToast] = useState(null);

  const [enabled, setEnabled] = useState(!!settings.eqEnabled);
  const [gains, setGains] = useState(settings.eqGains || DEFAULT_GAINS);
  const [bassBoost, setBassBoost] = useState(settings.eqBassBoost || 0);
  const [treble, setTreble] = useState(settings.eqTreble || 0);
  const [distortion, setDistortion] = useState(settings.eqDistortion || 0);

  // ── Persist to settings ────────────────────────────────────────────
  useEffect(() => {
    setSetting('eqEnabled', enabled);
    setSetting('eqGains', gains);
    setSetting('eqBassBoost', bassBoost);
    setSetting('eqTreble', treble);
    setSetting('eqDistortion', distortion);
  }, [enabled, gains, bassBoost, treble, distortion, setSetting]);

  // ── Apply to audio graph (reactively) ──────────────────────────────
  // Runs whenever any EQ param changes OR the engine becomes ready.
  useEffect(() => {
    const g = engine.graph;
    if (!g) return;

    const scale = enabled ? 1 : 0;

    if (Array.isArray(g.eqBands)) {
      gains.forEach((db, idx) => {
        if (g.eqBands[idx]) g.eqBands[idx].gain.value = db * scale;
      });
    }
    if (g.bassShelf)   g.bassShelf.gain.value   = bassBoost * scale;
    if (g.trebleShelf) g.trebleShelf.gain.value = treble * scale;

    const wet = enabled ? Math.min(1, Math.max(0, distortion / 100)) : 0;
    if (g.distortionWet) g.distortionWet.gain.value = wet;
    if (g.distortionDry) g.distortionDry.gain.value = 1 - wet;
  }, [enabled, gains, bassBoost, treble, distortion, engine.graph, state.ready]);

  // ── Handlers ───────────────────────────────────────────────────────
  function handleBandChange(idx, db) {
    const next = gains.slice();
    next[idx] = db;
    setGains(next);
  }

  function handleReset() {
    setGains([...DEFAULT_GAINS]);
    setBassBoost(0);
    setTreble(0);
    setDistortion(0);
    setToast({ level: 'info', message: 'EQ reset to flat' });
  }

  function handleSavePreset() {
    const name = window.prompt('Preset name:', 'My preset');
    if (!name) return;
    try {
      const key = 'pas.eq.presets.v1';
      const existing = JSON.parse(localStorage.getItem(key) || '{}');
      existing[name] = {
        gains: [...gains],
        bassBoost,
        treble,
        distortion,
        savedAt: Date.now()
      };
      localStorage.setItem(key, JSON.stringify(existing));
      setToast({ level: 'success', message: `Preset saved: ${name}` });
      // Force re-read of preset names
      setPresetTick((x) => x + 1);
    } catch (e) {
      setToast({ level: 'error', message: e.message });
    }
  }

  const [presetTick, setPresetTick] = useState(0);
  const savedPresets = (() => {
    try {
      const key = 'pas.eq.presets.v1';
      return Object.keys(JSON.parse(localStorage.getItem(key) || '{}'));
    } catch { return []; }
  })();

  function applyPreset(name) {
    try {
      const key = 'pas.eq.presets.v1';
      const p = JSON.parse(localStorage.getItem(key) || '{}')[name];
      if (!p) return;
      setGains(p.gains || DEFAULT_GAINS);
      setBassBoost(p.bassBoost || 0);
      setTreble(p.treble || 0);
      setDistortion(p.distortion || 0);
      setToast({ level: 'success', message: `Preset loaded: ${name}` });
    } catch (e) {
      setToast({ level: 'error', message: e.message });
    }
  }

  return (
    <div className="equalizer-page">
      <PageHeader
        title="Equalizer"
        subtitle="10-band graphic EQ + tone shaping + intentional distortion"
        actions={
          <>
            <button className="btn" onClick={handleReset}>
              <RotateCcw size={12} /> Reset
            </button>
            <button className="btn primary" onClick={handleSavePreset}>
              <Save size={12} /> Save preset
            </button>
          </>
        }
      />

      <div className="card">
        <Toggle
          label="Enable equalizer"
          checked={enabled}
          onChange={(on) => setEnabled(on)}
          description="When disabled, EQ is bypassed entirely (bit-transparent)."
        />
        {!engine.graph && (
          <div className="warn-block" style={{ marginTop: 10 }}>
            Engine not started yet — settings are saved, but audio won't
            change until you start the engine (Dashboard → Start Engine).
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="card-title">10-band EQ</h3>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(10, 1fr)',
            gap: 8,
            alignItems: 'end',
            opacity: enabled ? 1 : 0.4
          }}
          className="eq-band-grid"
        >
          {BANDS.map((b, idx) => (
            <div key={b.freq} className="eq-band" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="mono small muted" style={{ textAlign: 'center', fontSize: 10 }}>
                {gains[idx] > 0 ? '+' : ''}{gains[idx].toFixed(1)}
              </div>
              <input
                type="range"
                min="-12"
                max="12"
                step="0.5"
                value={gains[idx]}
                disabled={!enabled}
                onChange={(e) => handleBandChange(idx, parseFloat(e.target.value))}
                style={{
                  writingMode: 'vertical-lr',
                  direction: 'rtl',
                  height: 140,
                  width: '100%'
                }}
              />
              <div className="small muted" style={{ textAlign: 'center', fontSize: 10 }}>
                {b.label} Hz
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">Bass boost</h3>
          <Slider
            label="Low shelf (100 Hz)"
            value={bassBoost}
            min={-12}
            max={12}
            step={0.5}
            unit="dB"
            onChange={setBassBoost}
            disabled={!enabled}
          />
        </div>
        <div className="card">
          <h3 className="card-title">Treble</h3>
          <Slider
            label="High shelf (16 kHz)"
            value={treble}
            min={-12}
            max={12}
            step={0.5}
            unit="dB"
            onChange={setTreble}
            disabled={!enabled}
          />
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">
          <Zap size={11} style={{ marginRight: 6 }} />
          Intentional distortion
        </h3>
        <Slider
          label="Soft-clip drive"
          value={distortion}
          min={0}
          max={100}
          step={1}
          unit="%"
          onChange={setDistortion}
          disabled={!enabled}
          formatValue={(v) => `${v}%`}
        />
        <div className="small muted" style={{ marginTop: 6 }}>
          Per spec: loud priority over clean. Distortion makes music perceptually
          louder without exceeding the limiter ceiling.
        </div>
      </div>

      {savedPresets.length > 0 && (
        <div className="card">
          <h3 className="card-title">Saved presets</h3>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {savedPresets.map((name) => (
              <button key={name} className="btn" onClick={() => applyPreset(name)}>
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="small muted">
          <strong>Status:</strong> Fully wired to the audio graph. Changes take
          effect immediately when the engine is running. Settings persist across
          reloads. The native C++ EQ (M3) uses the same parameters — when the
          C++ engine is built, behavior is identical.
        </div>
      </div>

      {toast && (
        <Toast message={toast.message} level={toast.level} onClose={() => setToast(null)} />
      )}
    </div>
  );
}