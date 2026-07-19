import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getChapters, initDb, listBooks, listSources, notesForChapter } from './db';
import { repairSeededTextsIfNeeded, seedIfEmpty } from './seed';
import Pane, { type HighlightWord } from './components/Pane';
import NotesPanel from './components/NotesPanel';
import SearchPanel from './components/SearchPanel';
import ImportWizard from './components/ImportWizard';
import LibraryPanel from './components/LibraryPanel';
import ConcordancePanel from './components/ConcordancePanel';
import ThemePicker from './components/ThemePicker';
import { applyTheme, normalizeStoredTheme, systemDefaultTheme, type ThemeId } from './themes';
import { applyReaderFont, normalizeStoredFont, type FontId } from './fonts';
import type { Book, Reference, SearchHit, Source, StrongsSearchHit, VerseSelection } from './types';

function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`foundation.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function savePref<T>(key: string, value: T): void {
  localStorage.setItem(`foundation.${key}`, JSON.stringify(value));
}

export default function App() {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [splashMsg, setSplashMsg] = useState('Opening library…');
  const [errorMsg, setErrorMsg] = useState('');

  const [sources, setSources] = useState<Source[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [chapters, setChapters] = useState<number[]>([]);
  const [refState, setRefState] = useState<Reference>(() => loadPref('ref', { book: 'Genesis', chapter: 1 }));
  const [paneSourceIds, setPaneSourceIds] = useState<number[]>(() => loadPref('panes', []));
  const [paneFlex, setPaneFlex] = useState<number[]>(() => loadPref('paneFlex', []));
  const [selection, setSelection] = useState<VerseSelection | null>(null);
  const [notedVerses, setNotedVerses] = useState<Set<number>>(new Set());
  const [highlightWord, setHighlightWord] = useState<HighlightWord | null>(null);

  const [notesOpen, setNotesOpen] = useState<boolean>(() => loadPref('notesOpen', false));
  const [concordanceOpen, setConcordanceOpen] = useState<boolean>(() => loadPref('concordanceOpen', false));
  // seq bumps on every send so the pane re-runs the lookup even when the
  // same term is sent twice (the user may have searched something else in
  // the pane in between).
  const [concordanceReq, setConcordanceReq] = useState<{ term: string; seq: number }>({ term: '', seq: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchInitialQuery, setSearchInitialQuery] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const openSearch = (prefill?: string) => {
    setSearchInitialQuery(prefill ?? null);
    setSearchOpen(true);
  };

  const sendToConcordance = (term: string) => {
    setConcordanceReq((prev) => ({ term, seq: prev.seq + 1 }));
    setConcordanceOpen(true);
  };

  // Clicking a tagged word: if the docked concordance pane is already open,
  // feed it in place; otherwise fall back to the search modal (which has an
  // "open in pane" button for promoting the session to the docked view).
  const handleWordClick = (surfaceText: string) => {
    if (concordanceOpen) sendToConcordance(surfaceText);
    else openSearch(surfaceText);
  };

  // theme: null = follow OS (Obsidian on dark systems, Nova on light).
  // Legacy stored 'dark'/'light' values migrate via normalizeStoredTheme.
  const [themeOverride, setThemeOverride] = useState<ThemeId | null>(() =>
    normalizeStoredTheme(loadPref<unknown>('theme', null)),
  );
  const [readerSize, setReaderSize] = useState<number>(() => loadPref('readerSize', 17));
  const [readerFont, setReaderFont] = useState<FontId>(
    () => normalizeStoredFont(loadPref<unknown>('readerFont', null)) ?? 'georgia',
  );

  const bodies = useRef<(HTMLDivElement | null)[]>([]);
  const activePane = useRef<number>(-1);
  const booted = useRef(false);

  // ---------- boot ----------
  useEffect(() => {
    // StrictMode double-invokes effects in dev; seeding must only run once.
    if (booted.current) return;
    booted.current = true;
    (async () => {
      try {
        await initDb();
        await seedIfEmpty(setSplashMsg);
        await repairSeededTextsIfNeeded(setSplashMsg);
        const srcs = await listSources();
        setSources(srcs);
        setPaneSourceIds((prev) => {
          const valid = prev.filter((id) => srcs.some((s) => s.id === id));
          if (valid.length > 0) return valid;
          const bibles = srcs.filter((s) => s.type === 'bible').map((s) => s.id);
          return bibles.length >= 2 ? bibles.slice(0, 2) : srcs.slice(0, 1).map((s) => s.id);
        });
        setPhase('ready');
      } catch (e) {
        console.error(e);
        setErrorMsg(String(e));
        setPhase('error');
      }
    })();
  }, []);

  // ---------- theme ----------
  const theme: ThemeId = themeOverride ?? systemDefaultTheme();
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const listener = () => {
      if (themeOverride === null) applyTheme(systemDefaultTheme());
    };
    mq.addEventListener('change', listener);
    return () => mq.removeEventListener('change', listener);
  }, [themeOverride]);

  useEffect(() => {
    document.documentElement.style.setProperty('--reader-size', `${readerSize}px`);
    savePref('readerSize', readerSize);
  }, [readerSize]);

  useEffect(() => {
    applyReaderFont(readerFont);
    savePref('readerFont', readerFont);
  }, [readerFont]);

  // ---------- persistence ----------
  useEffect(() => { savePref('ref', refState); }, [refState]);
  useEffect(() => { savePref('panes', paneSourceIds); }, [paneSourceIds]);
  useEffect(() => { savePref('paneFlex', paneFlex); }, [paneFlex]);
  useEffect(() => { savePref('notesOpen', notesOpen); }, [notesOpen]);
  useEffect(() => { savePref('concordanceOpen', concordanceOpen); }, [concordanceOpen]);
  useEffect(() => { savePref('theme', themeOverride); }, [themeOverride]);

  // ---------- navigation data ----------
  const primaryBible = useMemo(() => {
    const shown = paneSourceIds
      .map((id) => sources.find((s) => s.id === id))
      .filter((s): s is Source => !!s && s.type === 'bible');
    return shown[0] ?? sources.find((s) => s.type === 'bible') ?? sources[0] ?? null;
  }, [paneSourceIds, sources]);

  useEffect(() => {
    if (!primaryBible) return;
    let live = true;
    listBooks(primaryBible.id).then((b) => {
      if (!live) return;
      setBooks(b);
      if (b.length > 0 && !b.some((x) => x.name === refState.book)) {
        setRefState({ book: b[0].name, chapter: 1 });
      }
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryBible]);

  useEffect(() => {
    if (!primaryBible) return;
    let live = true;
    getChapters(primaryBible.id, refState.book).then((c) => { if (live) setChapters(c); });
    return () => { live = false; };
  }, [primaryBible, refState.book]);

  const reloadNoteDots = useCallback(async () => {
    const notes = await notesForChapter(refState.book, refState.chapter);
    setNotedVerses(new Set(notes.filter((n) => n.anchor_verse != null).map((n) => n.anchor_verse as number)));
  }, [refState.book, refState.chapter]);

  useEffect(() => {
    if (phase === 'ready') reloadNoteDots();
  }, [phase, reloadNoteDots]);

  // clear verse selection and word highlight when leaving the chapter
  useEffect(() => {
    setSelection((sel) =>
      sel && sel.book === refState.book && sel.chapter === refState.chapter ? sel : null,
    );
    setHighlightWord((hw) =>
      hw && hw.book === refState.book && hw.chapter === refState.chapter ? hw : null,
    );
  }, [refState]);

  // ---------- chapter navigation ----------
  const navigate = (book: string, chapter: number) => setRefState({ book, chapter });

  const step = (dir: 1 | -1) => {
    const ci = chapters.indexOf(refState.chapter);
    const next = ci + dir;
    if (next >= 0 && next < chapters.length) {
      navigate(refState.book, chapters[next]);
      return;
    }
    const bi = books.findIndex((b) => b.name === refState.book);
    const nb = books[bi + dir];
    if (!nb || !primaryBible) return;
    if (dir === 1) navigate(nb.name, 1);
    else {
      getChapters(primaryBible.id, nb.name).then((c) => navigate(nb.name, c[c.length - 1] ?? 1));
    }
  };

  // ---------- scroll sync ----------
  const handleScroll = (i: number) => {
    if (activePane.current !== i) return;
    const el = bodies.current[i];
    if (!el) return;
    const verses = el.querySelectorAll<HTMLElement>('[data-verse]');
    let topVerse: string | null = null;
    for (const v of verses) {
      if (v.offsetTop + v.offsetHeight > el.scrollTop + 4) {
        topVerse = v.dataset.verse ?? null;
        break;
      }
    }
    if (topVerse === null) return;
    bodies.current.forEach((other, j) => {
      if (j === i || !other) return;
      const target = other.querySelector<HTMLElement>(`[data-verse="${topVerse}"]`);
      if (target) other.scrollTop = target.offsetTop;
    });
  };

  // scroll all panes to the top when the reference changes
  useEffect(() => {
    bodies.current.forEach((el) => { if (el) el.scrollTop = 0; });
  }, [refState]);

  // scroll to the selected verse when navigating from search
  const scrollToVerse = (verse: number) => {
    // wait for panes to load the new chapter before scrolling
    setTimeout(() => {
      bodies.current.forEach((el) => {
        const target = el?.querySelector<HTMLElement>(`[data-verse="${verse}"]`);
        if (el && target) el.scrollTop = Math.max(0, target.offsetTop - 40);
      });
    }, 150);
  };

  // ---------- panes ----------
  const setPaneSource = (i: number, id: number) => {
    setPaneSourceIds((prev) => prev.map((p, j) => (j === i ? id : p)));
  };

  const addPane = () => {
    if (paneSourceIds.length >= 4 || sources.length === 0) return;
    const unused = sources.find((s) => !paneSourceIds.includes(s.id)) ?? sources[0];
    setPaneSourceIds((prev) => [...prev, unused.id]);
    setPaneFlex((prev) => [...prev, 1]);
  };

  const closePane = (i: number) => {
    setPaneSourceIds((prev) => prev.filter((_, j) => j !== i));
    setPaneFlex((prev) => prev.filter((_, j) => j !== i));
    bodies.current.splice(i, 1);
  };

  const startResize = (i: number, e: React.MouseEvent) => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement!;
    const total = container.clientWidth;
    const startX = e.clientX;
    const flex = paneFlex.length === paneSourceIds.length ? [...paneFlex] : paneSourceIds.map(() => 1);
    const sum = flex.reduce((a, b) => a + b, 0);
    const onMove = (ev: MouseEvent) => {
      const deltaFrac = ((ev.clientX - startX) / total) * sum;
      const next = [...flex];
      next[i - 1] = Math.max(0.25, flex[i - 1] + deltaFrac);
      next[i] = Math.max(0.25, flex[i] - deltaFrac);
      setPaneFlex(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ---------- search navigation ----------
  const handleSearchNavigate = (hit: SearchHit) => {
    setSearchOpen(false);
    if (hit.kind === 'note') {
      setNotesOpen(true);
      if (hit.book && books.some((b) => b.name === hit.book)) {
        navigate(hit.book, hit.chapter ?? 1);
        if (hit.verse != null && hit.chapter != null) {
          setSelection({ book: hit.book, chapter: hit.chapter, verse: hit.verse });
          scrollToVerse(hit.verse);
        }
      }
      return;
    }
    if (hit.book && books.some((b) => b.name === hit.book)) {
      // canonical text: make sure its source is visible, then navigate
      if (hit.source_id != null && !paneSourceIds.includes(hit.source_id)) {
        setPaneSource(0, hit.source_id);
      }
      navigate(hit.book, hit.chapter ?? 1);
      if (hit.verse != null && hit.chapter != null) {
        setSelection({ book: hit.book, chapter: hit.chapter, verse: hit.verse });
        scrollToVerse(hit.verse);
      }
    } else if (hit.source_id != null) {
      // freeform text: show its source in the first pane
      setPaneSource(0, hit.source_id);
    }
  };

  // Shared by the search modal and the docked concordance pane: bring the
  // hit's source into view, navigate, select, and highlight the exact word.
  const goToStrongsHit = (hit: StrongsSearchHit) => {
    if (!paneSourceIds.includes(hit.source_id)) {
      setPaneSource(0, hit.source_id);
    }
    navigate(hit.book, hit.chapter);
    setSelection({ book: hit.book, chapter: hit.chapter, verse: hit.verse });
    setHighlightWord({ book: hit.book, chapter: hit.chapter, verse: hit.verse, wordIndex: hit.word_index });
    scrollToVerse(hit.verse);
  };

  const handleStrongsNavigate = (hit: StrongsSearchHit) => {
    setSearchOpen(false);
    goToStrongsHit(hit);
  };

  const refreshSources = async () => {
    setSources(await listSources());
  };

  // ---------- keyboard shortcuts ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setImportOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---------- render ----------
  if (phase === 'loading') {
    return (
      <div className="splash">
        <div className="brand">Foundation</div>
        <div>{splashMsg}</div>
      </div>
    );
  }
  if (phase === 'error') {
    return (
      <div className="splash">
        <div className="brand">Foundation</div>
        <div>Something went wrong while opening the library:</div>
        <div style={{ color: 'var(--danger)', maxWidth: 600 }}>{errorMsg}</div>
      </div>
    );
  }

  const flex = paneFlex.length === paneSourceIds.length ? paneFlex : paneSourceIds.map(() => 1);

  return (
    <div className="app">
      <div className="toolbar">
        <span className="brand">Foundation</span>
        <select
          value={refState.book}
          onChange={(e) => navigate(e.target.value, 1)}
          title="Book"
        >
          {books.map((b) => (
            <option key={b.id} value={b.name}>{b.name}</option>
          ))}
        </select>
        <select
          value={refState.chapter}
          onChange={(e) => navigate(refState.book, Number(e.target.value))}
          title="Chapter"
        >
          {(chapters.length > 0 ? chapters : [refState.chapter]).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <button className="icon" onClick={() => step(-1)} title="Previous chapter">◀</button>
        <button className="icon" onClick={() => step(1)} title="Next chapter">▶</button>
        <button onClick={addPane} disabled={paneSourceIds.length >= 4} title="Add a parallel pane">+ Pane</button>
        <span className="spacer" />
        <button onClick={() => openSearch()} title="Search (Ctrl+F)">🔍 Search</button>
        <button onClick={() => setConcordanceOpen((v) => !v)} title="Toggle concordance pane">🔤 Concordance</button>
        <button onClick={() => setLibraryOpen(true)} title="Download public domain texts">🌐 Library</button>
        <button onClick={() => setImportOpen(true)} title="Import a text">📥 Import</button>
        <button onClick={() => setNotesOpen((v) => !v)} title="Toggle notes panel">📝 Notes</button>
        <button className="icon" onClick={() => setReaderSize((s) => Math.max(12, s - 1))} title="Smaller text">A−</button>
        <button className="icon" onClick={() => setReaderSize((s) => Math.min(28, s + 1))} title="Larger text">A+</button>
        <ThemePicker
          currentTheme={theme}
          currentFont={readerFont}
          onSelectTheme={setThemeOverride}
          onSelectFont={setReaderFont}
        />
      </div>
      <div className="main">
        <div className="panes">
          {paneSourceIds.map((sid, i) => (
            <div key={i} style={{ display: 'contents' }}>
              {i > 0 && <div className="pane-resizer" onMouseDown={(e) => startResize(i, e)} />}
              <div style={{ display: 'flex', flex: `${flex[i]} 1 0%`, minWidth: 0 }}>
                <Pane
                  sources={sources}
                  sourceId={sid}
                  refState={refState}
                  selection={selection}
                  notedVerses={notedVerses}
                  highlightWord={highlightWord}
                  onSelect={setSelection}
                  onChangeSource={(id) => setPaneSource(i, id)}
                  onClose={() => closePane(i)}
                  canClose={paneSourceIds.length > 1}
                  onWordClick={handleWordClick}
                  bodyRef={(el) => {
                    bodies.current[i] = el;
                    if (el) {
                      el.onmouseenter = () => { activePane.current = i; };
                    }
                  }}
                  onScroll={() => handleScroll(i)}
                />
              </div>
            </div>
          ))}
          {paneSourceIds.length === 0 && (
            <div className="pane-empty" style={{ flex: 1, alignSelf: 'center' }}>
              No sources yet — use Import to add one.
            </div>
          )}
        </div>
        {concordanceOpen && (
          <ConcordancePanel
            request={concordanceReq}
            onNavigate={goToStrongsHit}
            onClose={() => setConcordanceOpen(false)}
          />
        )}
        {notesOpen && (
          <NotesPanel
            refState={refState}
            selection={selection}
            onNotesChanged={reloadNoteDots}
            onClose={() => setNotesOpen(false)}
          />
        )}
      </div>
      {searchOpen && (
        <SearchPanel
          initialQuery={searchInitialQuery ?? undefined}
          onNavigate={handleSearchNavigate}
          onNavigateStrongs={handleStrongsNavigate}
          onMoveToConcordance={(term) => {
            sendToConcordance(term);
            setSearchOpen(false);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {libraryOpen && (
        <LibraryPanel sources={sources} onInstalled={refreshSources} onClose={() => setLibraryOpen(false)} />
      )}
      {importOpen && (
        <ImportWizard
          onDone={async (imported) => {
            setImportOpen(false);
            if (imported) await refreshSources();
          }}
        />
      )}
    </div>
  );
}
