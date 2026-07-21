import { useCallback, useEffect, useRef, useState } from 'react';
import { addNote, deleteNote, freeNotes, notesForChapter, setNotePinned, updateNote } from '../db';
import { renderMarkdown } from '../markdown';
import { exportAllNotes, importNotesFromFiles } from '../notesio';
import NoteEditor, { type NoteEditorHandle } from './NoteEditor';
import HighlightsTab from './HighlightsTab';
import LinksTab from './LinksTab';
import type { Note, Reference, VerseSelection } from '../types';

type AnchorKind = 'verse' | 'chapter' | 'book' | 'free';

interface NotesPanelProps {
  refState: Reference;
  selection: VerseSelection | null;
  onNotesChanged: () => void;
  onClose?: () => void;
  onPopOut?: () => void;
  // Highlights/Links tabs: navigate the reader to a verse, and refresh state
  // when highlights/links change here
  onNavigateVerse: (book: string, chapter: number, verse: number) => void;
  highlightsVersion: number;
  onHighlightsChanged: () => void;
  linksVersion: number;
  onLinksChanged: () => void;
  // popout window renders NotesPanel standalone (no docked chrome)
  standalone?: boolean;
}

function anchorLabel(n: Note): string {
  if (n.anchor_book && n.anchor_verse != null) return `${n.anchor_book} ${n.anchor_chapter}:${n.anchor_verse}`;
  if (n.anchor_book && n.anchor_chapter != null) return `${n.anchor_book} ${n.anchor_chapter} (chapter)`;
  if (n.anchor_book) return `${n.anchor_book} (book)`;
  return 'Freeform';
}

// Collapsed-header line: the title, or the first meaningful line of content.
function notePreview(n: Note): string {
  if (n.title) return n.title;
  const line = n.content.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/[#>*_`~]/g, '').replace(/^\s*[-+]\s+/, '').trim().slice(0, 60) || '(empty note)';
}

export default function NotesPanel({
  refState, selection, onNotesChanged, onClose, onPopOut,
  onNavigateVerse, highlightsVersion, onHighlightsChanged, linksVersion, onLinksChanged, standalone,
}: NotesPanelProps) {
  const [tab, setTab] = useState<'notes' | 'highlights' | 'links'>('notes');
  const [showFree, setShowFree] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [anchor, setAnchor] = useState<AnchorKind>('verse');
  const [status, setStatus] = useState('');
  // note ids expanded in the list (collapsed by default for a tidy list)
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const editorRef = useRef<NoteEditorHandle>(null);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reload = useCallback(async () => {
    setNotes(showFree ? await freeNotes() : await notesForChapter(refState.book, refState.chapter));
  }, [showFree, refState.book, refState.chapter]);

  useEffect(() => { reload(); }, [reload]);

  // default the anchor picker sensibly
  useEffect(() => {
    if (showFree) setAnchor('free');
    else if (selection) setAnchor('verse');
    else setAnchor('chapter');
  }, [selection, showFree]);

  // Scripture inserted from the reader ("Add to note") arrives as a window
  // event so it works whether the editor is docked or popped out. Bridged
  // from the Tauri cross-window event in App/NotesWindow.
  useEffect(() => {
    const onInsert = (e: Event) => {
      const md = (e as CustomEvent<string>).detail;
      if (md) editorRef.current?.insertAtCursor(md);
    };
    window.addEventListener('foundation:insert-note-md', onInsert);
    return () => window.removeEventListener('foundation:insert-note-md', onInsert);
  }, []);

  const startEdit = (n: Note) => {
    setEditing(n);
    setTitle(n.title ?? '');
    setContent(n.content);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const cancelEdit = () => {
    setEditing(null);
    setTitle('');
    setContent('');
  };

  const save = async () => {
    if (!content.trim()) return;
    if (editing) {
      await updateNote(editing.id, title.trim() || null, content.trim());
    } else {
      const base = { title: title.trim() || null, content: content.trim() };
      if (anchor === 'verse' && selection) {
        await addNote({ ...base, anchor_book: selection.book, anchor_chapter: selection.chapter, anchor_verse: selection.verse });
      } else if (anchor === 'chapter') {
        await addNote({ ...base, anchor_book: refState.book, anchor_chapter: refState.chapter });
      } else if (anchor === 'book') {
        await addNote({ ...base, anchor_book: refState.book });
      } else {
        await addNote(base);
      }
    }
    cancelEdit();
    await reload();
    onNotesChanged();
  };

  const remove = async (n: Note) => {
    if (!window.confirm('Delete this note?')) return;
    await deleteNote(n.id);
    if (editing?.id === n.id) cancelEdit();
    await reload();
    onNotesChanged();
  };

  const togglePin = async (n: Note) => {
    await setNotePinned(n.id, !n.pinned);
    await reload();
  };

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 3000);
  };

  const doExport = async () => {
    try {
      const r = await exportAllNotes();
      flash(r === 'saved' ? 'Notes exported.' : r === 'empty' ? 'No notes to export.' : '');
    } catch (e) {
      flash(`Export failed: ${String(e)}`);
    }
  };

  const doImport = async () => {
    try {
      const n = await importNotesFromFiles();
      if (n > 0) {
        await reload();
        onNotesChanged();
        flash(`Imported ${n} note${n === 1 ? '' : 's'}.`);
      }
    } catch (e) {
      flash(`Import failed: ${String(e)}`);
    }
  };

  return (
    <div className={`notes-panel${standalone ? ' notes-standalone' : ''}`}>
      <div className="notes-tabs">
        <button className={`notes-tab${tab === 'notes' ? ' active' : ''}`} onClick={() => setTab('notes')}>Notes</button>
        <button className={`notes-tab${tab === 'highlights' ? ' active' : ''}`} onClick={() => setTab('highlights')}>Highlights</button>
        <button className={`notes-tab${tab === 'links' ? ' active' : ''}`} onClick={() => setTab('links')}>Links</button>
        <span className="spacer" />
        <button className="icon" onClick={doImport} title="Import notes (Markdown, text, RTF, HTML)">📥</button>
        <button className="icon" onClick={doExport} title="Export all notes to Markdown">📤</button>
        {onPopOut && <button className="icon" onClick={onPopOut} title="Open in a separate window">⧉</button>}
        {onClose && <button className="icon" onClick={onClose} title="Close notes">✕</button>}
      </div>
      {tab === 'notes' && (
        <div className="notes-subhead">
          <button onClick={() => setShowFree(false)} disabled={!showFree}>
            {refState.book} {refState.chapter}
          </button>
          <button onClick={() => setShowFree(true)} disabled={showFree}>Free</button>
        </div>
      )}
      {status && <div className="notes-status">{status}</div>}
      {tab === 'highlights' ? (
        <HighlightsTab
          onNavigate={onNavigateVerse}
          version={highlightsVersion}
          onChanged={onHighlightsChanged}
          onNoteAdded={() => { reload(); onNotesChanged(); }}
        />
      ) : tab === 'links' ? (
        <LinksTab
          onNavigate={onNavigateVerse}
          version={linksVersion}
          onChanged={onLinksChanged}
          onNoteAdded={() => { reload(); onNotesChanged(); }}
        />
      ) : (
      <>
      <div className="notes-body">
        {notes.length === 0 && (
          <div className="pane-empty">
            {showFree ? 'No free-floating notes yet.' : `No notes on ${refState.book} ${refState.chapter} yet.`}
          </div>
        )}
        {notes.map((n) => (
          <div className={`note-card${n.pinned ? ' pinned' : ''}`} key={n.id}>
            <div className="note-card-head" onClick={() => toggleExpand(n.id)}>
              <span className="note-collapse-caret">{expanded.has(n.id) ? '▾' : '▸'}</span>
              <div className="note-head-text">
                <div className="note-anchor">{n.pinned ? '📌 ' : ''}{anchorLabel(n)}</div>
                <div className="note-head-title">{notePreview(n)}</div>
              </div>
              <button
                className={`icon note-pin${n.pinned ? ' active' : ''}`}
                onClick={(e) => { e.stopPropagation(); togglePin(n); }}
                title={n.pinned ? 'Unpin' : 'Pin to top'}
              >
                📌
              </button>
            </div>
            {expanded.has(n.id) && (
              <>
                <div className="note-content note-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.content) }} />
                <div className="note-actions">
                  <button onClick={() => startEdit(n)}>Edit</button>
                  <button className="danger" onClick={() => remove(n)}>Delete</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="note-editor">
        {editing && <div className="note-anchor">Editing note — {anchorLabel(editing)}</div>}
        {!editing && (
          <div className="row">
            <select value={anchor} onChange={(e) => setAnchor(e.target.value as AnchorKind)}>
              {selection && (
                <option value="verse">
                  {selection.book} {selection.chapter}:{selection.verse}
                </option>
              )}
              <option value="chapter">{refState.book} {refState.chapter} (chapter)</option>
              <option value="book">{refState.book} (book)</option>
              <option value="free">Freeform</option>
            </select>
          </div>
        )}
        <input type="text" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <NoteEditor ref={editorRef} value={content} onChange={setContent} placeholder="Write a note in Markdown…" />
        <div className="row">
          <button className="primary" onClick={save} disabled={!content.trim()}>
            {editing ? 'Save changes' : 'Add note'}
          </button>
          {editing && <button onClick={cancelEdit}>Cancel</button>}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
