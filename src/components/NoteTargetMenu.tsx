import { useEffect, useRef, useState } from 'react';
import { addNote, allNotes, updateNote } from '../db';
import { emitNotesChanged } from '../notesbus';
import type { Note } from '../types';

function noteMenuLabel(n: Note): string {
  if (n.title) return n.title;
  if (n.anchor_book && n.anchor_verse != null) return `${n.anchor_book} ${n.anchor_chapter}:${n.anchor_verse}`;
  if (n.anchor_book && n.anchor_chapter != null) return `${n.anchor_book} ${n.anchor_chapter}`;
  if (n.anchor_book) return n.anchor_book;
  const firstLine = n.content.split('\n').find((l) => l.trim()) ?? '';
  return firstLine.replace(/[#>*_`]/g, '').trim().slice(0, 40) || 'Untitled note';
}

interface NoteTargetMenuProps {
  // produce the markdown to insert (a verse blockquote, a link fragment, …)
  buildMarkdown: () => string;
  // called after a note is created or appended (refresh the caller's state)
  onAdded: () => void;
}

// The "✎ Note ▾" dropdown shared by the Highlights and Links tabs: create a
// new free-floating note from the item, or append it to an existing one.
export default function NoteTargetMenu({ buildMarkdown, onAdded }: NoteTargetMenuProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setNotes(await allNotes());
    setOpen(true);
  };

  const done = () => { setOpen(false); emitNotesChanged(); onAdded(); };
  const create = async () => {
    try {
      await addNote({ content: buildMarkdown() });
      done();
    } catch (e) {
      window.alert(`Couldn't create the note: ${String(e)}`);
    }
  };
  const append = async (n: Note) => {
    try {
      await updateNote(n.id, n.title, `${n.content.trim()}\n\n${buildMarkdown()}`);
      done();
    } catch (e) {
      window.alert(`Couldn't add to the note: ${String(e)}`);
    }
  };

  return (
    <div className="hl-note-wrap" ref={rootRef}>
      <button onClick={toggle} title="Add to a note">✎ Note ▾</button>
      {open && (
        <div className="hl-note-menu">
          <button className="hl-note-new" onClick={create}>＋ New note</button>
          {notes.length > 0 && <div className="hl-note-sep">Add to existing</div>}
          {notes.map((n) => (
            <button key={n.id} onClick={() => append(n)} title={noteMenuLabel(n)}>
              {noteMenuLabel(n)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
