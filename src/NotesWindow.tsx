import { useEffect, useState } from 'react';
import { initDb } from './db';
import NotesPanel from './components/NotesPanel';
import {
  emitNotesChanged, emitNotesNavigate, initialReferenceFromUrl, onHighlightsChanged,
  onInsertMarkdown, onNotesContext,
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
  // local counter so the Highlights tab reloads when highlights change in
  // the main window
  const [hlVersion, setHlVersion] = useState(0);

  useEffect(() => {
    initDb().then(() => setReady(true));
  }, []);

  useEffect(() => {
    let un: (() => void) | undefined;
    onHighlightsChanged(() => setHlVersion((n) => n + 1)).then((u) => { un = u; });
    return () => un?.();
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
    // NB: the window's close is left entirely native — intercepting it (e.g.
    // onCloseRequested) blocked the X from closing. The main window detects
    // this window's disappearance instead (tauri://destroyed + a self-heal
    // on the Notes button), so nothing here needs to run on close.
    return () => unlisteners.forEach((u) => u());
  }, []);

  if (!ready) return <div className="splash"><div className="brand">Notes</div><div>Opening…</div></div>;

  return (
    <div className="notes-window">
      <NotesPanel
        standalone
        refState={refState}
        selection={selection}
        onNotesChanged={emitNotesChanged}
        onNavigateVerse={(book, chapter, verse) => emitNotesNavigate({ book, chapter, verse })}
        highlightsVersion={hlVersion}
        onHighlightsChanged={() => setHlVersion((n) => n + 1)}
      />
    </div>
  );
}
