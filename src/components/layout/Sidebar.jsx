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
        <div className="brand-mark">PAS</div>
        <div>
          <div className="brand-title">Priority Audio</div>
          <div className="brand-sub">Studio · M1</div>
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
    </aside>
  );
}