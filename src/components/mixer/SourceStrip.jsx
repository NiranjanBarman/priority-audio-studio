import React from 'react';
import { Volume2, VolumeX, Headphones } from 'lucide-react';
import PeakMeter from '../meters/PeakMeter.jsx';

/**
 * @param {object}   props
 * @param {string}   props.label
 * @param {number}   props.gain          — 0..1
 * @param {boolean}  props.muted
 * @param {boolean}  props.solo
 * @param {number}   props.peak          — 0..1
 * @param {boolean}  [props.disabled]
 * @param {Function} props.onGainChange
 * @param {Function} props.onMuteToggle
 * @param {Function} props.onSoloToggle
 */
export default function SourceStrip({
  label, gain, muted, solo, peak = 0, disabled,
  onGainChange, onMuteToggle, onSoloToggle
}) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <strong className="small">{label}</strong>
        <div className="row" style={{ gap: 4 }}>
          <button
            className="btn"
            style={{
              padding: '4px 8px',
              borderColor: muted ? 'var(--danger)' : 'var(--border)',
              color: muted ? 'var(--danger)' : 'var(--text)'
            }}
            onClick={onMuteToggle}
            disabled={disabled}
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
          </button>
          <button
            className="btn"
            style={{
              padding: '4px 8px',
              borderColor: solo ? 'var(--accent)' : 'var(--border)',
              color: solo ? 'var(--accent-2)' : 'var(--text)'
            }}
            onClick={onSoloToggle}
            disabled={disabled}
            title={solo ? 'Unsolo' : 'Solo'}
          >
            <Headphones size={12} />
          </button>
        </div>
      </div>
      <input
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={gain}
        onChange={(e) => onGainChange(parseFloat(e.target.value))}
        disabled={disabled || muted}
      />
      <div className="small muted mono" style={{ marginTop: 4, marginBottom: 8 }}>
        {Math.round((gain || 0) * 100)}%
      </div>
      <PeakMeter peak={peak} height={6} />
    </div>
  );
}