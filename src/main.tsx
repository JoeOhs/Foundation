import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

// Set the theme before first paint so there's no flash of the wrong mode.
const stored = localStorage.getItem('foundation.theme');
const override = stored ? (JSON.parse(stored) as 'dark' | 'light' | null) : null;
document.documentElement.dataset.theme =
  override ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
