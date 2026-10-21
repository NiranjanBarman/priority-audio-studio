import { useEffect, useRef, useState, useCallback } from 'react';
import { getEngine } from '../audio/engine.js';

/**
 * useAudioEngine — React hook wrapping the AudioEngine singleton.
 *
 * RETURNS:
 *   { engine, state, ready }
 *     engine  — the AudioEngine instance (call methods directly)
 *     state   — reactive snapshot: playing, currentTrack, volume, peak, clip...
 *     ready   — true once engine.init() has completed at least once
 *
 * AUTO-INIT:
 *   The engine needs a user gesture to create an AudioContext (Chromium
 *   policy). This hook does NOT auto-init — Dashboard's "Start Engine" or
 *   Play button does. But it DOES auto-subscribe so state is live as soon
 *   as init happens.
 *
 * CLEANUP:
 *   The engine is a singleton and intentionally NOT disposed on unmount
 *   (multiple components consume it). Only the subscription is removed.
 *   Call engine.dispose() explicitly from Settings page if needed.
 */
export function useAudioEngine() {
  const engineRef = useRef(null);
  if (!engineRef.current) {
    engineRef.current = getEngine();
  }
  const engine = engineRef.current;

  const [state, setState] = useState(() => ({ ...engine.state }));
  const [ready, setReady] = useState(!!engine.state.ready);

  useEffect(() => {
    // Subscribe to engine state changes
    const unsub = engine.subscribe((snap) => {
      setState(snap);
      setReady(!!snap.ready);
    });

    // Immediately sync in case state changed between render and effect
    setState({ ...engine.state });
    setReady(!!engine.state.ready);

    return unsub;
  }, [engine]);

  return { engine, state, ready };
}