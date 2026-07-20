import { useEffect, useMemo, useState } from 'react';
import { getChapters, getEntries, getEntryNotesForEntries, getStrongsWordsForEntries, listBooks } from '../db';
import StrongsVerseText from './StrongsWords';
import type { Book, Entry, EntryNote, Reference, Source, StrongsWordRow, VerseSelection } from '../types';

export interface HighlightWord extends VerseSelection {
  wordIndex: number;
}

// controller: leads its sync group — active book/chapter selectors drive
//   the group reference via onNavigate. Pane 1 is always group A's
//   controller; group B's controller is its lowest-index member.
// follower: mirrors its group's reference; shows a dimmed location label.
// solo: navigates entirely on its own with local selectors.
export type PaneMode = 'controller' | 'follower' | 'solo';

interface PaneProps {
  sources: Source[];
  sourceId: number;
  mode: PaneMode;
  // group reference (controller/follower); solo panes ignore it
  reference: Reference;
  // Pane 1's reference — note dots apply only when this pane is showing it
  noteAnchorRef: Reference;
  selection: VerseSelection | null;
  notedVerses: Set<number>;
  highlightWord: HighlightWord | null;
  onNavigate?: (book: string, chapter: number) => void;
  onSelect: (v: VerseSelection) => void;
  onChangeSource: (id: number) => void;
  onClose: () => void;
  canClose: boolean;
  onWordClick?: (surfaceText: string) => void;
  bodyRef: (el: HTMLDivElement | null) => void;
  onScroll: () => void;
}

export default function Pane({
  sources, sourceId, mode, reference, noteAnchorRef, selection, notedVerses, highlightWord,
  onNavigate, onSelect, onChangeSource, onClose, canClose, onWordClick, bodyRef, onScroll,
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

  // Grouped panes follow the group reference when their source has that
  // book; sources without it (freeform texts) always navigate locally.
  const hasRefBook = useMemo(() => books.some((b) => b.name === reference.book), [books, reference.book]);
  const followsRef = mode !== 'solo' && hasRefBook;
  const effectiveBook = followsRef ? reference.book : localBook;

  useEffect(() => {
    if (!effectiveBook) return;
    let live = true;
    (async () => {
      const ch = await getChapters(sourceId, effectiveBook);
      const chaptered = ch.length > 0;
      const desired = followsRef ? reference.chapter : localChapter;
      const chapter = chaptered ? (ch.includes(desired) ? desired : ch[0]) : null;
      const rows = await getEntries(sourceId, effectiveBook, chapter);
      if (!live) return;
      setChapters(ch);
      setHasChapters(chaptered);
      setActiveChapter(chapter);
      setEntries(rows);
    })();
    return () => { live = false; };
  }, [sourceId, effectiveBook, followsRef, reference.chapter, localChapter]);

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

  // Where a navigation action from THIS pane's header goes: the group
  // (controller) or this pane only (solo).
  const go = (book: string, chapter: number) => {
    if (mode === 'controller') onNavigate?.(book, chapter);
    else {
      setLocalBook(book);
      setLocalChapter(chapter);
    }
  };

  const stepChapter = async (dir: 1 | -1) => {
    if (!effectiveBook) return;
    const cur = activeChapter ?? chapters[0] ?? 1;
    const ci = chapters.indexOf(cur);
    const ni = ci + dir;
    if (ni >= 0 && ni < chapters.length) {
      go(effectiveBook, chapters[ni]);
      return;
    }
    const bi = books.findIndex((b) => b.name === effectiveBook);
    const nb = books[bi + dir];
    if (!nb) return;
    const nch = await getChapters(sourceId, nb.name);
    go(nb.name, dir === 1 ? nch[0] ?? 1 : nch[nch.length - 1] ?? 1);
  };

  const showNav = mode === 'controller' || mode === 'solo';
  const verseKeyed = entries.some((e) => e.verse !== null);
  const showsNoteAnchor =
    effectiveBook === noteAnchorRef.book && activeChapter === noteAnchorRef.chapter;

  return (
    <div className="pane">
      <div className="pane-header">
        <select value={sourceId} onChange={(e) => onChangeSource(Number(e.target.value))} title="Translation / source">
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        {showNav && books.length > 0 && (
          <select
            value={effectiveBook ?? ''}
            onChange={(e) => go(e.target.value, 1)}
            title="Book"
          >
            {books.map((b) => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
          </select>
        )}
        {showNav && hasChapters && chapters.length > 0 && (
          <select
            className="pane-chapter-select"
            value={activeChapter ?? chapters[0]}
            onChange={(e) => effectiveBook && go(effectiveBook, Number(e.target.value))}
            title="Chapter"
          >
            {chapters.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        )}
        {showNav && hasChapters && (
          <>
            <button className="icon" onClick={() => stepChapter(-1)} title="Previous chapter">◀</button>
            <button className="icon" onClick={() => stepChapter(1)} title="Next chapter">▶</button>
          </>
        )}
        {mode === 'follower' && (
          <span className="pane-loc-label" title="Following the group leader's navigation">
            {effectiveBook ?? '—'}{hasChapters && activeChapter ? ` ${activeChapter}` : ''}
          </span>
        )}
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
                  {e.verse !== null && showsNoteAnchor && notedVerses.has(e.verse) && <span className="note-dot" title="Has notes" />}
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
