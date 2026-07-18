import { Fragment, useEffect, useState } from 'react';
import { STRONGS_HITS_PER_BOOK, getStrongsWordsForEntries, strongsSearchHitsForBook } from '../db';
import StrongsVerseText from './StrongsWords';
import type { StrongsSearchGroup, StrongsSearchHit, StrongsWordRow } from '../types';

// "H6215 — עֵשָׂו — ʻÊsâv (ay-sawv') (30)" — number, original-language
// lemma, transliteration, pronunciation when available, occurrence count.
function cardTitle(g: StrongsSearchGroup): string {
  const d = g.dict;
  const parts = [g.strongs_number];
  if (d?.lemma) parts.push(d.lemma);
  if (d?.transliteration) parts.push(d.pronunciation ? `${d.transliteration} (${d.pronunciation})` : d.transliteration);
  return `${parts.join(' — ')} (${g.total.toLocaleString()})`;
}

// Full Strong's definition, with the KJV rendering summary appended when
// both exist ("Esav, a son of Isaac… — KJV: Esau.").
function cardDefinition(g: StrongsSearchGroup): string | null {
  const d = g.dict;
  if (!d) return null;
  if (d.full_def && d.short_def) return `${d.full_def} — KJV: ${d.short_def}`;
  return d.full_def ?? d.short_def ?? null;
}

// Strong's definitions cross-reference other numbers ("a variation of
// H3068…") — render those as clickable lookups so a related original word
// is one click away instead of a manual retype.
function LinkifiedDefinition({ text, onLookupNumber }: { text: string; onLookupNumber?: (num: string) => void }) {
  if (!onLookupNumber) return <>{text}</>;
  const parts = text.split(/\b([HG]\d{1,5})\b/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="strongs-xref" onClick={() => onLookupNumber(part)} title={`Look up ${part}`}>
            {part}
          </span>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

interface SmartSearchGroupsProps {
  // The term the groups were computed for — needed to fetch a book's verse
  // hits on demand with the same match semantics.
  term: string;
  groups: StrongsSearchGroup[];
  onNavigate: (hit: StrongsSearchHit) => void;
  // Run a fresh lookup for a cross-referenced Strong's number.
  onLookupNumber?: (num: string) => void;
  // The docked concordance pane hides this label (its whole body is the
  // grouped view); the search modal shows it to separate the section from
  // the plain full-text results below.
  showSectionLabel?: boolean;
}

// The grouped-by-original-word concordance view, shared between the search
// modal (as an additive section) and the docked Concordance pane. Groups
// carry true SQL-computed totals (never capped); each group renders a
// sticky dictionary card, then collapsible per-book headers whose verse
// hits are fetched only when expanded — so a 6,000-occurrence word costs
// aggregate queries up front, not 6,000 rows.
export default function SmartSearchGroups({ term, groups, onNavigate, onLookupNumber, showSectionLabel = true }: SmartSearchGroupsProps) {
  const [openBooks, setOpenBooks] = useState<Set<string>>(new Set());
  const [hitsByKey, setHitsByKey] = useState<Map<string, StrongsSearchHit[]>>(new Map());
  const [wordsByEntry, setWordsByEntry] = useState<Map<number, StrongsWordRow[]>>(new Map());
  const [loadingKey, setLoadingKey] = useState<string | null>(null);

  useEffect(() => {
    setOpenBooks(new Set());
    setHitsByKey(new Map());
    setWordsByEntry(new Map());
  }, [groups]);

  const toggleBook = async (g: StrongsSearchGroup, book: string) => {
    const key = `${g.strongs_number}|${book}`;
    if (openBooks.has(key)) {
      setOpenBooks((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    if (!hitsByKey.has(key)) {
      setLoadingKey(key);
      try {
        const hits = await strongsSearchHitsForBook(term, g.strongs_number, book);
        const entryIds = [...new Set(hits.map((h) => h.entry_id))];
        const rows = await getStrongsWordsForEntries(entryIds);
        setHitsByKey((prev) => new Map(prev).set(key, hits));
        setWordsByEntry((prev) => {
          const next = new Map(prev);
          for (const r of rows) {
            if (!next.has(r.entry_id)) next.set(r.entry_id, []);
            next.get(r.entry_id)!.push(r);
          }
          return next;
        });
      } finally {
        setLoadingKey(null);
      }
    }
    setOpenBooks((prev) => new Set(prev).add(key));
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
              {definition && (
                <div className="strongs-card-def">
                  <LinkifiedDefinition text={definition} onLookupNumber={onLookupNumber} />
                </div>
              )}
            </div>
            {g.books.map(({ book, count }) => {
              const key = `${g.strongs_number}|${book}`;
              const open = openBooks.has(key);
              const hits = hitsByKey.get(key) ?? [];
              return (
                <div key={key} className="book-group">
                  <div className="book-group-header" onClick={() => toggleBook(g, book)}>
                    <span>{loadingKey === key ? '…' : open ? '▾' : '▸'} {book}</span>
                    <span className="book-group-count">{count.toLocaleString()}</span>
                  </div>
                  {open && (
                    <div className="book-group-hits">
                      {count > STRONGS_HITS_PER_BOOK && (
                        <div className="pane-empty" style={{ padding: 6 }}>
                          Showing first {STRONGS_HITS_PER_BOOK.toLocaleString()} of {count.toLocaleString()}.
                        </div>
                      )}
                      {hits.map((h) => (
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
