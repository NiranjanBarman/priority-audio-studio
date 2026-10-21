import React from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';

/**
 * @param {object} props
 * @param {number} props.count
 */
export default function DropoutCounter({ count = 0 }) {
  const healthy = count === 0;
  return (
    <div className="row" style={{ gap: 8 }}>
      {healthy
        ? <CheckCircle size={14} color="var(--ok)" />
        : <AlertTriangle size={14} color="var(--warn)" />}
      <span className="small">
        Dropouts: <span className="mono">{count}</span>
      </span>
    </div>
  );
}