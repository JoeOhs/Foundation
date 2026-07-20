import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { initDb } from './db';
import NotesPanel from './components/NotesPanel';
import {
  emitNotesChanged, emitNotesClosed, initialReferenceFromUrl, onInsertMarkdown, onNotesContext,
} from './notesbus';
import type { Reference, VerseSelection } from './types';

// Root of the popped-out notes window (a separate Tauri webview). Shares
// the app's SQLite database; receives the main window's current reference,
// selection, and scripture insertions over Tauri events.
export default function NotesWindow() {
  const [ready, setReady] = useState(false);
  const [refState, setRefState] = useState<Reference>(() =>
    initialReferenceFromUrl({ book: 'Genesis', chapter: 1 }),
  );
  const [selection, setSelection] = useState<VerseSelection | null>(null);

  useEffect(() => {
    initDb().then(() => setReady(true));
  }, []);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    onNotesContext((ctx) => {
      setRefState(ctx.ref);
      setSelection(ctx.selection);
    }).then((u) => unlisteners.push(u));
    // scripture "Add to note" from the main reader → local editor insert
    onInsertMarkdown((md) =>
      window.dispatchEvent(new CustomEvent('foundation:insert-note-md', { detail: md })),
    ).then((u) => unlisteners.push(u));
    // Tell the main window we're gone so it restores the docked panel.
    // Tauri window close doesn't reliably fire DOM `beforeunload`, so use
    // the window's own close lifecycle; keep beforeunload as a backup.
    getCurrentWindow()
      .onCloseRequested(() => emitNotesClosed())
      .then((u) => unlisteners.push(u));
    const onUnload = () => emitNotesClosed();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unlisteners.forEach((u) => u());
      window.removeEventListener('beforeunload', onUnload);
    };
  }, []);

  if (!ready) return <div className="splash"><div className="brand">Notes</div><div>Opening…</div></div>;

  return (
    <div className="notes-window">
      <NotesPanel
        standalone
        refState={refState}
        selection={selection}
        onNotesChanged={emitNotesChanged}
      />
    </div>
  );
}
