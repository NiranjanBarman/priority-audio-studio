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

export function PlaylistProvider({ children }) {
  const [tracks, setTracks] = useState(() => loadPersisted());
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    try {
      const metadata = tracks.map((track) => ({
        id: track.id,
        name: track.name,
        filePath: track.filePath,
        size: track.size,
        ext: track.ext,
        source: track.source || 'file'
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(metadata));
    } catch (error) {
      console.error('[playlist] Could not persist playlist metadata:', error);
    }
  }, [tracks]);

  const addFiles = useCallback((files) => {
    const seen = new Set(tracks.map((track) => track.id));
    const incoming = [];

    for (const file of Array.from(files)) {
      if (!file || typeof file.path !== 'string' || !file.path) continue;
      const id = file.path.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      incoming.push({
        id,
        name: file.name || file.path.split(/[\\/]/).pop(),
        filePath: file.path,
        size: Number(file.size) || 0,
        ext: file.ext || '',
        source: 'file'
      });
    }

    setTracks((previous) => {
      const currentIds = new Set(previous.map((track) => track.id));
      return [
        ...previous,
        ...incoming.filter((track) => !currentIds.has(track.id))
      ];
    });

    return incoming;
  }, [tracks]);

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
      .map((track) => {
        const filePath = typeof track.filePath === 'string' ? track.filePath : '';
        return {
          id: filePath ? filePath.toLowerCase() : track.id,
          name: track.name || track.id,
          filePath,
          size: Number(track.size) || 0,
          ext: typeof track.ext === 'string' ? track.ext : '',
          source: track.source || 'file'
        };
      });
  } catch (error) {
    console.error('[playlist] Could not load persisted playlist:', error);
    return [];
  }
}
