import { useEffect, useMemo, useState } from 'react';
import { getChapters, getEntries, listBooks } from '../db';
import type { Book, Entry, Reference, Source, VerseSelection } from '../types';

interface PaneProps {
  sources: Source[];
  sourceId: number;
  refState: Reference;
  selection: VerseSelection | null;
  notedVerses: Set<number>;
  onSelect: (v: VerseSelection) => void;
  onChangeSource: (id: number) => void;
  onClose: () => void;
  canClose: boolean;
  bodyRef: (el: HTMLDivElement | null) => void;
  onScroll: () => void;
}

export default function Pane({
  sources, sourceId, refState, selection, notedVerses,
  onSelect, onChangeSource, onClose, canClose, bodyRef, onScroll,
}: PaneProps) {
  const source = sources.find((s) => s.id === sourceId);
  const [books, setBooks] = useState<Book[]>([]);
  const [localBook, setLocalBook] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hasChapters, setHasChapters] = useState(true);

  useEffect(() => {
    let live = true;
    listBooks(sourceId).then((b) => {
      if (!live) return;
      setBooks(b);
      setLocalBook((prev) => (prev && b.some((x) => x.name === prev) ? prev : b[0]?.name ?? null));
    });
    return () => { live = false; };
  }, [sourceId]);

  // A source "follows" global navigation when it has the current book.
  const followsNav = useMemo(() => books.some((b) => b.name === refState.book), [books, refState.book]);
  const effectiveBook = followsNav ? refState.book : localBook;

  useEffect(() => {
    if (!effectiveBook) return;
    let live = true;
    (async () => {
      const chapters = await getChapters(sourceId, effectiveBook);
      const chaptered = chapters.length > 0;
      const chapter = chaptered
        ? chapters.includes(refState.chapter) ? refState.chapter : chapters[0]
        : null;
      const rows = await getEntries(sourceId, effectiveBook, chapter);
      if (!live) return;
      setHasChapters(chaptered);
      setEntries(rows);
    })();
    return () => { live = false; };
  }, [sourceId, effectiveBook, refState.chapter]);

  const verseKeyed = entries.some((e) => e.verse !== null);

  return (
    <div className="pane">
      <div className="pane-header">
        <select value={sourceId} onChange={(e) => onChangeSource(Number(e.target.value))} title="Translation / source">
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        {!followsNav && books.length > 0 && (
          <select value={localBook ?? ''} onChange={(e) => setLocalBook(e.target.value)} title="Section">
            {books.map((b) => (
              <option key={b.id} value={b.name}>{b.name}</option>
            ))}
          </select>
        )}
        {canClose && (
          <button className="icon" onClick={onClose} title="Close pane">✕</button>
        )}
      </div>
      <div className="pane-body" ref={bodyRef} onScroll={onScroll}>
        {entries.length === 0 && (
          <div className="pane-empty">
            {source ? `${source.title} has no content for ${effectiveBook ?? 'this book'} ${hasChapters ? refState.chapter : ''}`.trim() : 'No source selected'}
          </div>
        )}
        {verseKeyed
          ? entries.map((e) => {
              const isSel =
                selection !== null &&
                followsNav &&
                selection.book === refState.book &&
                selection.chapter === (e.chapter ?? refState.chapter) &&
                selection.verse === e.verse;
              return (
                <div
                  key={e.id}
                  data-verse={e.verse ?? undefined}
                  className={`verse${isSel ? ' selected' : ''}`}
                  onClick={() =>
                    e.verse !== null &&
                    followsNav &&
                    onSelect({ book: refState.book, chapter: e.chapter ?? refState.chapter, verse: e.verse })
                  }
                >
                  <span className="vnum">{e.verse}</span>
                  {e.text}
                  {e.verse !== null && followsNav && notedVerses.has(e.verse) && <span className="note-dot" title="Has notes" />}
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
