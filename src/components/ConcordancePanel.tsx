import { useEffect, useRef, useState } from 'react';
import { hasStrongsData, strongsSmartSearch } from '../db';
import SmartSearchGroups from './SmartSearchGroups';
import type { StrongsSearchGroup, StrongsSearchHit } from '../types';

interface ConcordancePanelProps {
  // Set externally when a tagged word is clicked in the reader or a search
  // is promoted from the modal; seq increments on every send so repeat
  // sends of the same term still re-run. The panel also lets the user type
  // queries directly.
  request: { term: string; seq: number };
  onNavigate: (hit: StrongsSearchHit) => void;
  onClose: () => void;
}

// A docked concordance: the same grouped-by-original-word view as the search
// modal, but persistent beside the Bible panes with its own scrollbar, so a
// long study session doesn't mean repeatedly opening and closing the search
// window. Verse clicks navigate the reader panes without closing this panel.
export default function ConcordancePanel({ request, onNavigate, onClose }: ConcordancePanelProps) {
  const [input, setInput] = useState(request.term);
  const [groups, setGroups] = useState<StrongsSearchGroup[]>([]);
  const [searchedFor, setSearchedFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [dataInstalled, setDataInstalled] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { hasStrongsData().then(setDataInstalled); }, []);

  const run = async (term: string) => {
    const q = term.trim();
    if (!q) return;
    setBusy(true);
    try {
      setGroups(await strongsSmartSearch(q));
      setSearchedFor(q);
      bodyRef.current?.scrollTo({ top: 0 });
    } finally {
      setBusy(false);
    }
  };

  // An external send (word click / modal hand-off) — mirror the term into
  // the input and run the lookup. Keyed on seq, not term, so re-sends of
  // the same word still re-run after the user searched something else here.
  useEffect(() => {
    if (!request.term) return;
    setInput(request.term);
    run(request.term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.seq]);

  return (
    <div className="notes-panel concordance-panel">
      <div className="notes-header">
        <span>Concordance</span>
        <button className="icon" onClick={onClose} title="Close concordance">✕</button>
      </div>
      <div className="concordance-search">
        <input
          type="search"
          placeholder="Word to trace…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') run(input); }}
        />
        <button className="primary" onClick={() => run(input)} disabled={busy}>Go</button>
      </div>
      <div className="notes-body" ref={bodyRef}>
        {!dataInstalled && (
          <div className="pane-empty">
            Strong’s data isn’t installed yet — add it via 🌐 Library → Add-ons → “KJV — add Strong’s numbers”.
          </div>
        )}
        {dataInstalled && !searchedFor && (
          <div className="pane-empty">
            Type a word above, or click any dotted-underlined word in the KJV pane, to see every
            occurrence grouped by the original Hebrew/Greek word it translates.
          </div>
        )}
        {dataInstalled && searchedFor && groups.length === 0 && !busy && (
          <div className="pane-empty">No Strong’s-tagged matches for “{searchedFor}”.</div>
        )}
        {groups.length > 0 && (
          <SmartSearchGroups groups={groups} onNavigate={onNavigate} showSectionLabel={false} />
        )}
      </div>
    </div>
  );
}
