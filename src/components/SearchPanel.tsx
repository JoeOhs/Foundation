import { useEffect, useMemo, useRef, useState } from 'react';
import { searchAll, strongsOccurrenceCount, strongsSmartSearch } from '../db';
import { clearSearchHistory, loadSearchHistory, pushSearchHistory } from '../searchHistory';
import SmartSearchGroups from './SmartSearchGroups';
import type { SearchHit, StrongsSearchGroup, StrongsSearchHit } from '../types';

interface SearchPanelProps {
  initialQuery?: string;
  onNavigate: (hit: SearchHit) => void;
  onNavigateStrongs: (hit: StrongsSearchHit) => void;
  // Promote the current lookup to the docked concordance pane.
  onMoveToConcordance: (term: string) => void;
  onClose: () => void;
}

// The modal unmounts on close, so its last session lives here at module
// scope — reopening restores the query and results instead of losing them
// to an accidental Escape/overlay click. (Reset on full reload, which is
// fine: the persistent, bounded history below covers re-running.)
interface SearchSession {
  query: string;
  hits: SearchHit[];
  strongsGroups: StrongsSearchGroup[];
  totalOccurrences: number;
  lastSearched: string;
  searched: boolean;
}
let cachedSession: SearchSession | null = null;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Snippets come back with <mark> tags from FTS; escape everything else.
function snippetHtml(s: string): string {
  return escapeHtml(s)
    .replace(/&lt;mark&gt;/g, '<mark>')
    .replace(/&lt;\/mark&gt;/g, '</mark>');
}

function hitRef(h: SearchHit): string {
  if (h.book && h.verse != null) return `${h.book} ${h.chapter}:${h.verse}`;
  if (h.book && h.chapter != null) return `${h.book} ${h.chapter}`;
  if (h.position_ref) return h.position_ref;
  return h.book ?? '';
}

export default function SearchPanel({ initialQuery, onNavigate, onNavigateStrongs, onMoveToConcordance, onClose }: SearchPanelProps) {
  // A word click passes initialQuery and starts a fresh lookup; a plain
  // open restores the cached session from the last time the modal was up.
  const restore = initialQuery ? null : cachedSession;
  const [query, setQuery] = useState(initialQuery ?? restore?.query ?? '');
  const [hits, setHits] = useState<SearchHit[]>(restore?.hits ?? []);
  const [strongsGroups, setStrongsGroups] = useState<StrongsSearchGroup[]>(restore?.strongsGroups ?? []);
  const [totalOccurrences, setTotalOccurrences] = useState(restore?.totalOccurrences ?? 0);
  // What the shown results are actually for — the hand-off button sends
  // this, not the input's current (possibly edited, un-searched) text.
  const [lastSearched, setLastSearched] = useState(restore?.lastSearched ?? '');
  const [searched, setSearched] = useState(restore?.searched ?? false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(loadSearchHistory);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the module-scope cache current so closing the modal at any moment
  // (Escape, overlay click, ✕) loses nothing.
  useEffect(() => {
    cachedSession = { query, hits, strongsGroups, totalOccurrences, lastSearched, searched };
  }, [query, hits, strongsGroups, totalOccurrences, lastSearched, searched]);

  const runQuery = async (term: string) => {
    const q = term.trim();
    if (!q) return;
    setBusy(true);
    try {
      const [plain, smart, total] = await Promise.all([
        searchAll(q), strongsSmartSearch(q), strongsOccurrenceCount(q),
      ]);
      setHits(plain);
      setStrongsGroups(smart);
      setTotalOccurrences(total);
      setLastSearched(q);
      setSearched(true);
      setHistory(pushSearchHistory(q));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // Select-all so typing immediately replaces a restored query.
    inputRef.current?.focus();
    inputRef.current?.select();
    if (initialQuery) runQuery(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = () => runQuery(query);

  const runFromHistory = (term: string) => {
    setQuery(term);
    runQuery(term);
  };

  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      if (!map.has(h.source_title)) map.set(h.source_title, []);
      map.get(h.source_title)!.push(h);
    }
    return [...map.entries()];
  }, [hits]);

  // Per-source book toggles for the full-text results, keyed
  // `${source}|${book}` so the same book under two versions is independent.
  const [openBooks, setOpenBooks] = useState<Set<string>>(new Set());
  useEffect(() => { setOpenBooks(new Set()); }, [hits]);
  const toggleBook = (key: string) => {
    setOpenBooks((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const renderHit = (h: SearchHit) => (
    <div className="search-hit" key={`${h.kind}-${h.id}`} onClick={() => onNavigate(h)}>
      <div className="hit-ref">{hitRef(h)}</div>
      <div className="hit-text" dangerouslySetInnerHTML={{ __html: snippetHtml(h.snippet) }} />
    </div>
  );

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <input
            ref={inputRef}
            type="search"
            placeholder="Search all sources and notes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') run();
              if (e.key === 'Escape') onClose();
            }}
          />
          <button className="primary" onClick={run} disabled={busy}>Search</button>
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        {history.length > 0 && (
          <div className="search-history">
            <span className="search-history-label">Recent:</span>
            {history.map((term) => (
              <button key={term} className="search-history-chip" onClick={() => runFromHistory(term)} disabled={busy}>
                {term}
              </button>
            ))}
            <button
              className="search-history-chip search-history-clear"
              onClick={() => setHistory(clearSearchHistory())}
              title="Clear search history"
            >
              clear
            </button>
          </div>
        )}
        <div className="modal-body">
          {!searched && <div className="pane-empty">Press <kbd>Enter</kbd> to search verse text, imported texts, and notes.</div>}
          {searched && hits.length === 0 && strongsGroups.length === 0 && (
            <div className="pane-empty">No results for “{query}”.</div>
          )}
          {strongsGroups.length > 0 && (
            <div>
              <div className="search-group-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>
                  Grouped by original word (KJV) · “{lastSearched}…” — {totalOccurrences.toLocaleString()} total occurrence{totalOccurrences === 1 ? '' : 's'}
                </span>
                <button
                  onClick={() => onMoveToConcordance(lastSearched)}
                  title="Continue this lookup in the docked concordance pane"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                >
                  Open in pane →
                </button>
              </div>
              <SmartSearchGroups groups={strongsGroups} onNavigate={onNavigateStrongs} showSectionLabel={false} />
            </div>
          )}
          {groups.map(([label, groupHits]) => {
            const byBook = new Map<string, SearchHit[]>();
            for (const h of groupHits) {
              const b = h.book ?? h.position_ref ?? '—';
              if (!byBook.has(b)) byBook.set(b, []);
              byBook.get(b)!.push(h);
            }
            const books = [...byBook.entries()];
            return (
              <div key={label}>
                <div className="search-group-label">{label} · {groupHits.length}</div>
                {books.length <= 1
                  // single container (My Notes, freeform texts): nesting
                  // would just add a click — render flat
                  ? groupHits.map(renderHit)
                  : books.map(([book, bookHits]) => {
                      const key = `${label}|${book}`;
                      const open = openBooks.has(key);
                      return (
                        <div key={key} className="book-group">
                          <div className="book-group-header" onClick={() => toggleBook(key)}>
                            <span>{open ? '▾' : '▸'} {book}</span>
                            <span className="book-group-count">{bookHits.length}</span>
                          </div>
                          {open && <div className="book-group-hits">{bookHits.map(renderHit)}</div>}
                        </div>
                      );
                    })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
