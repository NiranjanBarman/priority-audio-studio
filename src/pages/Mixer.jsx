import React, { useEffect, useMemo, useState } from 'react';
import { Info, Music, Mic, Shield } from 'lucide-react';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { useMeters } from '../hooks/useMeters.js';
import { useSettings } from '../hooks/useSettings.js';
import PageHeader from '../components/layout/PageHeader.jsx';
import Toast from '../components/layout/Toast.jsx';
import SourceStrip from '../components/mixer/SourceStrip.jsx';
import PriorityRank from '../components/mixer/PriorityRank.jsx';
import SoloMuteRow from '../components/mixer/SoloMuteRow.jsx';

export default function Mixer() {
  const { engine, state } = useAudioEngine();
  const { peak } = useMeters({ hz: 20 });
  const { settings, set: setSetting } = useSettings();
  const [toast, setToast] = useState(null);

  const [sources, setSources] = useState({
    music:  { rank: 1, label: 'Music', gain: settings.volume, muted: false, solo: false, active: true,  milestone: 'M1' },
    mic:    { rank: 2, label: 'Microphone', gain: engine.micGain, muted: false, solo: false, active: state.micEnabled, milestone: 'M2' }
  });

  useEffect(() => {
    setSources((prev) => ({
      ...prev,
      music: { ...prev.music, gain: state.volume },
      mic: {
        ...prev.mic,
        gain: engine.micGain,
        active: state.micEnabled
      }
    }));
  }, [state.volume, state.micEnabled, engine]);

  function update(key, patch) {
    setSources((prev) => ({
      ...prev,
      [key]: { ...prev[key], ...patch }
    }));
  }

  function handleGain(key, val) {
    update(key, { gain: val });
    if (key === 'music') {
      // FIX M6: always call engine.setVolume (safe even pre-init),
      // AND persist to settings so Dashboard + reload pick it up.
      engine.setVolume(val);
      setSetting('volume', val);
    } else if (key === 'mic') {
      engine.setMicGain(val);
    }
  }

  function handleMute(key) {
    setSources((prev) => {
      const next = !prev[key].muted;
      if (key === 'music') {
        // Mute is transient — do NOT save to settings.
        engine.setVolume(next ? 0 : prev.music.gain);
      } else if (key === 'mic') {
        engine.setMicGain(next ? 0 : prev.mic.gain);
      }
      return { ...prev, [key]: { ...prev[key], muted: next } };
    });
  }

  function handleSolo(key) {
    setSources((prev) => {
      const newSolo = !prev[key].solo;
      const updated = { ...prev, [key]: { ...prev[key], solo: newSolo } };
      if (key === 'music') {
        if (newSolo) engine.setVolume(prev.music.gain);
      }
      return updated;
    });
    setToast({
      level: 'info',
      message: `${sources[key].label}: solo ${!sources[key].solo ? 'ON' : 'OFF'}`
    });
  }

  const stripData = useMemo(
    () => Object.entries(sources).map(([key, s]) => ({ key, ...s })),
    [sources]
  );

  const anySolo = stripData.some((s) => s.solo);

  return (
    <div>
      <PageHeader
        title="Audio Mixer"
        subtitle="Rank 1 always wins. No auto-ducking."
        actions={
          <span className="tag">
            <Shield size={11} style={{ marginRight: 4 }} />
            Anti-duck enforced
          </span>
        }
      />

      <div className="card">
        <h3 className="card-title">Quick controls</h3>
        <SoloMuteRow
          sources={stripData}
          onMuteToggle={handleMute}
          onSoloToggle={handleSolo}
        />
        {anySolo && (
          <div className="row" style={{ marginTop: 10 }}>
            <Info size={12} color="var(--accent-2)" />
            <span className="small muted">
              Solo active — only soloed sources will be audible.
            </span>
          </div>
        )}
      </div>

      <div className="grid-3">
        {stripData.map((s) => (
          <div key={s.key} style={{ position: 'relative' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 6,
                padding: '0 4px'
              }}
            >
              <div className="row" style={{ gap: 6 }}>
                {s.key === 'music' && <Music size={13} />}
                {s.key === 'mic' && <Mic size={13} />}
                <span className="small muted">{s.milestone}</span>
              </div>
              <PriorityRank rank={s.rank} />
            </div>
            <SourceStrip
              label={s.label}
              gain={s.gain}
              gainMax={s.key === 'mic' ? 2 : 1}
              muted={s.muted}
              solo={s.solo}
              peak={s.key === 'music' ? peak : 0}
              disabled={!s.active}
              onGainChange={(v) => handleGain(s.key, v)}
              onMuteToggle={() => handleMute(s.key)}
              onSoloToggle={() => handleSolo(s.key)}
            />
            {!s.active && (
              <div
                className="small muted"
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  padding: '2px 8px',
                  background: 'var(--panel-2)',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: 10
                }}
              >
                {s.milestone}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="card">
        <h3 className="card-title">How priority works</h3>
        <ul className="small muted" style={{ lineHeight: 1.9, paddingLeft: 20 }}>
          <li>
            <strong>Rank 1 (Music)</strong> — highest priority. Never ducks, never
            scales down, never goes silent against lower-rank sources.
          </li>
          <li>
            <strong>Rank 2 (Microphone)</strong> — mixed alongside music without
            reducing the Rank 1 music level.
          </li>
          <li>
            <strong>No auto-ducking:</strong> there is no code path anywhere in
            this app that reduces music gain based on other sources or Free Fire
            activity.
          </li>
        </ul>
      </div>

      {toast && (
        <Toast message={toast.message} level={toast.level} onClose={() => setToast(null)} />
      )}
    </div>
  );
}