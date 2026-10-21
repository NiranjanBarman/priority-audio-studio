import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'pas.playlist.v1';
const MAX_PERSISTED = 200;

/**
 * usePlaylist — playlist state machine with optional persistence.
 *
 * TRACK SHAPE:
 *   {
 *     id:   string,         // `${name}-${size}-${lastModified}`
 *     name: string,
 *     file: File,           // in-memory only; not persisted
 *     source: 'file'
 *   }
 *
 * PERSISTENCE CAVEAT:
 *   `File` objects cannot go through localStorage. We persist the METADATA
 *   (id, name) and re-request the File from the user on next session — OR,
 *   with pas-audio:// (M2+), the path. For M1, persistence is metadata only;
 *   the playlist appears but tracks must be re-added to play. This is
 *   HONEST: M1 doesn't secretly store file contents.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.persist=true]
 */
export function usePlaylist({ persist = true } = {}) {
  const [tracks, setTracks] = useState(() => loadPersisted());
  const [activeId, setActiveId] = useState(null);

  // Persist metadata (no file) on every change
  useEffect(() => {
    if (!persist) return;
    try {
      const meta = tracks.slice(0, MAX_PERSISTED).map((t) => ({
        id: t.id,
        name: t.name,
        source: t.source || 'file'
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
    } catch {
      // Storage full or disabled — non-fatal
    }
  }, [tracks, persist]);

  /** Add one or more File objects. Dedupes by id. */
  const addFiles = useCallback((files) => {
    const incoming = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      file,
      source: 'file'
    }));
    setTracks((prev) => {
      const seen = new Set(prev.map((t) => t.id));
      return [...prev, ...incoming.filter((t) => !seen.has(t.id))];
    });
    return incoming;
  }, []);

  /** Remove by id. Clears activeId if the removed track was active. */
  const remove = useCallback((id) => {
    setTracks((prev) => prev.filter((t) => t.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  /** Move from one index to another (drag-drop or up/down buttons). */
  const reorder = useCallback((fromIdx, toIdx) => {
    setTracks((prev) => {
      if (fromIdx < 0 || fromIdx >= prev.length) return prev;
      if (toIdx < 0 || toIdx >= prev.length) return prev;
      const next = prev.slice();
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  }, []);

  /** Remove all tracks. Keeps the active track unset. */
  const clear = useCallback(() => {
    setTracks([]);
    setActiveId(null);
  }, []);

  /** Find a track by id. */
  const get = useCallback(
    (id) => tracks.find((t) => t.id === id) || null,
    [tracks]
  );

  /** Next track id (wraps). Returns null if playlist is empty. */
  const nextId = useCallback(() => {
    if (tracks.length === 0) return null;
    const idx = tracks.findIndex((t) => t.id === activeId);
    const nextIdx = idx < 0 ? 0 : (idx + 1) % tracks.length;
    return tracks[nextIdx].id;
  }, [tracks, activeId]);

  /** Previous track id (wraps). Returns null if playlist is empty. */
  const prevId = useCallback(() => {
    if (tracks.length === 0) return null;
    const idx = tracks.findIndex((t) => t.id === activeId);
    const prevIdx =
      idx < 0
        ? tracks.length - 1
        : (idx - 1 + tracks.length) % tracks.length;
    return tracks[prevIdx].id;
  }, [tracks, activeId]);

  return {
    tracks,
    activeId,
    setActiveId,
    addFiles,
    remove,
    reorder,
    clear,
    get,
    nextId,
    prevId
  };
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Metadata-only — File is missing until user re-adds.
    return parsed
      .filter((t) => t && typeof t.id === 'string')
      .map((t) => ({
        id: t.id,
        name: t.name || t.id,
        file: null,
        source: t.source || 'file'
      }));
  } catch {
    return [];
  }
}