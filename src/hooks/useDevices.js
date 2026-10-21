import { useEffect, useState, useCallback } from 'react';
import { listDevices, findCableInput } from '../audio/devices.js';

/**
 * useDevices — enumerate audio devices + react to hot-plug events.
 *
 * RETURNS:
 *   {
 *     outputs,           MediaDeviceInfo[] — playback devices
 *     inputs,            MediaDeviceInfo[] — recording devices
 *     cableInput,        MediaDeviceInfo | null — VB-CABLE playback endpoint
 *     error,             string | null
 *     refresh,           () => Promise<void>
 *     loading            boolean
 *   }
 *
 * HOT-PLUG:
 *   `navigator.mediaDevices.addEventListener('devicechange', ...)` fires
 *   when devices are added or removed. We auto-refresh on it, so plugging
 *   in headphones mid-session updates the device dropdowns without a page
 *   reload.
 *
 * FIRST LOAD:
 *   If labels are empty (permission not yet granted), listDevices() does a
 *   one-shot getUserMedia dance to unlock labels. Subsequent refreshes use
 *   the cached permission.
 */
export function useDevices() {
  const [outputs, setOutputs] = useState([]);
  const [inputs, setInputs] = useState([]);
  const [cableInput, setCableInput] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const { outputs: outs, inputs: ins } = await listDevices();
      setOutputs(outs);
      setInputs(ins);
      setCableInput(findCableInput(outs));
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed to enumerate devices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();

    const onChange = () => refresh();
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', onChange);
      return () => {
        navigator.mediaDevices.removeEventListener('devicechange', onChange);
      };
    }
    return undefined;
  }, [refresh]);

  return { outputs, inputs, cableInput, error, refresh, loading };
}