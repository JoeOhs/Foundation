import { useEffect, useMemo, useRef, useState } from 'react';
import { getChapters, getEntries, getEntryNotesForEntries, getStrongsWordsForEntries, listBooks } from '../db';
import StrongsVerseText from './StrongsWords';
import type { Book, Entry, EntryNote, Reference, Source, StrongsWordRow, VerseSelection } from '../types';

export interface HighlightWord extends VerseSelection {
  wordIndex: number;
}

interface PaneProps {
  sources: Source[];
  sourceId: number;
  refState: Reference;
  // false = this pane navigates independently: its own book/chapter
  // selectors, unaffected by global navigation and scroll-sync.
  synced: boolean;
  selection: VerseSelection | null;
  notedVerses: Set<number>;
  highlightWord: HighlightWord | null;
  onSelect: (v: VerseSelection) => void;
  onChangeSource: (id: number) => void;
  onToggleSync: () => void;
  onClose: () => void;
  canClose: boolean;
  onWordClick?: (surfaceText: string) => void;
  bodyRef: (el: HTMLDivElement | null) => void;
  onScroll: () => void;
}

export default function Pane({
  sources, sourceId, refState, synced, selection, notedVerses, highlightWord,
  onSelect, onChangeSource, onToggleSync, onClose, canClose, onWordClick, bodyRef, onScroll,
}: PaneProps) {
  const source = sources.find((s) => s.id === sourceId);
  const [books, setBooks] = useState<Book[]>([]);
  const [localBook, setLocalBook] = useState<string | null>(null);
  const [localChapter, setLocalChapter] = useState<number>(1);
  const [chapters, setChapters] = useState<number[]>([]);
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hasChapters, setHasChapters] = useState(true);
  const [wordsByEntry, setWordsByEntry] = useState<Map<number, StrongsWordRow[]>>(new Map());
  const [notesByEntry, setNotesByEntry] = useState<Map<number, EntryNote[]>>(new Map());

  useEffect(() => {
    let live = true;
    listBooks(sourceId).then((b) => {
      if (!live) return;
      setBooks(b);
      setLocalBook((prev) => (prev && b.some((x) => x.name === prev) ? prev : b[0]?.name ?? null));
    });
    return () => { live = false; };
  }, [sourceId]);

  // Follows global navigation only when synced AND the source actually has
  // the current book (freeform texts without it always navigate locally).
  const hasGlobalBook = useMemo(() => books.some((b) => b.name === refState.book), [books, refState.book]);
  const followGlobal = synced && hasGlobalBook;
  const effectiveBook = followGlobal ? refState.book : localBook;

  // When unsyncing, seed local navigation from wherever the pane currently
  // is, so the reading position doesn't jump.
  const prevSynced = useRef(synced);
  useEffect(() => {
    if (prevSynced.current && !synced) {
      if (hasGlobalBook) setLocalBook(refState.book);
      setLocalChapter(activeChapter ?? refState.chapter);
    }
    prevSynced.current = synced;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [synced]);

  useEffect(() => {
    if (!effectiveBook) return;
    let live = true;
    (async () => {
      const ch = await getChapters(sourceId, effectiveBook);
      const chaptered = ch.length > 0;
      const desired = followGlobal ? refState.chapter : localChapter;
      const chapter = chaptered ? (ch.includes(desired) ? desired : ch[0]) : null;
      const rows = await getEntries(sourceId, effectiveBook, chapter);
      if (!live) return;
      setChapters(ch);
      setHasChapters(chaptered);
      setActiveChapter(chapter);
      setEntries(rows);
    })();
    return () => { live = false; };
  }, [sourceId, effectiveBook, followGlobal, refState.chapter, localChapter]);

  // Strong's tagging exists only for (an installed add-on onto) the KJV, but
  // this just asks "does this entry have any tagged words?" per chapter load
  // rather than assuming anything about the source — untagged entries (every
  // other translation, or KJV without the add-on) render exactly as before.
  useEffect(() => {
    const ids = entries.map((e) => e.id);
    if (ids.length === 0) {
      setWordsByEntry(new Map());
      setNotesByEntry(new Map());
      return;
    }
    let live = true;
    Promise.all([getStrongsWordsForEntries(ids), getEntryNotesForEntries(ids)]).then(([rows, noteRows]) => {
      if (!live) return;
      const map = new Map<number, StrongsWordRow[]>();
      for (const r of rows) {
        if (!map.has(r.entry_id)) map.set(r.entry_id, []);
        map.get(r.entry_id)!.push(r);
      }
      setWordsByEntry(map);
      const noteMap = new Map<number, EntryNote[]>();
      for (const n of noteRows) {
        if (!noteMap.has(n.entry_id)) noteMap.set(n.entry_id, []);
        noteMap.get(n.entry_id)!.push(n);
      }
      setNotesByEntry(noteMap);
    });
    return () => { live = false; };
  }, [entries]);

  const verseKeyed = entries.some((e) => e.verse !== null);

  return (
    <div className="pane">
      <div className="pane-header">
        <select value={sourceId} onChange={(e) => onChangeSource(Number(e.target.value))} title="Translation / source">
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        {!followGlobal && books.length > 0 && (
          <select
            value={localBook ?? ''}
            onChange={(e) => { setLocalBook(e.target.value); setLocalChapter(1); }}
            title="Book"
          >
            {books.map((b) => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
          </select>
        )}
        {!followGlobal && hasChapters && chapters.length > 0 && (
          <select
            className="pane-chapter-select"
            value={activeChapter ?? chapters[0]}
            onChange={(e) => setLocalChapter(Number(e.target.value))}
            title="Chapter"
          >
            {chapters.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        <button
          className="icon"
          onClick={onToggleSync}
          title={synced ? 'Synced with the other panes — click to navigate this pane independently' : 'Independent — click to re-sync with the other panes'}
        >
          {synced ? '🔗' : '⛓'}
        </button>
        {canClose && (
          <button className="icon" onClick={onClose} title="Close pane">✕</button>
        )}
      </div>
      <div className="pane-body" ref={bodyRef} onScroll={onScroll}>
        {entries.length === 0 && (
          <div className="pane-empty">
            {source ? `${source.title} has no content for ${effectiveBook ?? 'this book'} ${hasChapters && activeChapter ? activeChapter : ''}`.trim() : 'No source selected'}
          </div>
        )}
        {verseKeyed
          ? entries.map((e) => {
              const verseChapter = e.chapter ?? activeChapter ?? 1;
              const isSel =
                selection !== null &&
                effectiveBook !== null &&
                selection.book === effectiveBook &&
                selection.chapter === verseChapter &&
                selection.verse === e.verse;
              const isHighlightTarget =
                highlightWord !== null &&
                effectiveBook !== null &&
                highlightWord.book === effectiveBook &&
                highlightWord.chapter === verseChapter &&
                highlightWord.verse === e.verse;
              // Highlight every slot carrying the same Strong's number(s)
              // as the clicked occurrence — a word used twice in one verse
              // lights up in both places, not just the clicked one.
              let highlightSet: Set<number> | null = null;
              if (isHighlightTarget) {
                const rows = wordsByEntry.get(e.id) ?? [];
                const targetNumbers = new Set(
                  rows.filter((r) => r.word_index === highlightWord.wordIndex).map((r) => r.strongs_number),
                );
                highlightSet = new Set(
                  rows.filter((r) => targetNumbers.has(r.strongs_number)).map((r) => r.word_index),
                );
                if (highlightSet.size === 0) highlightSet = new Set([highlightWord.wordIndex]);
              }
              return (
                <div
                  key={e.id}
                  data-verse={e.verse ?? undefined}
                  className={`verse${isSel ? ' selected' : ''}`}
                  onClick={() =>
                    e.verse !== null &&
                    effectiveBook !== null &&
                    onSelect({ book: effectiveBook, chapter: verseChapter, verse: e.verse })
                  }
                >
                  <span className="vnum">{e.verse}</span>
                  <StrongsVerseText
                    text={e.text}
                    words={wordsByEntry.get(e.id) ?? []}
                    notes={notesByEntry.get(e.id) ?? []}
                    highlightWordIndexes={highlightSet}
                    onWordClick={onWordClick ? (slot) => onWordClick(slot.surface_text) : undefined}
                  />
                  {e.verse !== null && followGlobal && notedVerses.has(e.verse) && <span className="note-dot" title="Has notes" />}
                </div>
              );
            })
          : entries.map((e) => (
              <div key={e.id} className="section-entry" data-verse={e.sort_order + 1}>
                {e.position_ref && <div className="section-ref">{e.position_ref}</div>}
                <div className="section-text">{e.text}</div>
              </div>
            ))}
      </div>
    </div>
  );
}
