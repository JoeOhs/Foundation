import { useEffect, useMemo, useRef, useState } from 'react';
import { searchAll, strongsOccurrenceCount, strongsSmartSearch } from '../db';
import { clearSearchHistory, loadSearchHistory, pushSearchHistory } from '../searchHistory';
import SmartSearchGroups from './SmartSearchGroups';
import type { SearchHit, SourceCategory, StrongsSearchGroup, StrongsSearchHit } from '../types';

interface SearchPanelProps {
  initialQuery?: string;
  onNavigate: (hit: SearchHit) => void;
  onNavigateStrongs: (hit: StrongsSearchHit) => void;
  onMoveToConcordance: (term: string) => void;
  onClose: () => void;
}

type SearchScope = SourceCategory | 'all';

const SCOPE_OPTIONS: { id: SearchScope; label: string }[] = [
  { id: 'all', label: 'All sources' },
  { id: 'bible', label: 'Bibles' },
  { id: 'commentary', label: 'Commentaries' },
  { id: 'reference', label: 'Reference' },
  { id: 'historical', label: 'Historical' },
  { id: 'patristic', label: 'Church Fathers' },
  { id: 'rabbinic', label: 'Rabbinic' },
];

interface SearchSession {
  query: string;
  hits: SearchHit[];
  entryTotals: { source_title: string; total: number }[];
  strongsGroups: StrongsSearchGroup[];
  totalOccurrences: number;
  lastSearched: string;
  searched: boolean;
  scope: SearchScope;
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
  if (h.position_ref) return h.position_ref;
  if (h.book && h.chapter != null) return `${h.book} ${h.chapter}`;
  return h.book ?? '';
}

export default function SearchPanel({ initialQuery, onNavigate, onNavigateStrongs, onMoveToConcordance, onClose }: SearchPanelProps) {
  // A word click passes initialQuery and starts a fresh lookup; a plain
  // open restores the cached session from the last time the modal was up.
  const restore = initialQuery ? null : cachedSession;
  const [query, setQuery] = useState(initialQuery ?? restore?.query ?? '');
  const [hits, setHits] = useState<SearchHit[]>(restore?.hits ?? []);
  const [entryTotals, setEntryTotals] = useState<{ source_title: string; total: number }[]>(restore?.entryTotals ?? []);
  const [strongsGroups, setStrongsGroups] = useState<StrongsSearchGroup[]>(restore?.strongsGroups ?? []);
  const [totalOccurrences, setTotalOccurrences] = useState(restore?.totalOccurrences ?? 0);
  const [lastSearched, setLastSearched] = useState(restore?.lastSearched ?? '');
  const [searched, setSearched] = useState(restore?.searched ?? false);
  const [scope, setScope] = useState<SearchScope>(restore?.scope ?? 'bible');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<string[]>(loadSearchHistory);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cachedSession = { query, hits, entryTotals, strongsGroups, totalOccurrences, lastSearched, searched, scope };
  }, [query, hits, entryTotals, strongsGroups, totalOccurrences, lastSearched, searched, scope]);

  const runQuery = async (term: string, searchScope?: SearchScope) => {
    const q = term.trim();
    if (!q) return;
    const activeScope = searchScope ?? scope;
    const catFilter = activeScope === 'all' ? null : activeScope;
    setBusy(true);
    try {
      const isBibleScope = activeScope === 'bible';
      const [plain, smart, total] = await Promise.all([
        searchAll(q, catFilter),
        isBibleScope ? strongsSmartSearch(q) : Promise.resolve([]),
        isBibleScope ? strongsOccurrenceCount(q) : Promise.resolve(0),
      ]);
      setHits(plain.hits);
      setEntryTotals(plain.entryTotals);
      setStrongsGroups(smart);
      setTotalOccurrences(total);
      setLastSearched(q);
      setSearched(true);
      setHistory(pushSearchHistory(q));
    } catch (e) {
      console.error('[SEARCH ERROR]', e);
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

  const changeScope = (newScope: SearchScope) => {
    setScope(newScope);
    if (lastSearched) runQuery(lastSearched, newScope);
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
            placeholder={scope === 'bible' ? 'Search Bible text and notes…' : `Search ${SCOPE_OPTIONS.find((o) => o.id === scope)?.label ?? 'all sources'}…`}
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
        <div className="search-scope">
          {SCOPE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className={`search-scope-chip${scope === opt.id ? ' active' : ''}`}
              onClick={() => changeScope(opt.id)}
              disabled={busy}
            >
              {opt.label}
            </button>
          ))}
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
          {!searched && <div className="pane-empty">Press <kbd>Enter</kbd> to search{scope === 'bible' ? ' Bible text and' : ''} notes.</div>}
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
                  title="Open this in the study footer's concordance tab"
                  style={{ fontSize: 11, padding: '2px 8px' }}
                >
                  Open in Study →
                </button>
              </div>
              <SmartSearchGroups
                term={lastSearched}
                groups={strongsGroups}
                onNavigate={onNavigateStrongs}
                onLookupNumber={runFromHistory}
                showSectionLabel={false}
              />
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
            const trueTotal = entryTotals.find((t) => t.source_title === label)?.total ?? groupHits.length;
            return (
              <div key={label}>
                <div className="search-group-label">
                  {label} · {trueTotal.toLocaleString()}
                  {trueTotal > groupHits.length ? ` (showing first ${groupHits.length})` : ''}
                </div>
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
