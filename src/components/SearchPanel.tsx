import { useEffect, useMemo, useRef, useState } from 'react';
import { searchAll, strongsOccurrenceCount, strongsSmartSearch } from '../db';
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
  const [query, setQuery] = useState(initialQuery ?? '');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [strongsGroups, setStrongsGroups] = useState<StrongsSearchGroup[]>([]);
  const [totalOccurrences, setTotalOccurrences] = useState(0);
  // What the shown results are actually for — the hand-off button sends
  // this, not the input's current (possibly edited, un-searched) text.
  const [lastSearched, setLastSearched] = useState('');
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    inputRef.current?.focus();
    if (initialQuery) runQuery(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = () => runQuery(query);

  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      if (!map.has(h.source_title)) map.set(h.source_title, []);
      map.get(h.source_title)!.push(h);
    }
    return [...map.entries()];
  }, [hits]);

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
          {groups.map(([label, groupHits]) => (
            <div key={label}>
              <div className="search-group-label">{label} · {groupHits.length}</div>
              {groupHits.map((h) => (
                <div className="search-hit" key={`${h.kind}-${h.id}`} onClick={() => onNavigate(h)}>
                  <div className="hit-ref">{hitRef(h)}</div>
                  <div className="hit-text" dangerouslySetInnerHTML={{ __html: snippetHtml(h.snippet) }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
