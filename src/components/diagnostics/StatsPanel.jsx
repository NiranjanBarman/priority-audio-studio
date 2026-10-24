import React, { useEffect, useState } from 'react';
import { Activity, Cpu, MemoryStick, Timer, Zap, ZapOff } from 'lucide-react';
import { getDiagnostics } from '../../services/diagnostics.js';
import { getEngine } from '../../audio/engine.js';

function healthColor(score) {
  if (score >= 90) return 'var(--ok)';
  if (score >= 70) return 'var(--warn)';
  if (score >= 40) return '#f97316';
  return 'var(--danger)';
}

function fmtMs(sec) {
  if (!isFinite(sec) || sec <= 0) return '—';
  return (sec * 1000).toFixed(1) + ' ms';
}

/**
 * @param {object} props
 * @param {number} [props.refreshHz=1]
 */
export default function StatsPanel({ refreshHz = 1 }) {
  const [snap, setSnap] = useState(() => getDiagnostics().getSnapshot());
  const [health, setHealth] = useState(100);

  useEffect(() => {
    const diag = getDiagnostics();
    const engine = getEngine();
    diag.attach(engine);
    diag.start();

    const unsub = diag.subscribe((s) => {
      setSnap(s);
      setHealth(diag.getHealthScore());
    });

    return () => {
      unsub();
      // Keep diag running across page switches — only detach listeners.
    };
  }, []);

  const Row = ({ icon: Icon, label, value, color }) => (
    <div className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
      <div className="row" style={{ gap: 6 }}>
        <Icon size={12} color="var(--muted)" />
        <span className="small muted">{label}</span>
      </div>
      <span className="small mono" style={{ color: color || 'var(--text)' }}>{value}</span>
    </div>
  );

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <h3 className="card-title" style={{ margin: 0 }}>Health</h3>
        <span
          className="mono"
          style={{
            color: healthColor(health),
            fontWeight: 700,
            fontSize: 18
          }}
        >
          {health}
        </span>
      </div>
      <div className="sep" />
      <Row icon={Activity} label="AudioContext" value={snap.ctxState || '—'} />
      <Row icon={Timer} label="Sample rate" value={snap.sampleRate ? snap.sampleRate + ' Hz' : '—'} />
      <Row icon={Timer} label="Base latency" value={fmtMs(snap.baseLatency)} />
      <Row icon={Timer} label="Output latency" value={fmtMs(snap.outputLatency)} />
      <Row icon={Zap} label="Dropouts" value={snap.dropouts} color={snap.dropouts ? 'var(--warn)' : undefined} />
      <Row icon={Cpu} label="FPS (UI)" value={snap.fps || '—'} />
      <Row
        icon={MemoryStick}
        label="JS heap"
        value={snap.memory ? `${snap.memory.usedJSHeapMB} / ${snap.memory.totalJSHeapMB} MB` : '—'}
      />
      <Row
        icon={snap.nativeAvailable ? Zap : ZapOff}
        label="Native engine"
        value={snap.nativeAvailable ? 'Ready' : 'Not built'}
        color={snap.nativeAvailable ? 'var(--ok)' : 'var(--muted)'}
      />
      {snap.native && (
        <>
          <Row icon={Zap} label="Native GR" value={`${(snap.native.compressorGrDb || 0).toFixed(1)} dB`} />
          <Row icon={Zap} label="Limiter GR" value={`${(snap.native.limiterGrDb || 0).toFixed(1)} dB`} />
        </>
      )}
    </div>
  );
}