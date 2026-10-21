import React from 'react';

const RANK_COLORS = {
  1: 'var(--accent)',
  2: 'var(--warn)',
  3: 'var(--muted)'
};

/**
 * @param {object} props
 * @param {1|2|3}  props.rank
 */
export default function PriorityRank({ rank }) {
  const color = RANK_COLORS[rank] || RANK_COLORS[3];
  const tooltip = {
    1: 'Highest priority — never ducks',
    2: 'Mid priority — ducks against rank 1 only',
    3: 'Low priority — ducks against ranks 1 & 2'
  }[rank] || '';

  return (
    <span
      title={tooltip}
      style={{
        display: 'inline-block',
        minWidth: 22,
        padding: '2px 6px',
        border: '1px solid ' + color,
        borderRadius: 4,
        color,
        fontSize: 11,
        fontWeight: 600,
        textAlign: 'center'
      }}
    >
      R{rank}
    </span>
  );
}