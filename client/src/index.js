import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

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
