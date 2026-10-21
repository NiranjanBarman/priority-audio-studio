import { useCallback, useEffect, useRef, useState } from 'react';
import * as nativeBridge from '../audio/nativeBridge.js';

/**
 * useNativeEngine — React hook for the C++ WASAPI engine (M2+).
 *
 * RETURNS:
 *   {
 *     available,          boolean       — addon built and loaded
 *     reason,             string | null — why not available (if not)
 *     running,            boolean
 *     meters,             { peakL, peakR, clip, dropouts, compressorGrDb, limiterGrDb }
 *     diagnostics,        object | null — from getDiagnostics()
 *     error,              string | null
 *     init,               (opts) => Promise
 *     start,              () => Promise
 *     stop,               () => Promise
 *     reload,             () => Promise — after M2 rebuild
 *     recheck             () => Promise — re-probe availability
 *   }
 *
 * METER POLLING:
 *   Native meters come via IPC (async round-trip). We poll at ~2 Hz — NOT
 *   60 Hz. IPC at 60 Hz would saturate the main process. M4's Dashboard
 *   meter uses the Web Audio analyser (60 Hz, no IPC) for smooth visuals,
 *   and this hook's values only for the "Native active" status readout.
 *
 * FALLBACK:
 *   When `available === false` (M1 state), every method no-ops silently.
 *   Consumers show "Native engine not built (M2)" in the UI.
 *
 * @param {object} [opts]
 * @param {number} [opts.pollHz=2]  — meter poll rate
 * @param {boolean} [opts.autoProbe=true]
 */
export function useNativeEngine({ pollHz = 2, autoProbe = true } = {}) {
  const [available, setAvailable] = useState(false);
  const [reason, setReason] = useState(null);
  const [running, setRunning] = useState(false);
  const [meters, setMeters] = useState({
    peakL: 0,
    peakR: 0,
    clip: false,
    dropouts: 0,
    compressorGrDb: 0,
    limiterGrDb: 0
  });
  const [diagnostics, setDiagnostics] = useState(null);
  const [error, setError] = useState(null);

  const aliveRef = useRef(true);
  const pollTimerRef = useRef(null);

  // ── Availability probe ─────────────────────────────────────────────
  const recheck = useCallback(async () => {
    try {
      const r = await nativeBridge.isAvailable();
      if (!aliveRef.current) return r;
      setAvailable(!!r.available);
      setReason(r.reason || null);
      return r;
    } catch (e) {
      if (!aliveRef.current) return { available: false, reason: e.message };
      setAvailable(false);
      setReason(e.message);
      return { available: false, reason: e.message };
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (autoProbe) recheck();
    return () => {
      aliveRef.current = false;
    };
  }, [autoProbe, recheck]);

  // ── Meter polling ──────────────────────────────────────────────────
  useEffect(() => {
    if (!available) return undefined;

    const interval = 1000 / Math.max(1, pollHz);
    pollTimerRef.current = setInterval(async () => {
      try {
        const m = await nativeBridge.getMeters();
        if (aliveRef.current && m) setMeters(m);
      } catch {
        // Swallow — polling failure isn't fatal
      }

      // Diagnostics are heavier — poll every 5 seconds
      if (Date.now() % 5000 < interval) {
        try {
          const d = await nativeBridge.getDiagnostics();
          if (aliveRef.current) setDiagnostics(d);
        } catch {
          // Swallow
        }
      }
    }, interval);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [available, pollHz]);

  // ── Control methods ────────────────────────────────────────────────
  const init = useCallback(async (options = {}) => {
    setError(null);
    const r = await nativeBridge.init(options);
    if (!r.ok) {
      setError(r.reason || 'Native init failed');
      return r;
    }
    setRunning(false);
    return r;
  }, []);

  const start = useCallback(async () => {
    setError(null);
    const r = await nativeBridge.start();
    if (r && r.ok === false) {
      setError(r.reason || 'Native start failed');
      return r;
    }
    setRunning(true);
    return r;
  }, []);

  const stop = useCallback(async () => {
    setError(null);
    const r = await nativeBridge.stop();
    setRunning(false);
    return r;
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    setRunning(false);
    await recheck();
    const r = await nativeBridge.recheck();
    setAvailable(!!r.available);
    setReason(r.reason || null);
    return r;
  }, [recheck]);

  return {
    available,
    reason,
    running,
    meters,
    diagnostics,
    error,
    init,
    start,
    stop,
    reload,
    recheck
  };
}