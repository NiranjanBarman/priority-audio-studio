import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Play, Music, ChevronUp, ChevronDown, FolderPlus } from 'lucide-react';
import { useAudioEngine } from '../hooks/useAudioEngine.js';
import { usePlaylist } from '../context/PlaylistContext.jsx';
import PageHeader from '../components/layout/PageHeader.jsx';
import Toast from '../components/layout/Toast.jsx';

const ACCEPT = '.mp3,.wav,.flac,.ogg,.m4a,.aac,.opus,.webm,audio/*';

export default function Library() {
  const { engine } = useAudioEngine();
  const { tracks, activeId, setActiveId, addFiles, remove, reorder, clear } =
    usePlaylist();

  const inputRef = useRef(null);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);

  // Surface engine errors
  useEffect(() => {
    if (engine.state.error) {
      setError(engine.state.error);
      setToast({ level: 'error', message: engine.state.error });
    }
  }, [engine]);

  function handleAdd(e) {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const added = addFiles(files);
    setToast({ level: 'success', message: `Added ${added.length} track(s)` });
    // Reset input so same files can be picked again
    if (inputRef.current) inputRef.current.value = '';
  }

  async function playTrack(trackId) {
    const track = tracks.find((t) => t.id === trackId);
    if (!track || !track.file) {
      setError('Track file unavailable — re-add it. (M1 uses in-memory file objects.)');
      setToast({ level: 'warn', message: 'File missing — please re-add.' });
      return;
    }
    setError(null);
    try {
      await engine.loadFile(track.file);
      setActiveId(trackId);
      await engine.play();
      setToast({ level: 'success', message: `Playing: ${track.name}` });
    } catch (e) {
      setError(e.message);
      setToast({ level: 'error', message: e.message });
    }
  }

  function handleRemove(trackId) {
    const track = tracks.find((t) => t.id === trackId);
    if (activeId === trackId) engine.unloadFile();
    remove(trackId);
    if (track) {
      setToast({ level: 'info', message: `Removed: ${track.name}` });
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

  function handleClear() {
    if (tracks.length === 0) return;
    if (activeId) engine.unloadFile();
    clear();
    setToast({ level: 'info', message: 'Playlist cleared' });
  }

  return (
    <div>
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
          <button className="btn primary" onClick={() => inputRef.current?.click()}>
            <FolderPlus size={13} /> Add files
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            style={{ display: 'none' }}
            onChange={handleAdd}
          />
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
          <div className="muted small" style={{ padding: 10 }}>
            No tracks yet. Click <strong>Add files</strong> to start.
          </div>
        ) : (
          <div className="list">
            {tracks.map((t, idx) => {
              const isActive = activeId === t.id;
              const fileMissing = !t.file;
              return (
                <div
                  key={t.id}
                  className={'list-item' + (isActive ? ' active' : '')}
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
          <strong>M1 note:</strong> Track files stay in memory while the app is
          running, including when you switch tabs. After restarting the app,
          re-add the files to play them again.
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