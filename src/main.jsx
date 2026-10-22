import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { PlaylistProvider } from './context/PlaylistContext.jsx';

// ── CSS imports (ORDER MATTERS) ────────────────────────────────────────
import './styles/theme.css';
import './styles/globals.css';
import './styles/components.css';

// ── Root element ───────────────────────────────────────────────────────
const container = document.getElementById('root');

if (!container) {
  document.body.style.background = '#0e0e13';
  document.body.style.color = '#ef4444';
  document.body.style.fontFamily = 'system-ui, sans-serif';
  document.body.style.padding = '40px';
  document.body.innerHTML = `
    <h1 style="color:#ef4444">Fatal error</h1>
    <p><strong>#root element not found in index.html.</strong></p>
    <p>Ensure <code>index.html</code> contains <code>&lt;div id="root"&gt;&lt;/div&gt;</code>.</p>
  `;
  throw new Error('[PAS] #root element not found — cannot mount React');
}

// ── Mount ──────────────────────────────────────────────────────────────
const root = createRoot(container);

root.render(
  <React.StrictMode>
    <PlaylistProvider>
      <App />
    </PlaylistProvider>
  </React.StrictMode>
);

// ── Dev signal ─────────────────────────────────────────────────────────
if (import.meta.env && import.meta.env.DEV) {
  // eslint-disable-next-line no-console
  console.log(
    '%c[VPA] Voice Priority Audio — React mounted',
    'color:#8B5CF6;font-weight:bold'
  );
}