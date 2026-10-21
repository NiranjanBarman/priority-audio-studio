import React, { useEffect, useRef, useState } from 'react';
import { getLogs, subscribeLogs, clearLogs, exportLogs } from '../../services/logger.js';

const LEVEL_COLOR = {
  debug: 'var(--muted)',
  info:  'var(--text)',
  warn:  'var(--warn)',
  error: 'var(--danger)'
};

/**
 * @param {object} props
 * @param {number} [props.maxHeight=340]
 * @param {number} [props.maxEntries=200]
 */
export default function LogViewer({ maxHeight = 340, maxEntries = 200 }) {
  const [logs, setLogs] = useState(getLogs());
  const bottomRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    const unsub = subscribeLogs(() => {
      setLogs(getLogs());
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [logs, autoScroll]);

  function handleCopy() {
    const text = exportLogs();
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  const visible = logs.slice(-maxEntries);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 className="card-title" style={{ margin: 0 }}>
          Log ({logs.length})
        </h3>
        <div className="row" style={{ gap: 6 }}>
          <label className="row small" style={{ gap: 4 }}>
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button className="btn" onClick={handleCopy} disabled={logs.length === 0}>
            Copy
          </button>
          <button
            className="btn"
            onClick={() => { clearLogs(); setLogs([]); }}
            disabled={logs.length === 0}
          >
            Clear
          </button>
        </div>
      </div>
      <div
        className="mono small"
        style={{
          maxHeight,
          overflow: 'auto',
          background: 'var(--panel-2)',
          padding: 10,
          borderRadius: 8,
          border: '1px solid var(--border)'
        }}
      >
        {visible.length === 0 && <div className="muted">No entries.</div>}
        {visible.map((l) => (
          <div key={l.id} style={{ color: LEVEL_COLOR[l.level] || 'var(--text)' }}>
            [{new Date(l.t).toLocaleTimeString()}] {l.msg}
            {l.ctx && (
              <span className="muted"> · {JSON.stringify(l.ctx)}</span>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}