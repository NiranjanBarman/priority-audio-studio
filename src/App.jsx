import React, { Component, useState } from 'react';

import Sidebar from './components/layout/Sidebar.jsx';

import Dashboard from './pages/Dashboard.jsx';
import Library from './pages/Library.jsx';
import Mixer from './pages/Mixer.jsx';
import Equalizer from './pages/Equalizer.jsx';
import Routing from './pages/Routing.jsx';
import Settings from './pages/Settings.jsx';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[PAS] Page crashed:', error, info);
    try {
      import('./services/logger.js').then(({ log }) => {
        log(`Page crash: ${error.message}`, 'error', {
          stack: String(info?.componentStack || '').slice(0, 800)
        });
      }).catch(() => {});
    } catch {
      // logger broken — nothing more we can do
    }

    this.setState({ info });
  }

  handleRetry() {
    this.setState({ error: null, info: null });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="card" style={{ borderColor: 'var(--danger)' }}>
          <h2 className="page-title" style={{ color: 'var(--danger)' }}>
            Page crashed
          </h2>
          <p className="small" style={{ marginBottom: 12 }}>
            This page hit an unexpected error. Other pages are still functional.
            Check <strong>Settings → Log</strong> for details.
          </p>
          <div
            className="mono small"
            style={{
              background: 'var(--panel-2)',
              padding: 10,
              borderRadius: 8,
              border: '1px solid var(--border)',
              color: 'var(--danger)',
              whiteSpace: 'pre-wrap',
              marginBottom: 12,
              maxHeight: 200,
              overflow: 'auto'
            }}
          >
            {this.state.error.message}
            {this.state.info?.componentStack && (
              <>
                {'\n'}
                {this.state.info.componentStack
                  .split('\n')
                  .slice(0, 8)
                  .join('\n')}
              </>
            )}
          </div>
          <button className="btn primary" onClick={this.handleRetry}>
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Page map — keyed by tab id
// ═══════════════════════════════════════════════════════════════════════
const PAGE_MAP = {
  dashboard: Dashboard,
  library: Library,
  mixer: Mixer,
  equalizer: Equalizer,
  routing: Routing,
  settings: Settings
};

const DEFAULT_TAB = 'dashboard';

// ═══════════════════════════════════════════════════════════════════════
// App
// ═══════════════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState(DEFAULT_TAB);

  const Page = PAGE_MAP[tab] || PAGE_MAP[DEFAULT_TAB];

  return (
    <div className="app">
      <Sidebar activeTab={tab} onTabChange={setTab} />
      <main className="main">
        <ErrorBoundary key={tab}>
          <Page />
        </ErrorBoundary>
      </main>
    </div>
  );
}