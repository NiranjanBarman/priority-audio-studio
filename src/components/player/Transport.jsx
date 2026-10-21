import React from 'react';
import { Play, Pause, Square } from 'lucide-react';

/**
 * @param {object}   props
 * @param {boolean}  props.playing
 * @param {boolean}  [props.disabled]
 * @param {Function} props.onPlay
 * @param {Function} props.onPause
 * @param {Function} props.onStop
 */
export default function Transport({ playing, disabled, onPlay, onPause, onStop }) {
  return (
    <div className="row">
      {playing ? (
        <button className="btn primary" onClick={onPause} disabled={disabled}>
          <Pause size={14} /> Pause
        </button>
      ) : (
        <button className="btn primary" onClick={onPlay} disabled={disabled}>
          <Play size={14} /> Play
        </button>
      )}
      <button className="btn" onClick={onStop} disabled={disabled}>
        <Square size={14} /> Stop
      </button>
    </div>
  );
}