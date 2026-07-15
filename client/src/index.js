import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary';
import '@fontsource-variable/inter';
import './index.css';
import { bootTheme } from './utils/theme';

// Apply the saved accent + light/dark theme before first paint (no flash).
bootTheme();

// PUBLIC_URL is injected by webpack.DefinePlugin at build time.
// - Local dev: '/'
// - Catalyst Web Client Hosting: '/app/'
const basename = process.env.PUBLIC_URL || '/';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter basename={basename}>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

// Register the service worker (prod builds only). Scope = PUBLIC_URL so it
// only controls /app/* and never intercepts the /server/api/* calls.
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${basename}sw.js`, { scope: basename })
      .then((reg) => {
        // When a new worker finishes installing while an old one still controls
        // the page, it sits "waiting". Tell the app so it can offer a refresh
        // (handled by UpdatePrompt) instead of silently serving a stale build.
        const notifyIfWaiting = (worker) => {
          if (worker && worker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('veena:sw-waiting', { detail: reg }));
          }
        };
        if (reg.waiting) notifyIfWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (installing) installing.addEventListener('statechange', () => notifyIfWaiting(installing));
        });
      })
      .catch((err) => console.warn('SW registration failed:', err));

    // Once the new worker takes control (after the user accepts the refresh),
    // reload once so the fresh build renders.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}
