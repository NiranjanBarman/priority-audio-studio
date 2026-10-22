import React from 'react';

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'library',   label: 'Music Library' },
  { id: 'mixer',     label: 'Audio Mixer' },
  { id: 'equalizer', label: 'Equalizer' },
  { id: 'routing',   label: 'Device Routing' },
  { id: 'settings',  label: 'Settings' }
];

export default function Sidebar({ activeTab, onTabChange }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">VPA</div>
        <div>
          <div className="brand-title">Voice Priority Audio</div>
          <div className="brand-sub">Studio · v2.0</div>
        </div>
      </div>
      <nav className="nav">
        {TABS.map(t => (
          <button
            key={t.id}
            className={'nav-btn' + (activeTab === t.id ? ' active' : '')}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="sidebar-tag">
        Auto-ducking intentionally disabled.
      </div>
      <div
        style={{
          marginTop: 12,
          padding: '0 12px 12px',
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