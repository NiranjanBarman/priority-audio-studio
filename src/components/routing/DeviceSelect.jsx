import React from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * @param {object}   props
 * @param {string}   props.label
 * @param {Array}    props.devices      — MediaDeviceInfo[]
 * @param {string}   props.value        — current deviceId
 * @param {Function} props.onChange
 * @param {Function} [props.onRefresh]
 * @param {boolean}  [props.allowEmpty]
 * @param {string}   [props.emptyLabel='— Windows default —']
 * @param {boolean}  [props.disabled]
 */
export default function DeviceSelect({
  label,
  devices = [],
  value,
  onChange,
  onRefresh,
  allowEmpty = true,
  emptyLabel = '— Windows default —',
  disabled = false
}) {
  return (
    <label className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span>{label}</span>
        {onRefresh && (
          <button
            className="btn"
            style={{ padding: '2px 8px', minWidth: 0 }}
            onClick={onRefresh}
            title="Refresh devices"
          >
            <RefreshCw size={11} />
          </button>
        )}
      </div>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {devices.map(d => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || `Device ${d.deviceId.slice(0, 8)}`}
          </option>
        ))}
      </select>
    </label>
  );
}