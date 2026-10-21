import React from 'react';

/**
 * @param {object}   props
 * @param {Array}    props.sources    — [{key, label, muted, solo, active}]
 * @param {Function} props.onMuteToggle  — (key) => void
 * @param {Function} props.onSoloToggle  — (key) => void
 */
export default function SoloMuteRow({ sources, onMuteToggle, onSoloToggle }) {
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      {sources.map((src) => {
        const inactive = src.active === false;
        return (
          <div
            key={src.key}
            className="row"
            style={{
              gap: 4,
              padding: '4px 8px',
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              opacity: inactive ? 0.5 : 1
            }}
            title={inactive ? `${src.label} — currently inactive` : undefined}
          >
            <span className="small">{src.label}</span>
            <button
              className="btn"
              style={{
                padding: '2px 6px',
                fontSize: 10,
                color: src.muted ? 'var(--danger)' : 'var(--text)'
              }}
              onClick={() => onMuteToggle(src.key)}
              disabled={inactive}
              title={inactive ? 'Source is inactive' : (src.muted ? 'Unmute' : 'Mute')}
            >
              M
            </button>
            <button
              className="btn"
              style={{
                padding: '2px 6px',
                fontSize: 10,
                color: src.solo ? 'var(--accent-2)' : 'var(--text)'
              }}
              onClick={() => onSoloToggle(src.key)}
              disabled={inactive}
              title={inactive ? 'Source is inactive' : (src.solo ? 'Unsolo' : 'Solo')}
            >
              S
            </button>
          </div>
        );
      })}
    </div>
  );
}