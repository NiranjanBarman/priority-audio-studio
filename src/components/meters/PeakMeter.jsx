import React from 'react';

/**
 * @param {object} props
 * @param {number} props.peak       — 0.0..1.0 (linear)
 * @param {number} [props.height=10]
 * @param {boolean} [props.showLabel]
 */
export default function PeakMeter({ peak, height = 10, showLabel = false }) {
  const pct = Math.max(0, Math.min(100, (peak || 0) * 100));
  return (
    <div>
      <div className="meter" style={{ height }}>
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
      {showLabel && (
        <div className="small muted mono" style={{ marginTop: 4 }}>
          {(peak || 0) > 0 ? (20 * Math.log10(peak || 1e-9)).toFixed(1) + ' dB' : '−∞'}
        </div>
      )}
    </div>
  );
}