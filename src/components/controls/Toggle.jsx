import React from 'react';

/**
 * Toggle — checkbox-based on/off switch with optional label + description.
 *
 * RENDERS: a real <input type="checkbox">, styled via globals.css +
 * components.css. NOT a slider. If you need a range control, use
 * Slider.jsx.
 *
 * @param {object}   props
 * @param {string}   props.label
 * @param {boolean}  props.checked
 * @param {Function} props.onChange        — receives boolean
 * @param {string}   [props.description]   — optional helper text below
 * @param {boolean}  [props.disabled]
 */
export default function Toggle({
  label,
  checked,
  onChange,
  description,
  disabled = false
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        className="row"
        style={{
          gap: 8,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1
        }}
      >
        <input
          type="checkbox"
          checked={!!checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="small">{label}</span>
      </label>
      {description && (
        <div className="small muted" style={{ marginLeft: 24 }}>
          {description}
        </div>
      )}
    </div>
  );
}