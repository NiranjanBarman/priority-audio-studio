import React, { useEffect, useMemo, useState } from 'react';
import { Music, Mic } from 'lucide-react';
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
    music:  { rank: 1, label: 'Music', gain: settings.volume, muted: false, solo: false, active: true },
    mic:    { rank: 2, label: 'Microphone', gain: engine.micGain, muted: false, solo: false, active: state.micEnabled }
  });

  useEffect(() => {
    setSources((prev) => ({
      ...prev,
      music: {
        ...prev.music,
        gain: prev.music.muted ? prev.music.gain : state.volume
      },
      mic: {
        ...prev.mic,
        gain: prev.mic.muted ? prev.mic.gain : engine.micGain,
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
      engine.setVolume(sources.music.muted ? 0 : val);
      setSetting('volume', val);
    } else if (key === 'mic') {
      engine.setMicGain(sources.mic.muted ? 0 : val);
    }
  }

  function handleMute(key) {
    const muted = !sources[key].muted;
    setSources((prev) => ({
      ...prev,
      [key]: { ...prev[key], muted }
    }));

    if (key === 'music') {
      // Mute is transient — do NOT save to settings.
      engine.setVolume(muted ? 0 : sources.music.gain);
    } else if (key === 'mic') {
      engine.setMicGain(muted ? 0 : sources.mic.gain);
    }
  }

  function handleSolo(key) {
    const newSolo = !sources[key].solo;
    setSources((prev) => ({
      ...prev,
      [key]: { ...prev[key], solo: newSolo }
    }));
    if (key === 'music' && newSolo) engine.setVolume(sources.music.gain);
    setToast({
      level: 'info',
      message: `${sources[key].label}: solo ${newSolo ? 'ON' : 'OFF'}`
    });
  }

  const stripData = useMemo(
    () => Object.entries(sources).map(([key, s]) => ({ key, ...s })),
    [sources]
  );

  return (
    <div className="mixer-page">
      <PageHeader
        title="Audio Mixer"
      />

      <div className="card">
        <h3 className="card-title">Quick controls</h3>
        <SoloMuteRow
          sources={stripData}
          onMuteToggle={handleMute}
          onSoloToggle={handleSolo}
        />
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
          </div>
        ))}
      </div>

      {toast && (
        <Toast message={toast.message} level={toast.level} onClose={() => setToast(null)} />
      )}
    </div>
  );
}