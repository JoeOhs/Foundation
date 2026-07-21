import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  initDb, listBooks, listHighlighters, listSources, notesForChapter,
  removeHighlight, seedHighlightersIfEmpty, setHighlight,
} from './db';
import { repairSeededTextsIfNeeded, seedIfEmpty } from './seed';
import Pane, { type HighlightWord, type PaneMode } from './components/Pane';
import SyncMenu, { type PaneGroup } from './components/SyncMenu';
import NotesPanel from './components/NotesPanel';
import SearchPanel from './components/SearchPanel';
import ImportWizard from './components/ImportWizard';
import LibraryPanel from './components/LibraryPanel';
import ConcordancePanel from './components/ConcordancePanel';
import ThemePicker from './components/ThemePicker';
import { applyTheme, normalizeStoredTheme, systemDefaultTheme, type ThemeId } from './themes';
import { applyReaderFont, normalizeStoredFont, type FontId } from './fonts';
import { versesToMarkdown } from './scripture';
import {
  emitHighlightsChanged, emitInsertMarkdown, emitNotesContext, focusNotesWindow,
  onHighlightsChanged, onNotesChanged, onNotesNavigate, openNotesWindow,
} from './notesbus';
import { highlightBackground } from './components/Pane';
import type { Book, Highlighter, Reference, SearchHit, SelectedVerse, Source, StrongsSearchHit, VerseSelection } from './types';

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
  const [refState, setRefState] = useState<Reference>(() => loadPref('ref', { book: 'Genesis', chapter: 1 }));
  const [paneSourceIds, setPaneSourceIds] = useState<number[]>(() => loadPref('panes', []));
  const [paneFlex, setPaneFlex] = useState<number[]>(() => loadPref('paneFlex', []));
  // Sync assignment per pane. Pane 1 (index 0) is always 'A' — it leads
  // group A, and notes/search navigation anchor to its position. Migrates
  // the short-lived boolean paneSync pref.
  const [paneGroups, setPaneGroups] = useState<PaneGroup[]>(() => {
    const stored = loadPref<PaneGroup[] | null>('paneGroups', null);
    if (stored) return stored;
    const legacy = loadPref<boolean[] | null>('paneSync', null);
    return legacy ? legacy.map((s) => (s ? 'A' : 'solo')) : [];
  });
  // Group B's shared reference (its lowest-index member navigates it)
  const [groupBRef, setGroupBRef] = useState<Reference>(() => loadPref('groupBRef', { book: 'Genesis', chapter: 1 }));
  const [selectedVerses, setSelectedVerses] = useState<SelectedVerse[]>([]);
  const [selectionAnchor, setSelectionAnchor] = useState<VerseSelection | null>(null);
  const [notedVerses, setNotedVerses] = useState<Set<number>>(new Set());
  const [highlightWord, setHighlightWord] = useState<HighlightWord | null>(null);
  const [highlighters, setHighlighters] = useState<Highlighter[]>([]);
  // bump to force panes to re-query persistent highlights
  const [highlightsVersion, setHighlightsVersion] = useState(0);

  // note-anchor default = first selected verse; keys drive pane highlight
  const selection: VerseSelection | null = selectedVerses[0]
    ? { book: selectedVerses[0].book, chapter: selectedVerses[0].chapter, verse: selectedVerses[0].verse }
    : null;
  const selectedKeys = useMemo(
    () => new Set(selectedVerses.map((v) => `${v.book}|${v.chapter}|${v.verse}`)),
    [selectedVerses],
  );

  const selectVerses = (verses: SelectedVerse[], anchor: VerseSelection) => {
    setSelectedVerses(verses);
    setSelectionAnchor(anchor);
  };

  // Single-verse select used by search/concordance navigation (text filled
  // by the pane when the user actually clicks; empty here is fine for
  // highlight + note anchor).
  const selectSingle = (book: string, chapter: number, verse: number) => {
    const v: SelectedVerse = { book, chapter, verse, text: '', sourceTitle: '' };
    setSelectedVerses([v]);
    setSelectionAnchor(v);
  };

  const clearSelection = () => setSelectedVerses([]);

  const reloadHighlighters = useCallback(async () => setHighlighters(await listHighlighters()), []);

  // Apply / erase a highlighter across the selected verses, then refresh the
  // reader (version bump) and any other window (event).
  const applyHighlight = async (highlighterId: number) => {
    for (const v of selectedVerses) await setHighlight(highlighterId, v.book, v.chapter, v.verse);
    setHighlightsVersion((n) => n + 1);
    emitHighlightsChanged();
  };
  const eraseHighlight = async () => {
    for (const v of selectedVerses) await removeHighlight(v.book, v.chapter, v.verse);
    setHighlightsVersion((n) => n + 1);
    emitHighlightsChanged();
  };

  const handleHighlightsChanged = () => {
    setHighlightsVersion((n) => n + 1);
    void reloadHighlighters();
  };

  const [notesOpen, setNotesOpen] = useState<boolean>(() => loadPref('notesOpen', false));
  // notes moved to a separate window (session-only — not persisted, since a
  // relaunch has no popout window)
  const [notesPopped, setNotesPopped] = useState(false);
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

  // Insert the currently selected verses into the open note editor as a
  // markdown blockquote. The editor (docked here, or the popped-out window
  // in Phase D) listens for this window event and inserts at the cursor.
  const addSelectionToNote = async () => {
    if (selectedVerses.length === 0) return;
    const md = versesToMarkdown(selectedVerses);
    if (notesPopped) {
      // route to the popout only if it's really still open; otherwise fall
      // through to the docked editor (self-heals a missed close signal)
      if (await focusNotesWindow()) {
        emitInsertMarkdown(md);
        return;
      }
      setNotesPopped(false);
    }
    const dispatch = () => window.dispatchEvent(new CustomEvent('foundation:insert-note-md', { detail: md }));
    if (!notesOpen) {
      setNotesOpen(true);
      // wait for NotesPanel to mount its listener before dispatching
      setTimeout(dispatch, 80);
    } else {
      dispatch();
    }
  };

  const popOutNotes = async () => {
    await openNotesWindow(refState, () => setNotesPopped(false));
    setNotesOpen(false);
    setNotesPopped(true);
  };

  // Self-healing: if the popout was closed without us hearing the event,
  // focusNotesWindow returns false — recover by reopening the docked panel.
  const toggleNotes = async () => {
    if (notesPopped) {
      if (await focusNotesWindow()) return;
      setNotesPopped(false);
      setNotesOpen(true);
      return;
    }
    setNotesOpen((v) => !v);
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
        await seedHighlightersIfEmpty();
        setHighlighters(await listHighlighters());
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
  useEffect(() => { savePref('paneGroups', paneGroups); }, [paneGroups]);
  useEffect(() => { savePref('groupBRef', groupBRef); }, [groupBRef]);
  useEffect(() => { savePref('notesOpen', notesOpen); }, [notesOpen]);
  useEffect(() => { savePref('concordanceOpen', concordanceOpen); }, [concordanceOpen]);
  useEffect(() => { savePref('theme', themeOverride); }, [themeOverride]);

  // ---------- popped-out notes window sync ----------
  // Keep the popout fed with the current reference + selection so its
  // anchor picker matches the main window.
  useEffect(() => {
    if (notesPopped) emitNotesContext({ ref: refState, selection });
  }, [notesPopped, refState, selection]);

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

  const reloadNoteDots = useCallback(async () => {
    const notes = await notesForChapter(refState.book, refState.chapter);
    setNotedVerses(new Set(notes.filter((n) => n.anchor_verse != null).map((n) => n.anchor_verse as number)));
  }, [refState.book, refState.chapter]);

  useEffect(() => {
    if (phase === 'ready') reloadNoteDots();
  }, [phase, reloadNoteDots]);

  useEffect(() => {
    // popout edited/imported notes → refresh the verse note-dots here
    let un: (() => void) | undefined;
    onNotesChanged(() => reloadNoteDots()).then((u) => { un = u; });
    return () => un?.();
  }, [reloadNoteDots]);

  useEffect(() => {
    // highlights/palette changed (possibly in the popout) → refresh reader
    let un: (() => void) | undefined;
    onHighlightsChanged(() => {
      setHighlightsVersion((n) => n + 1);
      void reloadHighlighters();
    }).then((u) => { un = u; });
    return () => un?.();
  }, [reloadHighlighters]);

  useEffect(() => {
    // popout Highlights list asked to jump the reader to a verse
    let un: (() => void) | undefined;
    onNotesNavigate((r) => navigateToVerse(r.book, r.chapter, r.verse)).then((u) => { un = u; });
    return () => un?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books]);

  // clear verse selection and word highlight when leaving the chapter
  useEffect(() => {
    setSelectedVerses((vs) =>
      vs.length && vs[0].book === refState.book && vs[0].chapter === refState.chapter ? vs : [],
    );
    setSelectionAnchor((a) =>
      a && a.book === refState.book && a.chapter === refState.chapter ? a : null,
    );
    setHighlightWord((hw) =>
      hw && hw.book === refState.book && hw.chapter === refState.chapter ? hw : null,
    );
  }, [refState]);

  // ---------- pane groups & navigation ----------
  const navigate = (book: string, chapter: number) => setRefState({ book, chapter });

  const groupOf = (i: number): PaneGroup => (i === 0 ? 'A' : paneGroups[i] ?? 'A');

  // A group's controller is its lowest-index member (always pane 0 for A).
  const controllerOf = (g: 'A' | 'B'): number => {
    if (g === 'A') return 0;
    for (let i = 1; i < paneSourceIds.length; i++) if (groupOf(i) === 'B') return i;
    return -1;
  };

  const paneModeOf = (i: number): PaneMode => {
    const g = groupOf(i);
    if (g === 'solo') return 'solo';
    return controllerOf(g) === i ? 'controller' : 'follower';
  };

  const paneReferenceOf = (i: number): Reference => (groupOf(i) === 'B' ? groupBRef : refState);

  const handlePaneNavigate = (i: number, book: string, chapter: number) => {
    if (groupOf(i) === 'B') setGroupBRef({ book, chapter });
    else navigate(book, chapter);
  };

  const assignPaneGroup = (i: number, g: PaneGroup) => {
    // First pane to join B aligns B's reference to where Pane 1 is, so the
    // new group starts from a sensible place instead of a stale one.
    if (g === 'B' && !paneSourceIds.some((_, j) => j !== i && groupOf(j) === 'B')) {
      setGroupBRef(refState);
    }
    setPaneGroups(() => paneSourceIds.map((_, j) => (j === i ? g : groupOf(j))));
  };

  // ---------- scroll sync (within a group only) ----------
  const handleScroll = (i: number) => {
    if (activePane.current !== i) return;
    const g = groupOf(i);
    if (g === 'solo') return;
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
      if (j === i || !other || groupOf(j) !== g) return;
      const target = other.querySelector<HTMLElement>(`[data-verse="${topVerse}"]`);
      if (target) other.scrollTop = target.offsetTop;
    });
  };

  // scroll a group's panes to the top when its reference changes
  useEffect(() => {
    bodies.current.forEach((el, i) => { if (el && groupOf(i) === 'A') el.scrollTop = 0; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refState]);
  useEffect(() => {
    bodies.current.forEach((el, i) => { if (el && groupOf(i) === 'B') el.scrollTop = 0; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupBRef]);

  // scroll to the selected verse when navigating from search — group A only
  // (search navigation drives Pane 1's group); other panes share verse
  // numbers and would jump to the wrong place.
  const scrollToVerse = (verse: number) => {
    // wait for panes to load the new chapter before scrolling
    setTimeout(() => {
      bodies.current.forEach((el, i) => {
        if (!el || groupOf(i) !== 'A') return;
        const target = el.querySelector<HTMLElement>(`[data-verse="${verse}"]`);
        if (target) el.scrollTop = Math.max(0, target.offsetTop - 40);
      });
    }, 150);
  };

  // Jump the reader to a verse (from the Highlights list or the popout).
  const navigateToVerse = (book: string, chapter: number, verse: number) => {
    if (!books.some((b) => b.name === book)) return;
    navigate(book, chapter);
    selectSingle(book, chapter, verse);
    scrollToVerse(verse);
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
    setPaneGroups((prev) => [...prev, 'A']);
  };

  const closePane = (i: number) => {
    setPaneSourceIds((prev) => prev.filter((_, j) => j !== i));
    setPaneFlex((prev) => prev.filter((_, j) => j !== i));
    setPaneGroups((prev) => prev.filter((_, j) => j !== i));
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
          selectSingle(hit.book, hit.chapter, hit.verse);
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
        selectSingle(hit.book, hit.chapter, hit.verse);
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
    selectSingle(hit.book, hit.chapter, hit.verse);
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
        <span className="spacer" />
        <button onClick={addPane} disabled={paneSourceIds.length >= 4} title="Add a parallel pane">+ Pane</button>
        <SyncMenu
          paneSourceIds={paneSourceIds}
          sources={sources}
          groups={paneSourceIds.map((_, i) => groupOf(i))}
          onAssign={assignPaneGroup}
        />
        <button onClick={() => openSearch()} title="Search (Ctrl+F)">🔍 Search</button>
        <button onClick={() => setConcordanceOpen((v) => !v)} title="Toggle concordance pane">🔤 Concordance</button>
        <button onClick={() => setLibraryOpen(true)} title="Download public domain texts">🌐 Library</button>
        <button onClick={() => setImportOpen(true)} title="Import a text">📥 Import</button>
        <button onClick={toggleNotes} title={notesPopped ? 'Notes are in a separate window' : 'Toggle notes panel'}>📝 Notes{notesPopped ? ' ⧉' : ''}</button>
        <ThemePicker
          currentTheme={theme}
          currentFont={readerFont}
          readerSize={readerSize}
          onSelectTheme={setThemeOverride}
          onSelectFont={setReaderFont}
          onChangeSize={setReaderSize}
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
                  mode={paneModeOf(i)}
                  reference={paneReferenceOf(i)}
                  noteAnchorRef={refState}
                  highlightsVersion={highlightsVersion}
                  selectedKeys={selectedKeys}
                  selectionAnchor={selectionAnchor}
                  notedVerses={notedVerses}
                  highlightWord={highlightWord}
                  onNavigate={(book, chapter) => handlePaneNavigate(i, book, chapter)}
                  onSelectVerses={selectVerses}
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
        {notesOpen && !notesPopped && (
          <NotesPanel
            refState={refState}
            selection={selection}
            onNotesChanged={reloadNoteDots}
            onClose={() => setNotesOpen(false)}
            onPopOut={popOutNotes}
            onNavigateVerse={navigateToVerse}
            highlightsVersion={highlightsVersion}
            onHighlightsChanged={handleHighlightsChanged}
          />
        )}
        {selectedVerses.length > 0 && selectedVerses.some((v) => v.text) && (
          <div className="verse-action-bar">
            <span className="verse-action-count">
              {selectedVerses.length} verse{selectedVerses.length > 1 ? 's' : ''}
            </span>
            <span className="verse-action-swatches">
              {highlighters.map((h) => (
                <button
                  key={h.id}
                  className="hl-swatch"
                  style={{ background: highlightBackground(h.color), borderColor: h.color }}
                  title={`Highlight: ${h.label}`}
                  onClick={() => applyHighlight(h.id)}
                />
              ))}
              <button className="hl-swatch hl-erase" title="Remove highlight" onClick={eraseHighlight}>⌫</button>
            </span>
            <button className="primary" onClick={addSelectionToNote}>✎ Add to note</button>
            <button className="icon" onClick={clearSelection} title="Clear selection">✕</button>
          </div>
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
