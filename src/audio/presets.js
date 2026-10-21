
export const PRESETS = [
  {
    id: 'natural',
    label: 'Natural',
    desc: 'No compression. Safety limiter only.'
  },
  {
    id: 'loud',
    label: 'Loud',
    desc: 'Moderate compression, +8 dB makeup.'
  },
  {
    id: 'antiDuck',
    label: 'Anti-Duck',
    desc: 'Aggressive 20:1, +15 dB, DTX on. (DEFAULT)'
  },
  {
    id: 'bass',
    label: 'Bass',
    desc: 'Low-end emphasis with compression.'
  }
];

export const DEFAULT_PRESET = 'antiDuck';