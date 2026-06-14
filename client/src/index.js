import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
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
    <BrowserRouter basename={basename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);

// Register the service worker (prod builds only). Scope = PUBLIC_URL so it
// only controls /app/* and never intercepts the /server/api/* calls.
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${basename}sw.js`, { scope: basename })
      .catch((err) => console.warn('SW registration failed:', err));
  });
}
