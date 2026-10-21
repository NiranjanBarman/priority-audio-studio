import { useEffect, useRef, useState } from 'react';
import { getEngine } from '../audio/engine.js';

/**
 * useMeters — throttled peak/clip meter values.
 *
 * WHY NOT SUBSCRIBE DIRECTLY:
 *   The engine's meters fire at requestAnimationFrame rate (~60 Hz). If
 *   we put those into React state at 60 Hz, the whole Dashboard would
 *   re-render 60 times per second — jittery and CPU-expensive.
 *
 * APPROACH:
 *   Sample the engine's current peak/clip at a configurable Hz (default 30
 *   for meters — plenty smooth, half the re-renders). Peak values are
 *   non-critical — the visual smoothly interpolates between samples.
 *
 * @param {object} [opts]
 * @param {number} [opts.hz=30] — how many samples per second
 * @returns {{ peak: number, clip: boolean }}
 */
export function useMeters({ hz = 30 } = {}) {
  const [meter, setMeter] = useState({ peak: 0, clip: false });
  const lastEmit = useRef(0);

  useEffect(() => {
    const engine = getEngine();
    const interval = 1000 / Math.max(1, hz);

    const unsub = engine.subscribe((snap) => {
      const now = performance.now();
      if (now - lastEmit.current < interval) return;
      lastEmit.current = now;
      setMeter((prev) => {
        // Avoid re-render if both values are identical (rounded peak)
        if (prev.clip === snap.clip && Math.abs(prev.peak - snap.peak) < 0.001) {
          return prev;
        }
        return { peak: snap.peak, clip: snap.clip };
      });
    });

    return unsub;
  }, [hz]);

  return meter;
}