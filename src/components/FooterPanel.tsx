import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dictionaryLookup, hasStrongsData, strongsSmartSearch, type DictionaryHit } from '../db';
import { clearSearchHistory, loadSearchHistory, pushSearchHistory } from '../searchHistory';
import ReferenceText from './ReferenceText';
import SmartSearchGroups from './SmartSearchGroups';
import type { Source, SourceCategory, StrongsSearchGroup, StrongsSearchHit } from '../types';

export type FooterTab = 'concordance' | 'dictionary' | 'commentary';

const TABS: { id: FooterTab; label: string; empty: string }[] = [
  {
    id: 'concordance',
    label: 'Concordance',
    empty: '',
  },
  {
    id: 'dictionary',
    label: 'Dictionary',
    empty: 'No dictionaries installed yet — the Library lists them under "Dictionaries".',
  },
  {
    id: 'commentary',
    label: 'Commentary',
    empty: 'Footer commentaries are coming — verse-keyed commentary that reads like a study Bible\'s footnotes. (The Companion Bible works read in their own panes.)',
  },
];

export function footerTabForCategory(category: SourceCategory): FooterTab | null {
  if (category === 'dictionary') return 'dictionary';
  return null;
}

interface FooterPanelProps {
  sources: Source[];
  tab: FooterTab;
  onSelectTab: (tab: FooterTab) => void;
  height: number;
  onResize: (height: number) => void;
  onClose: () => void;
  concordanceRequest: { term: string; seq: number };
  onOpenAsPane: (sourceId: number) => void;
  onScriptureRef: (book: string, chapter: number, verse: number | null) => void;
  onAppendixRef: (appendix: number, section: string | null) => void;
  onConcordanceNavigate: (hit: StrongsSearchHit) => void;
}

const MIN_HEIGHT = 140;

// Module-level cache so closing/reopening the footer doesn't lose results.
interface ConcordanceCache {
  input: string;
  groups: StrongsSearchGroup[];
  searchedFor: string;
  handledSeq: number;
}
let cachedConcordance: ConcordanceCache | null = null;

export default function FooterPanel({
  sources, tab, onSelectTab, height, onResize, onClose,
  concordanceRequest, onOpenAsPane,
  onScriptureRef, onAppendixRef, onConcordanceNavigate,
}: FooterPanelProps) {
  // ---- dictionary state ----
  const dictionaries = useMemo(
    () => sources.filter((s) => s.category === 'dictionary'),
    [sources],
  );
  const [dictionaryId, setDictionaryId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [letter, setLetter] = useState<string | null>(null);
  const [hits, setHits] = useState<DictionaryHit[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [error, setError] = useState('');

  // ---- concordance state ----
  const [concInput, setConcInput] = useState(cachedConcordance?.input ?? '');
  const [concGroups, setConcGroups] = useState<StrongsSearchGroup[]>(cachedConcordance?.groups ?? []);
  const [concSearched, setConcSearched] = useState(cachedConcordance?.searchedFor ?? '');
  const [concBusy, setConcBusy] = useState(false);
  const [strongsInstalled, setStrongsInstalled] = useState(true);
  const [concHistory, setConcHistory] = useState<string[]>(() => loadSearchHistory());
  const concBodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => { hasStrongsData().then(setStrongsInstalled); }, []);

  useEffect(() => {
    cachedConcordance = {
      input: concInput, groups: concGroups, searchedFor: concSearched,
      handledSeq: cachedConcordance?.handledSeq ?? 0,
    };
  }, [concInput, concGroups, concSearched]);

  const runConcordance = useCallback(async (term: string) => {
    const q = term.trim();
    if (!q) return;
    setConcBusy(true);
    try {
      setConcGroups(await strongsSmartSearch(q));
      setConcSearched(q);
      setConcHistory(pushSearchHistory(q));
      concBodyRef.current?.scrollTo({ top: 0 });
    } finally {
      setConcBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!concordanceRequest.term) return;
    if (cachedConcordance && cachedConcordance.handledSeq >= concordanceRequest.seq) return;
    cachedConcordance = {
      ...(cachedConcordance ?? { input: '', groups: [], searchedFor: '' }),
      handledSeq: concordanceRequest.seq,
    };
    setConcInput(concordanceRequest.term);
    runConcordance(concordanceRequest.term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concordanceRequest.seq]);

  // ---- dictionary logic ----
  useEffect(() => {
    setDictionaryId((prev) =>
      prev !== null && dictionaries.some((d) => d.id === prev)
        ? prev
        : dictionaries[0]?.id ?? null,
    );
  }, [dictionaries]);

  const runLookup = useCallback(async (sourceId: number, term: string, limit?: number) => {
    try {
      const rows = await dictionaryLookup(sourceId, term, limit);
      setHits(rows);
      setError('');
      setSelectedId((prev) =>
        prev !== null && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null,
      );
    } catch (e) {
      setHits([]);
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    if (dictionaryId === null) { setHits([]); setSelectedId(null); return; }
    const q = query.trim();
    if (q) void runLookup(dictionaryId, q);
    else if (letter) void runLookup(dictionaryId, letter, 1000);
    else { setHits([]); setSelectedId(null); }
  }, [dictionaryId, query, letter, runLookup]);

  // ---- resize ----
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const maxHeight = Math.round(window.innerHeight * 0.6);
    const onMove = (ev: MouseEvent) => {
      const next = startHeight + (startY - ev.clientY);
      onResize(Math.min(maxHeight, Math.max(MIN_HEIGHT, next)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const selected = hits.find((h) => h.id === selectedId) ?? null;
  const emptyMessage = TABS.find((t) => t.id === tab)?.empty ?? '';

  // ---- concordance body ----
  const concordanceBody = (
    <div className="footer-concordance">
      <div className="conc-history">
        <div className="conc-history-header">
          <span>History</span>
          {concHistory.length > 0 && (
            <button
              className="conc-history-clear"
              onClick={() => setConcHistory(clearSearchHistory())}
              title="Clear search history"
            >Clear</button>
          )}
        </div>
        <div className="conc-history-list">
          {concHistory.length === 0 && (
            <div className="conc-history-empty">No searches yet</div>
          )}
          {concHistory.map((term) => (
            <button
              key={term}
              className={`conc-history-item${term === concSearched ? ' active' : ''}`}
              onClick={() => { setConcInput(term); runConcordance(term); }}
            >{term}</button>
          ))}
        </div>
      </div>
      <div className="conc-main" ref={concBodyRef}>
        <div className="concordance-search">
          <input
            type="search"
            placeholder="Word or Strong's number (H2708)…"
            value={concInput}
            onChange={(e) => setConcInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runConcordance(concInput); }}
          />
          <button className="primary" onClick={() => runConcordance(concInput)} disabled={concBusy}>Go</button>
        </div>
        <div className="footer-concordance-results">
          {!strongsInstalled && (
            <div className="pane-empty">
              Strong's data isn't installed yet — add it via Library → Add-ons → "KJV — add Strong's numbers".
            </div>
          )}
          {strongsInstalled && !concSearched && (
            <div className="pane-empty">
              Type an English word or a Strong's number (e.g. H2708, G26) above, or click any
              dotted-underlined word in the KJV pane, to see every occurrence grouped by the
              original Hebrew/Greek word it translates.
            </div>
          )}
          {strongsInstalled && concSearched && concGroups.length === 0 && !concBusy && (
            <div className="pane-empty">No Strong's-tagged matches for "{concSearched}".</div>
          )}
          {concGroups.length > 0 && (
            <SmartSearchGroups
              term={concSearched}
              groups={concGroups}
              onNavigate={onConcordanceNavigate}
              onLookupNumber={(num) => { setConcInput(num); runConcordance(num); }}
              showSectionLabel={false}
            />
          )}
        </div>
      </div>
    </div>
  );

  // ---- dictionary body ----
  const dictionaryBody = dictionaries.length === 0 ? (
    <div className="pane-empty footer-empty">{emptyMessage}</div>
  ) : (
    <div className="footer-split">
      <div className="footer-controls">
        <input
          type="search"
          placeholder="Look up a word…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="footer-letter-grid">
          {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => (
            <button
              key={l}
              className={`footer-letter${letter === l && !query.trim() ? ' active' : ''}`}
              onClick={() => { setQuery(''); setLetter(l); }}
            >
              {l}
            </button>
          ))}
        </div>
        {dictionaries.length > 1 && (
          <select
            value={dictionaryId ?? ''}
            onChange={(e) => setDictionaryId(Number(e.target.value))}
          >
            {dictionaries.map((d) => (
              <option key={d.id} value={d.id}>{d.title}</option>
            ))}
          </select>
        )}
      </div>
      {(hits.length > 0 || error || query.trim() || letter) && (
        <div className="footer-results">
          <div className="footer-term-list">
            {hits.map((h) => (
              <button
                key={h.id}
                className={`footer-term${h.id === selectedId ? ' active' : ''}`}
                onClick={() => setSelectedId(h.id)}
              >
                {h.word}
              </button>
            ))}
            {hits.length === 0 && !error && (query.trim() || letter) && (
              <div className="footer-no-match">
                {query.trim()
                  ? <>No entries match "{query}".</>
                  : <>No entries under "{letter}".</>}
              </div>
            )}
            {error && <div className="import-warning">⚠ {error}</div>}
          </div>
        </div>
      )}
      <div className="footer-article">
        {selected ? (
          <>
            <div className="footer-article-word">{selected.word}</div>
            {selected.text.split(/\n{2,}/).map((p, i) => (
              <p key={i}>
                <ReferenceText
                  text={p}
                  context={null}
                  onScripture={onScriptureRef}
                  onAppendix={onAppendixRef}
                />
              </p>
            ))}
          </>
        ) : (
          <div className="pane-empty footer-empty">Pick a word to read its article.</div>
        )}
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (tab === 'concordance') body = concordanceBody;
  else if (tab === 'dictionary') body = dictionaryBody;
  else body = <div className="pane-empty footer-empty">{emptyMessage}</div>;

  return (
    <div className="footer-panel" style={{ height }}>
      <div className="footer-resizer" onMouseDown={startResize} title="Drag to resize" />
      <div className="notes-tabs footer-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`notes-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => onSelectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        <span className="spacer" />
        {tab === 'dictionary' && dictionaryId !== null && (
          <button
            onClick={() => onOpenAsPane(dictionaryId)}
            title="Open this dictionary in its own reading pane instead of the footer"
          >
            ⧉ Open as a pane
          </button>
        )}
        <button className="icon" onClick={onClose} title="Close the study footer">✕</button>
      </div>
      <div className="footer-body">
        {body}
      </div>
    </div>
  );
}
