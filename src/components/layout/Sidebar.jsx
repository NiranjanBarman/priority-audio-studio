import React from 'react';
import {
  AudioLines,
  AudioWaveform,
  CircleGauge,
  LayoutDashboard,
  Library,
  Mic2,
  Route,
  Settings2,
  SlidersHorizontal
} from 'lucide-react';
import { useAudioEngine } from '../../hooks/useAudioEngine.js';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'library',   label: 'Music Library', icon: Library },
  { id: 'mixer',     label: 'Audio Mixer', icon: SlidersHorizontal },
  { id: 'equalizer', label: 'Equalizer', icon: AudioLines },
  { id: 'routing',   label: 'Device Routing', icon: Route },
  { id: 'settings',  label: 'Settings', icon: Settings2 }
];

export default function Sidebar({ activeTab, onTabChange }) {
  const { engine, state } = useAudioEngine();
  const running = state.ready && engine.ctx?.state === 'running';

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-icon">
          <AudioWaveform size={22} strokeWidth={1.8} />
        </div>
        <div>
          <div className="brand-title">Voice Priority Audio</div>
          <div className="brand-sub">STUDIO · V2.3.1</div>
        </div>
      </div>
      <nav className="nav">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={'nav-btn' + (activeTab === id ? ' active' : '')}
            onClick={() => onTabChange(id)}
          >
            <Icon size={17} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-tag">
        Auto-ducking intentionally disabled.
      </div>
      <div className="sidebar-engine">
        <div className="sidebar-engine-heading">
          <span>ENGINE STATUS</span>
          <CircleGauge size={14} />
        </div>
        <div className="sidebar-engine-state">
          <span className={'status-dot' + (running ? ' online engine-pulse' : '')} />
          <span>{running ? 'Audio engine online' : 'Engine standby'}</span>
          <span className="muted">{state.micEnabled ? <Mic2 size={14} /> : null}</span>
        </div>
      </div>
      <div
        style={{
          marginTop: -10,
          padding: '0 4px 2px',
          fontSize: 11,
          lineHeight: 1.5
        }}
      >
        <div>Developed by Niranjan</div>
        <div className="muted">For latest version follow me on GitHub:</div>
        <a
          href="https://github.com/NiranjanBarman"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)', fontSize: 11 }}
        >
          github.com/NiranjanBarman
        </a>
      </div>
    </aside>
  );
}