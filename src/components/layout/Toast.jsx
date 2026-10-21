import React, { useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, Info } from 'lucide-react';

const ICONS = {
  info:    Info,
  success: CheckCircle,
  warn:    AlertTriangle,
  error:   AlertTriangle
};

const COLORS = {
  info:    'var(--accent)',
  success: 'var(--ok)',
  warn:    'var(--warn)',
  error:   'var(--danger)'
};

/**
 * @param {object}   props
 * @param {string}   props.message
 * @param {'info'|'success'|'warn'|'error'} [props.level='info']
 * @param {number}   [props.duration=3500] — ms; 0 = manual dismiss only
 * @param {Function} props.onClose
 */
export default function Toast({ message, level = 'info', duration = 3500, onClose }) {
  useEffect(() => {
    if (!duration) return;
    const t = setTimeout(() => { if (onClose) onClose(); }, duration);
    return () => clearTimeout(t);
  }, [duration, onClose]);

  if (!message) return null;

  const Icon = ICONS[level] || ICONS.info;
  const color = COLORS[level] || COLORS.info;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 1000,
        background: 'var(--panel)',
        border: '1px solid ' + color,
        borderLeft: '3px solid ' + color,
        borderRadius: 'var(--radius-sm)',
        padding: '10px 14px',
        maxWidth: 420,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
      }}
    >
      <Icon size={16} color={color} />
      <span className="small" style={{ flex: 1 }}>{message}</span>
      <button
        onClick={onClose}
        className="btn"
        style={{ padding: '2px 6px', minWidth: 0 }}
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  );
}