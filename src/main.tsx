import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import NotesWindow from './NotesWindow';
import { isNotesWindow } from './notesbus';
import { normalizeStoredTheme, systemDefaultTheme } from './themes';
import { applyReaderFont, normalizeStoredFont } from './fonts';
import './themes.css';
import './styles.css';

// Set theme + reader font before first paint so there's no flash of the
// wrong one. Handles current ids and the legacy 'dark'/'light' theme pref.
function readPref(key: string): unknown {
  try {
    const raw = localStorage.getItem(`foundation.${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
document.documentElement.dataset.theme = normalizeStoredTheme(readPref('theme')) ?? systemDefaultTheme();
applyReaderFont(normalizeStoredFont(readPref('readerFont')) ?? 'georgia');

// The popped-out notes window loads the same bundle with ?window=notes.
const Root = isNotesWindow() ? NotesWindow : App;

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
