import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

// How much room the menu wants below the button before it flips above it.
const MENU_MAX_HEIGHT = 240;
const GAP = 4;

// The "✎ ▾" dropdown shared by the Highlights and Links tabs: create a
// new free-floating note from the item, or append it to an existing one.
// The menu is portalled to <body> and positioned with fixed coordinates —
// both tabs scroll, and an absolutely positioned menu was being clipped by
// them.
export default function NoteTargetMenu({ buildMarkdown, onAdded }: NoteTargetMenuProps) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Anchor the menu under the button, flipping above it only when the
  // space below is too tight to be usable.
  const place = useCallback(() => {
    const btn = rootRef.current?.firstElementChild;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - GAP * 2;
    const above = r.top - GAP * 2;
    const flip = below < Math.min(MENU_MAX_HEIGHT, above) && above > below;
    const maxHeight = Math.max(120, Math.min(MENU_MAX_HEIGHT, flip ? above : below));
    const width = menuRef.current?.offsetWidth ?? 200;
    setPos({
      top: flip ? Math.max(GAP, r.top - GAP - maxHeight) : r.bottom + GAP,
      left: Math.max(GAP, Math.min(r.left, window.innerWidth - width - GAP)),
      maxHeight,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    place();
  }, [open, notes, place]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // any scroll moves the anchor out from under the menu — close rather
    // than leave it stranded
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

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
      <button className="hl-note-btn" onClick={toggle} title="Add to a note" aria-label="Add to a note" aria-expanded={open}>✎ ▾</button>
      {open && createPortal(
        <div
          className="hl-note-menu"
          ref={menuRef}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.maxHeight ?? MENU_MAX_HEIGHT }}
        >
          <button className="hl-note-new" onClick={create}>＋ New note</button>
          {notes.length > 0 && <div className="hl-note-sep">Add to existing</div>}
          {notes.map((n) => (
            <button key={n.id} onClick={() => append(n)} title={noteMenuLabel(n)}>
              {noteMenuLabel(n)}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
