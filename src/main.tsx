import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { normalizeStoredTheme, systemDefaultTheme } from './themes';
import './themes.css';
import './styles.css';

// Set the theme before first paint so there's no flash of the wrong one.
// Handles both current theme ids and the legacy 'dark'/'light' pref.
let storedTheme: unknown = null;
try {
  const raw = localStorage.getItem('foundation.theme');
  storedTheme = raw ? JSON.parse(raw) : null;
} catch {
  storedTheme = null;
}
document.documentElement.dataset.theme = normalizeStoredTheme(storedTheme) ?? systemDefaultTheme();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
