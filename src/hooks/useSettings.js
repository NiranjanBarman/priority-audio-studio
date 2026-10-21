import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadSettings,
  saveSettings,
  resetSettings,
  updateSetting
} from '../services/settingsStore.js';

/**
 * useSettings — reactive settings object with debounced auto-save.
 *
 * RETURNS:
 *   {
 *     settings,           object — the current settings
 *     set,                (key, value) => void  — update a single key
 *     setMany,            (obj) => void         — merge in multiple keys
 *     reset,              () => void            — back to defaults
 *     saveNow,            () => boolean         — force-flush pending save
 *     saving              boolean               — true during debounce window
 *   }
 *
 * DEBOUNCE:
 *   Every `set` call schedules a save 400 ms later. Rapid slider drags
 *   produce one write per release instead of hundreds. On unmount, we
 *   force-flush any pending write so nothing is lost.
 *
 * MULTI-COMPONENT SAFETY:
 *   Every consumer of useSettings gets its own React state. Two components
 *   editing the same setting will diverge until remount. This is fine for
 *   the current app (each setting lives on one page). If cross-page sync
 *   is needed later, swap localStorage for a BroadcastChannel-based store.
 */
export function useSettings() {
  const [settings, setSettings] = useState(() => loadSettings());
  const [saving, setSaving] = useState(false);
  const pendingRef = useRef(null);
  const timerRef = useRef(null);

  // Debounced save
  const scheduleSave = useCallback((next) => {
    pendingRef.current = next;
    setSaving(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (pendingRef.current) {
        saveSettings(pendingRef.current);
        pendingRef.current = null;
      }
      setSaving(false);
    }, 400);
  }, []);

  const saveNow = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (pendingRef.current) {
      const ok = saveSettings(pendingRef.current);
      pendingRef.current = null;
      setSaving(false);
      return ok;
    }
    return true;
  }, []);

  const set = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const setMany = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      scheduleSave(next);
      return next;
    });
  }, [scheduleSave]);

  const reset = useCallback(() => {
    const fresh = resetSettings();
    setSettings(fresh);
    if (pendingRef.current) {
      pendingRef.current = null;
      setSaving(false);
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Force-flush on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (pendingRef.current) {
        saveSettings(pendingRef.current);
        pendingRef.current = null;
      }
    };
  }, []);

  return { settings, set, setMany, reset, saveNow, saving };
}