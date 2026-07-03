import { useCallback, useEffect, useState } from 'react';
import { addNote, deleteNote, freeNotes, notesForChapter, updateNote } from '../db';
import type { Note, Reference, VerseSelection } from '../types';

type AnchorKind = 'verse' | 'chapter' | 'book' | 'free';

interface NotesPanelProps {
  refState: Reference;
  selection: VerseSelection | null;
  onNotesChanged: () => void;
  onClose: () => void;
}

function anchorLabel(n: Note): string {
  if (n.anchor_book && n.anchor_verse != null) return `${n.anchor_book} ${n.anchor_chapter}:${n.anchor_verse}`;
  if (n.anchor_book && n.anchor_chapter != null) return `${n.anchor_book} ${n.anchor_chapter} (chapter)`;
  if (n.anchor_book) return `${n.anchor_book} (book)`;
  return 'Free-floating';
}

export default function NotesPanel({ refState, selection, onNotesChanged, onClose }: NotesPanelProps) {
  const [showFree, setShowFree] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [anchor, setAnchor] = useState<AnchorKind>('verse');

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

  const startEdit = (n: Note) => {
    setEditing(n);
    setTitle(n.title ?? '');
    setContent(n.content);
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

  return (
    <div className="notes-panel">
      <div className="notes-header">
        <span>Notes</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => setShowFree(false)} disabled={!showFree}>
            {refState.book} {refState.chapter}
          </button>
          <button onClick={() => setShowFree(true)} disabled={showFree}>Free</button>
          <button className="icon" onClick={onClose} title="Close notes">✕</button>
        </div>
      </div>
      <div className="notes-body">
        {notes.length === 0 && (
          <div className="pane-empty">
            {showFree ? 'No free-floating notes yet.' : `No notes on ${refState.book} ${refState.chapter} yet.`}
          </div>
        )}
        {notes.map((n) => (
          <div className="note-card" key={n.id}>
            <div className="note-anchor">{anchorLabel(n)}</div>
            {n.title && <div className="note-title">{n.title}</div>}
            <div className="note-content">{n.content}</div>
            <div className="note-actions">
              <button onClick={() => startEdit(n)}>Edit</button>
              <button className="danger" onClick={() => remove(n)}>Delete</button>
            </div>
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
              <option value="free">Free-floating</option>
            </select>
          </div>
        )}
        <input type="text" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea placeholder="Write a note…" value={content} onChange={(e) => setContent(e.target.value)} />
        <div className="row">
          <button className="primary" onClick={save} disabled={!content.trim()}>
            {editing ? 'Save changes' : 'Add note'}
          </button>
          {editing && <button onClick={cancelEdit}>Cancel</button>}
        </div>
      </div>
    </div>
  );
}
