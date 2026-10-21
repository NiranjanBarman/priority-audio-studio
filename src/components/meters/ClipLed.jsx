import React from 'react';

/**
 * @param {object} props
 * @param {boolean} props.clipping
 * @param {string} [props.label='Clip']
 */
export default function ClipLed({ clipping, label = 'Clip' }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      <span className={`clip-led ${clipping ? 'on' : ''}`} />
      <span className="small muted">
        {label} {clipping ? 'DETECTED' : 'clear'}
      </span>
    </div>
  );
}