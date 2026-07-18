import { useEffect, useState } from 'react';
import { getStrongsWordsForEntries } from '../db';
import StrongsVerseText from './StrongsWords';
import type { StrongsSearchGroup, StrongsSearchHit, StrongsWordRow } from '../types';

// "H6215 — עֵשָׂו — ʻÊsâv (ay-sawv') (30)" — number, original-language
// lemma, transliteration, pronunciation when available, occurrence count.
function cardTitle(g: StrongsSearchGroup): string {
  const d = g.dict;
  const parts = [g.strongs_number];
  if (d?.lemma) parts.push(d.lemma);
  if (d?.transliteration) parts.push(d.pronunciation ? `${d.transliteration} (${d.pronunciation})` : d.transliteration);
  return `${parts.join(' — ')} (${g.hits.length})`;
}

// Full Strong's definition, with the KJV rendering summary appended when
// both exist ("Esav, a son of Isaac… — KJV: Esau.").
function cardDefinition(g: StrongsSearchGroup): string | null {
  const d = g.dict;
  if (!d) return null;
  if (d.full_def && d.short_def) return `${d.full_def} — KJV: ${d.short_def}`;
  return d.full_def ?? d.short_def ?? null;
}

interface SmartSearchGroupsProps {
  groups: StrongsSearchGroup[];
  onNavigate: (hit: StrongsSearchHit) => void;
  // The docked concordance pane hides this label (its whole body is the
  // grouped view); the search modal shows it to separate the section from
  // the plain full-text results below.
  showSectionLabel?: boolean;
}

// The grouped-by-original-word concordance view, shared between the search
// modal (as an additive section) and the docked Concordance pane. Each
// group renders a sticky dictionary card (number/lemma/pronunciation +
// definition, pinned while its occurrences scroll), followed by the
// occurrences nested under collapsible per-book headers so a common word
// isn't one endless verse list.
export default function SmartSearchGroups({ groups, onNavigate, showSectionLabel = true }: SmartSearchGroupsProps) {
  const [wordsByEntry, setWordsByEntry] = useState<Map<number, StrongsWordRow[]>>(new Map());
  // keys are `${strongs_number}|${book}` so book toggles are independent
  // across groups (Genesis under G26 vs Genesis under G5368).
  const [openBooks, setOpenBooks] = useState<Set<string>>(new Set());

  useEffect(() => {
    setOpenBooks(new Set());
    const entryIds = [...new Set(groups.flatMap((g) => g.hits.map((h) => h.entry_id)))];
    getStrongsWordsForEntries(entryIds).then((rows) => {
      const map = new Map<number, StrongsWordRow[]>();
      for (const r of rows) {
        if (!map.has(r.entry_id)) map.set(r.entry_id, []);
        map.get(r.entry_id)!.push(r);
      }
      setWordsByEntry(map);
    });
  }, [groups]);

  const toggleBook = (key: string) => {
    setOpenBooks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // hits arrive ordered by canonical book order; Map preserves it
  const booksOf = (g: StrongsSearchGroup): [string, StrongsSearchHit[]][] => {
    const map = new Map<string, StrongsSearchHit[]>();
    for (const h of g.hits) {
      if (!map.has(h.book)) map.set(h.book, []);
      map.get(h.book)!.push(h);
    }
    return [...map.entries()];
  };

  return (
    <div>
      {showSectionLabel && <div className="search-group-label">Grouped by original word (KJV)</div>}
      {groups.map((g) => {
        const definition = cardDefinition(g);
        return (
          <div key={g.strongs_number} className="strongs-group">
            <div className="strongs-card">
              <div className="strongs-card-title">{cardTitle(g)}</div>
              {definition && <div className="strongs-card-def">{definition}</div>}
            </div>
            {booksOf(g).map(([book, bookHits]) => {
              const key = `${g.strongs_number}|${book}`;
              const open = openBooks.has(key);
              return (
                <div key={key} className="book-group">
                  <div className="book-group-header" onClick={() => toggleBook(key)}>
                    <span>{open ? '▾' : '▸'} {book}</span>
                    <span className="book-group-count">{bookHits.length}</span>
                  </div>
                  {open && (
                    <div className="book-group-hits">
                      {bookHits.map((h) => (
                        <div
                          className="search-hit"
                          key={`${h.entry_id}-${h.word_index}`}
                          onClick={() => onNavigate(h)}
                        >
                          <div className="hit-ref">
                            {h.book} {h.chapter}:{h.verse} <span style={{ color: 'var(--text-dim)' }}>· {h.source_title}</span>
                          </div>
                          <div className="hit-text">
                            <StrongsVerseText
                              text={h.entry_text}
                              words={wordsByEntry.get(h.entry_id) ?? []}
                              highlightWordIndexes={new Set([h.word_index])}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
