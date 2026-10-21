import React from 'react';
import { PRESETS } from '../../audio/presets.js';

/**
 * @param {object} props
 * @param {string} props.value        — preset id
 * @param {Function} props.onChange
 * @param {boolean} [props.disabled]
 */
export default function PresetPicker({ value, onChange, disabled }) {
  const current = PRESETS.find(p => p.id === value);

  return (
    <label className="field">
      <span>Preset</span>
      <select
        value={value || 'antiDuck'}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {PRESETS.map(p => (
          <option key={p.id} value={p.id}>
            {p.label} — {p.desc}
          </option>
        ))}
      </select>
      {current && (
        <span className="small muted" style={{ marginTop: 4 }}>
          {current.desc}
        </span>
      )}
    </label>
  );
}