import { useEffect, useMemo, useRef, useState } from 'react';
import { searchAll } from '../db';
import type { SearchHit } from '../types';

interface SearchPanelProps {
  onNavigate: (hit: SearchHit) => void;
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

export default function SearchPanel({ onNavigate, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const run = async () => {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    try {
      setHits(await searchAll(q));
      setSearched(true);
    } finally {
      setBusy(false);
    }
  };

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
          {searched && hits.length === 0 && <div className="pane-empty">No results for “{query}”.</div>}
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
