import React, { useEffect, useState } from 'react';
import { Trash2, Play, Music, ChevronUp, ChevronDown, FolderPlus, AudioLines } from 'lucide-react';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { usePlaylist } from '../context/PlaylistContext.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';
import Toast from '../components/layout/Toast.jsx';

export default function Library() {
  const { engine } = useAudioEngine();
  const { tracks, activeId, setActiveId, addFiles, remove, reorder, clear } =
    usePlaylist();

  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  // Surface engine errors
  useEffect(() => {
    if (engine.state.error) {
      setError(engine.state.error);
      setToast({ level: 'error', message: engine.state.error });
    }
  }, [engine]);

  async function handleAdd() {
    if (!window.pas?.openFiles) {
      const message = 'The native audio file picker is only available in the desktop app.';
      setError(message);
      setToast({ level: 'error', message });
      return;
    }

    try {
      const files = await window.pas.openFiles();
      if (!Array.isArray(files) || files.length === 0) return;
      const added = addFiles(files);
      setError(null);
      setToast({ level: 'success', message: `Added ${added.length} track(s)` });
    } catch (e) {
      setError(e.message);
      setToast({ level: 'error', message: `Could not add files: ${e.message}` });
    }
  }

  async function playTrack(trackId) {
    const track = tracks.find((t) => t.id === trackId);
    if (!track || !track.filePath) {
      const message = 'This saved playlist entry has no file path. Remove it and add the track again.';
      setError(message);
      setToast({ level: 'warn', message });
      return;
    }
    setError(null);
    try {
      await engine.loadFile(track.filePath, track);
      setActiveId(trackId);
      await engine.play();
      setToast({ level: 'success', message: `Playing: ${track.name}` });
    } catch (e) {
      setError(e.message);
      setToast({ level: 'error', message: e.message });
    }
  }

  async function handleRemove(trackId) {
    const track = tracks.find((t) => t.id === trackId);
    try {
      if (track?.filePath && window.pas?.deauthorizeFile) {
        await window.pas.deauthorizeFile(track.filePath);
      }
      if (activeId === trackId) engine.unloadFile();
      remove(trackId);
      if (track) {
        setToast({ level: 'info', message: `Removed: ${track.name}` });
      }
    } catch (e) {
      setError(e.message);
      setToast({ level: 'error', message: `Could not remove track: ${e.message}` });
    }
  }

  function moveUp(idx) {
    if (idx <= 0) return;
    reorder(idx, idx - 1);
  }

  function moveDown(idx) {
    if (idx >= tracks.length - 1) return;
    reorder(idx, idx + 1);
  }

  async function handleClear() {
    if (tracks.length === 0) return;
    try {
      if (window.pas?.deauthorizeFile) {
        for (const track of tracks) {
          if (track.filePath) await window.pas.deauthorizeFile(track.filePath);
        }
      }
      if (activeId) engine.unloadFile();
      clear();
      setToast({ level: 'info', message: 'Playlist cleared' });
    } catch (e) {
      setError(e.message);
      setToast({ level: 'error', message: `Could not clear playlist: ${e.message}` });
    }
  }

  return (
    <div className="library-page">
      <PageHeader
        title="Music Library"
        subtitle={`${tracks.length} track${tracks.length === 1 ? '' : 's'}`}
        actions={
          <button className="btn danger" onClick={handleClear} disabled={tracks.length === 0}>
            Clear all
          </button>
        }
      />

      {/* Add card */}
      <div className="card">
        <div className="row">
          <button className="btn primary" onClick={handleAdd}>
            <FolderPlus size={13} /> Add files
          </button>
          <span className="small muted">
            Supported: MP3, WAV, FLAC, OGG, M4A, AAC, OPUS, WEBM
          </span>
        </div>
        {error && (
          <div className="row" style={{ marginTop: 10 }}>
            <span className="small err">{error}</span>
          </div>
        )}
      </div>

      {/* Playlist */}
      <div className="card">
        <h3 className="card-title">
          <Music size={11} style={{ marginRight: 6 }} />
          Playlist
        </h3>
        {tracks.length === 0 ? (
          <div className="library-empty">
            <div className="brand-icon"><AudioLines size={22} /></div>
            <div>
              <strong>Your playlist starts here</strong>
              <div className="small muted" style={{ marginTop: 4 }}>
                Add MP3, WAV, FLAC, OGG, M4A, AAC, OPUS, or WEBM files.
              </div>
            </div>
            <button className="btn primary" onClick={handleAdd}>
              <FolderPlus size={14} /> Add your first track
            </button>
          </div>
        ) : (
          <div className="list">
            {tracks.map((t, idx) => {
              const isActive = activeId === t.id;
              const fileMissing = !t.filePath;
              return (
                <div
                  key={t.id}
                  className={'list-item' + (isActive ? ' active' : '')}
                  title={t.name}
                  style={fileMissing ? { opacity: 0.55 } : undefined}
                >
                  <span className="mono small muted" style={{ width: 28 }}>
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="name">
                    {t.name}
                    {fileMissing && (
                      <span className="small warn" style={{ marginLeft: 8 }}>
                        (re-add needed)
                      </span>
                    )}
                  </span>
                  <button
                    className="btn"
                    onClick={() => playTrack(t.id)}
                    disabled={fileMissing}
                    title="Play"
                  >
                    <Play size={12} />
                  </button>
                  <button
                    className="btn"
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    title="Move up"
                  >
                    <ChevronUp size={12} />
                  </button>
                  <button
                    className="btn"
                    onClick={() => moveDown(idx)}
                    disabled={idx === tracks.length - 1}
                    title="Move down"
                  >
                    <ChevronDown size={12} />
                  </button>
                  <button
                    className="btn danger"
                    onClick={() => handleRemove(t.id)}
                    title="Remove"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Honest M1 note */}
      <div className="card">
        <div className="small muted">
          <strong>Playlist note:</strong> File paths are saved on this device
          and remain available across app restarts. If a file is moved or
          deleted, remove it from the playlist and add it again from its new
          location.
        </div>
      </div>

      {toast && (
        <Toast
          message={toast.message}
          level={toast.level}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}