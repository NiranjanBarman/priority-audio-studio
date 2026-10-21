import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';

const PlaylistContext = createContext(null);
const STORAGE_KEY = 'pas.playlist.v1';
const MAX_PERSISTED = 200;

export function PlaylistProvider({ children }) {
  const [tracks, setTracks] = useState(() => loadPersisted());
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    try {
      const metadata = tracks.slice(0, MAX_PERSISTED).map((track) => ({
        id: track.id,
        name: track.name,
        source: track.source || 'file'
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
    } catch {
      // Storage can be unavailable; in-memory playlist state remains usable.
    }
  }, [tracks]);

  const addFiles = useCallback((files) => {
    const incoming = Array.from(files).map((file) => ({
      id: `${file.name}-${file.size}-${file.lastModified}`,
      name: file.name,
      file,
      source: 'file'
    }));

    setTracks((previous) => {
      const seen = new Set(previous.map((track) => track.id));
      return [
        ...previous,
        ...incoming.filter((track) => !seen.has(track.id))
      ];
    });

    return incoming;
  }, []);

  const remove = useCallback((id) => {
    setTracks((previous) => previous.filter((track) => track.id !== id));
    setActiveId((current) => (current === id ? null : current));
  }, []);

  const reorder = useCallback((fromIndex, toIndex) => {
    setTracks((previous) => {
      if (
        fromIndex < 0 ||
        fromIndex >= previous.length ||
        toIndex < 0 ||
        toIndex >= previous.length
      ) {
        return previous;
      }

      const next = previous.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setTracks([]);
    setActiveId(null);
  }, []);

  const get = useCallback(
    (id) => tracks.find((track) => track.id === id) || null,
    [tracks]
  );

  const nextId = useCallback(() => {
    if (tracks.length === 0) return null;
    const index = tracks.findIndex((track) => track.id === activeId);
    return tracks[index < 0 ? 0 : (index + 1) % tracks.length].id;
  }, [tracks, activeId]);

  const prevId = useCallback(() => {
    if (tracks.length === 0) return null;
    const index = tracks.findIndex((track) => track.id === activeId);
    const previousIndex =
      index < 0 ? tracks.length - 1 : (index - 1 + tracks.length) % tracks.length;
    return tracks[previousIndex].id;
  }, [tracks, activeId]);

  const value = useMemo(
    () => ({
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
    }),
    [
      tracks,
      activeId,
      addFiles,
      remove,
      reorder,
      clear,
      get,
      nextId,
      prevId
    ]
  );

  return (
    <PlaylistContext.Provider value={value}>
      {children}
    </PlaylistContext.Provider>
  );
}

export function usePlaylist() {
  const context = useContext(PlaylistContext);
  if (!context) {
    throw new Error('usePlaylist must be used within a PlaylistProvider');
  }
  return context;
}

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((track) => track && typeof track.id === 'string')
      .map((track) => ({
        id: track.id,
        name: track.name || track.id,
        file: null,
        source: track.source || 'file'
      }));
  } catch {
    return [];
  }
}
