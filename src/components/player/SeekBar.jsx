import React, { useEffect, useState } from 'react';

function fmt(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * @param {object}   props
 * @param {number}   props.currentTime
 * @param {number}   props.duration
 * @param {Function} props.onSeek     — called with seconds
 * @param {boolean}  [props.disabled]
 */
export default function SeekBar({ currentTime, duration, onSeek, disabled }) {
  const [dragging, setDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);

  // Keep drag value in sync when not dragging
  useEffect(() => {
    if (!dragging) setDragValue(currentTime || 0);
  }, [currentTime, dragging]);

  const value = dragging ? dragValue : (currentTime || 0);
  const max = duration || 0;

  function handleChange(e) {
    setDragging(true);
    setDragValue(parseFloat(e.target.value));
  }

  function handleCommit() {
    if (dragging) {
      setDragging(false);
      if (onSeek) onSeek(dragValue);
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="mono small muted">{fmt(value)}</span>
        <span className="mono small muted">{fmt(max)}</span>
      </div>
      <input
        type="range"
        min="0"
        max={max || 0}
        step="0.1"
        value={value}
        disabled={disabled || !max}
        onChange={handleChange}
        onMouseUp={handleCommit}
        onTouchEnd={handleCommit}
        onKeyUp={handleCommit}
      />
    </div>
  );
}