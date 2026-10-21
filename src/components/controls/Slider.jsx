import React from 'react';

/**
 * @param {object} props
 * @param {string} props.label
 * @param {number} props.value
 * @param {number} props.min
 * @param {number} props.max
 * @param {number} [props.step=1]
 * @param {string} [props.unit]
 * @param {Function} props.onChange
 * @param {boolean} [props.disabled]
 * @param {Function} [props.formatValue] — override default value display
 */
export default function Slider({
  label, value, min, max, step = 1, unit = '', onChange, disabled, formatValue
}) {
  const display = formatValue
    ? formatValue(value)
    : `${value}${unit ? ' ' + unit : ''}`;

  return (
    <label className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>{label}</span>
        <span className="mono small muted">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}