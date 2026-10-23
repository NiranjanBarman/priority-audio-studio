import React from 'react';
import { Music, Mic, Cable, Headphones } from 'lucide-react';

/**
 * @param {object}   props
 * @param {boolean}  props.fileActive
 * @param {boolean}  props.micActive
 * @param {boolean}  props.monitorActive
 * @param {string}   props.outputLabel
 * @param {string}   props.monitorLabel
 */
export default function PathDiagram({
  fileActive, micActive, monitorActive,
  outputLabel, monitorLabel
}) {
  const Node = ({ active, icon: Icon, label }) => (
    <div
      style={{
        padding: '8px 10px',
        border: '1px solid ' + (active ? 'var(--accent)' : 'var(--border)'),
        borderRadius: 'var(--radius-sm)',
        background: active ? 'var(--accent-soft)' : 'var(--panel-2)',
        color: active ? 'var(--accent-2)' : 'var(--muted)',
        fontSize: 11,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        minWidth: 100
      }}
    >
      <Icon size={12} />
      <span>{label}</span>
    </div>
  );

  const Arrow = () => (
    <span style={{ color: 'var(--muted)', fontSize: 16, margin: '0 4px' }}>→</span>
  );

  return (
    <div className="card">
      <h3 className="card-title">Routing path</h3>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <Node active={fileActive}    icon={Music}  label="Local file" />
        <Node active={micActive}     icon={Mic}    label="Mic" />
        <Arrow />
        <Node active={true}          icon={Music}  label="Priority Mixer" />
        <Arrow />
        <Node active={true}          icon={Music}  label="Anti-Duck Chain" />
        <Arrow />
        <div className="row" style={{ gap: 6 }}>
          <Node active={true} icon={Cable} label={outputLabel || 'CABLE Input'} />
          <Node active={monitorActive} icon={Headphones} label={monitorLabel || 'Monitor'} />
        </div>
      </div>
    </div>
  );
}