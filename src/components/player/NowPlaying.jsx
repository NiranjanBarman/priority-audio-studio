import React from 'react';
import { Music, Radio, Mic } from 'lucide-react';

const ICONS = {
  file: Music,
  system: Radio,
  mic: Mic
};

/**
 * @param {object} props
 * @param {string|null} props.trackName
 * @param {'file'|'system'|'mic'} [props.source='file']
 */
export default function NowPlaying({ trackName, source = 'file' }) {
  const Icon = ICONS[source] || Music;
  return (
    <div className="row" style={{ gap: 8 }}>
      <Icon size={14} color="var(--accent-2)" />
      <span className="mono small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {trackName || 'No track loaded'}
      </span>
    </div>
  );
}