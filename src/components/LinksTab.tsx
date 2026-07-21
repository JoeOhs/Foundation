import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addNote, allNotes, deleteLink, listHighlighters, listLinks, setLinkHighlighter, updateNote,
} from '../db';
import { emitLinksChanged, emitNotesChanged } from '../notesbus';
import { highlightBackground } from './Pane';
import { linkToMarkdown } from '../scripture';
import type { Highlighter, LinkRow, Note } from '../types';

interface LinksTabProps {
  onNavigate: (book: string, chapter: number, verse: number) => void;
  version: number;
  onChanged: () => void;
  onNoteAdded: () => void;
}

function noteMenuLabel(n: Note): string {
  if (n.title) return n.title;
  if (n.anchor_book && n.anchor_verse != null) return `${n.anchor_book} ${n.anchor_chapter}:${n.anchor_verse}`;
  if (n.anchor_book) return n.anchor_book;
  const firstLine = n.content.split('\n').find((l) => l.trim()) ?? '';
  return firstLine.replace(/[#>*_`]/g, '').trim().slice(0, 40) || 'Untitled note';
}

export default function LinksTab({ onNavigate, version, onChanged, onNoteAdded }: LinksTabProps) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [highlighters, setHighlighters] = useState<Highlighter[]>([]);
  const [noteMenuFor, setNoteMenuFor] = useState<number | null>(null);
  const [notesList, setNotesList] = useState<Note[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    setLinks(await listLinks());
    setHighlighters(await listHighlighters());
  }, []);
  useEffect(() => { reload(); }, [reload, version]);

  useEffect(() => {
    if (noteMenuFor === null) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setNoteMenuFor(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [noteMenuFor]);

  const changed = () => { emitLinksChanged(); onChanged(); reload(); };

  const loose = async (l: LinkRow) => {
    await deleteLink(l.id);
    changed();
  };

  const associate = async (l: LinkRow, highlighterId: number | null) => {
    await setLinkHighlighter(l.id, l.highlighter_id === highlighterId ? null : highlighterId);
    changed();
  };

  const linkMarkdown = (l: LinkRow) =>
    linkToMarkdown(
      { book: l.book_a, chapter: l.chapter_a, verse: l.verse_a, text: l.text_a, sourceTitle: '' },
      { book: l.book_b, chapter: l.chapter_b, verse: l.verse_b, text: l.text_b, sourceTitle: '' },
    );

  const openNoteMenu = async (l: LinkRow) => {
    if (noteMenuFor === l.id) { setNoteMenuFor(null); return; }
    setNotesList(await allNotes());
    setNoteMenuFor(l.id);
  };
  const afterNoteWrite = () => { setNoteMenuFor(null); emitNotesChanged(); onNoteAdded(); };
  const createNoteFrom = async (l: LinkRow) => { await addNote({ content: linkMarkdown(l) }); afterNoteWrite(); };
  const appendToNote = async (n: Note, l: LinkRow) => {
    await updateNote(n.id, n.title, `${n.content.trim()}\n\n${linkMarkdown(l)}`);
    afterNoteWrite();
  };

  return (
    <div className="links-tab">
      {links.length === 0 && (
        <div className="pane-empty">
          No links yet. Select a verse, click 🔗 Link in the action bar, then select another verse and Bind them.
        </div>
      )}
      {links.map((l) => (
        <div className="link-item" key={l.id} style={l.color ? { borderColor: l.color } : undefined}>
          <div className="link-endpoints">
            <button className="link-ref" onClick={() => onNavigate(l.book_a, l.chapter_a, l.verse_a)} title={l.text_a}>
              {l.book_a} {l.chapter_a}:{l.verse_a}
            </button>
            <span className="link-arrow">🔗</span>
            <button className="link-ref" onClick={() => onNavigate(l.book_b, l.chapter_b, l.verse_b)} title={l.text_b}>
              {l.book_b} {l.chapter_b}:{l.verse_b}
            </button>
          </div>
          {(l.text_a || l.text_b) && (
            <div className="link-texts">
              {l.text_a && <div className="link-text-snippet">{l.text_a}</div>}
              {l.text_b && <div className="link-text-snippet">{l.text_b}</div>}
            </div>
          )}
          <div className="link-actions">
            <span className="link-associate" title="Associate a highlighter color">
              {highlighters.map((h) => (
                <button
                  key={h.id}
                  className={`hl-swatch${l.highlighter_id === h.id ? ' picked' : ''}`}
                  style={{ background: highlightBackground(h.color), borderColor: h.color }}
                  onClick={() => associate(l, h.id)}
                  title={h.label}
                />
              ))}
            </span>
            <span className="spacer" />
            <div className="hl-note-wrap">
              <button onClick={() => openNoteMenu(l)} title="Add this link to a note">✎ Note ▾</button>
              {noteMenuFor === l.id && (
                <div className="hl-note-menu" ref={menuRef}>
                  <button className="hl-note-new" onClick={() => createNoteFrom(l)}>＋ New note</button>
                  {notesList.length > 0 && <div className="hl-note-sep">Add to existing</div>}
                  {notesList.map((n) => (
                    <button key={n.id} onClick={() => appendToNote(n, l)} title={noteMenuLabel(n)}>
                      {noteMenuLabel(n)}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="danger" onClick={() => loose(l)} title="Remove this link">Loose</button>
          </div>
        </div>
      ))}
    </div>
  );
}
