import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createLink, deleteSource, initDb, listBooks, listHighlighters, listSources, notesForChapter,
  removeHighlight, removeHighlightEntry, seedHighlightersIfEmpty, setHighlight, setHighlightEntry,
} from './db';
import { repairSeededTextsIfNeeded, seedIfEmpty } from './seed';
import { seedTutorialNoteIfNeeded } from './tutorialNote';
import Pane, { type HighlightWord, type PaneMode } from './components/Pane';
import SyncMenu, { type PaneGroup } from './components/SyncMenu';
import NotesPanel from './components/NotesPanel';
import SearchPanel from './components/SearchPanel';
import ImportWizard from './components/ImportWizard';
import LibraryPanel from './components/LibraryPanel';
import ConcordancePanel from './components/ConcordancePanel';
import ThemePicker from './components/ThemePicker';
import ConfirmDialog from './components/ConfirmDialog';
import { requestConfirm } from './confirmBus';
import { applyTheme, normalizeStoredTheme, systemDefaultTheme, type ThemeId } from './themes';
import { applyReaderFont, normalizeStoredFont, type FontId } from './fonts';
import { entryToMarkdown, versesToMarkdown } from './scripture';
import {
  emitHighlightsChanged, emitInsertMarkdown, emitLinksChanged, emitNotesChanged, emitNotesContext,
  focusNotesWindow, onHighlightsChanged, onLinksChanged, onNotesChanged, onNotesNavigate,
  onNotesNavigateEntry, openNotesWindow, queueInsertMarkdown,
} from './notesbus';
import { highlightBackground } from './components/Pane';
import type {
  Book, Highlighter, LinkEndpoint, Reference, SearchHit, SelectedEntry, SelectedVerse, Source,
  StrongsSearchHit, VerseSelection,
} from './types';

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

// Pane 1 is pinned to this translation and its source selector is disabled.
const LOCKED_PANE0_TITLE = 'King James Version';

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
  // the currently selected paragraph/section in an imported pane — mutually
  // exclusive with selectedVerses (selecting one clears the other)
  const [selectedEntry, setSelectedEntry] = useState<SelectedEntry | null>(null);
  const [notedVerses, setNotedVerses] = useState<Set<number>>(new Set());
  const [highlightWord, setHighlightWord] = useState<HighlightWord | null>(null);
  const [highlighters, setHighlighters] = useState<Highlighter[]>([]);
  // bump to force panes to re-query persistent highlights
  const [highlightsVersion, setHighlightsVersion] = useState(0);
  const [linksVersion, setLinksVersion] = useState(0);
  // first endpoint of an in-progress link (null when not binding), plus a
  // display label for the "Linking X ↔" banner (an entry endpoint carries
  // no book/chapter/verse to format on the fly)
  const [pendingLink, setPendingLink] = useState<LinkEndpoint | null>(null);
  const [pendingLinkLabel, setPendingLinkLabel] = useState('');

  // note-anchor default = first selected verse; keys drive pane highlight
  const selection: VerseSelection | null = selectedVerses[0]
    ? { book: selectedVerses[0].book, chapter: selectedVerses[0].chapter, verse: selectedVerses[0].verse }
    : null;
  const selectedKeys = useMemo(
    () => new Set(selectedVerses.map((v) => `${v.book}|${v.chapter}|${v.verse}`)),
    [selectedVerses],
  );

  const selectVerses = (verses: SelectedVerse[], anchor: VerseSelection) => {
    setSelectedEntry(null);
    setSelectedVerses(verses);
    setSelectionAnchor(anchor);
  };

  const selectEntry = (entry: SelectedEntry) => {
    setSelectedVerses([]);
    setSelectionAnchor(null);
    setSelectedEntry(entry);
  };

  // Single-verse select used by search/concordance navigation (text filled
  // by the pane when the user actually clicks; empty here is fine for
  // highlight + note anchor).
  const selectSingle = (book: string, chapter: number, verse: number) => {
    const v: SelectedVerse = { book, chapter, verse, text: '', sourceTitle: '' };
    setSelectedEntry(null);
    setSelectedVerses([v]);
    setSelectionAnchor(v);
  };

  const clearSelection = () => { setSelectedVerses([]); setSelectedEntry(null); };

  const reloadHighlighters = useCallback(async () => setHighlighters(await listHighlighters()), []);

  // Apply / erase a highlighter across the selected verses (or the selected
  // imported entry), then refresh the reader (version bump) and any other
  // window (event).
  const applyHighlight = async (highlighterId: number) => {
    try {
      if (selectedEntry) await setHighlightEntry(highlighterId, selectedEntry.entryId);
      else for (const v of selectedVerses) await setHighlight(highlighterId, v.book, v.chapter, v.verse);
      setHighlightsVersion((n) => n + 1);
      emitHighlightsChanged();
    } catch (e) {
      window.alert(`Couldn't apply the highlight: ${String(e)}`);
    }
  };
  const eraseHighlight = async () => {
    try {
      if (selectedEntry) await removeHighlightEntry(selectedEntry.entryId);
      else for (const v of selectedVerses) await removeHighlight(v.book, v.chapter, v.verse);
      setHighlightsVersion((n) => n + 1);
      emitHighlightsChanged();
    } catch (e) {
      window.alert(`Couldn't remove the highlight: ${String(e)}`);
    }
  };

  const handleHighlightsChanged = () => {
    setHighlightsVersion((n) => n + 1);
    void reloadHighlighters();
  };

  // ---------- verse/entry linking (bind / loose) ----------
  const firstSelected: VerseSelection | null = selectedVerses[0]
    ? { book: selectedVerses[0].book, chapter: selectedVerses[0].chapter, verse: selectedVerses[0].verse }
    : null;
  // The link endpoint the current selection would bind — a verse or an
  // imported entry — plus a human label for it.
  const currentEndpoint: LinkEndpoint | null = selectedEntry
    ? { kind: 'entry', entryId: selectedEntry.entryId }
    : firstSelected
      ? { kind: 'verse', ...firstSelected }
      : null;
  const currentLabel = selectedEntry
    ? selectedEntry.positionRef ?? selectedEntry.sourceTitle
    : firstSelected
      ? `${firstSelected.book} ${firstSelected.chapter}:${firstSelected.verse}`
      : '';
  const sameEndpoint = (a: LinkEndpoint | null, b: LinkEndpoint | null): boolean => {
    if (!a || !b) return false;
    if (a.kind === 'verse' && b.kind === 'verse') return a.book === b.book && a.chapter === b.chapter && a.verse === b.verse;
    if (a.kind === 'entry' && b.kind === 'entry') return a.entryId === b.entryId;
    return false;
  };

  const startLink = () => {
    if (!currentEndpoint) return;
    setPendingLink(currentEndpoint);
    setPendingLinkLabel(currentLabel);
  };
  const cancelLink = () => { setPendingLink(null); setPendingLinkLabel(''); };
  const completeBind = async () => {
    if (!pendingLink || !currentEndpoint || sameEndpoint(pendingLink, currentEndpoint)) return;
    try {
      await createLink(pendingLink, currentEndpoint);
      setPendingLink(null);
      setPendingLinkLabel('');
      setSelectedVerses([]);
      setSelectedEntry(null);
      setLinksVersion((n) => n + 1);
      emitLinksChanged();
    } catch (e) {
      window.alert(`Couldn't bind these: ${String(e)}`);
    }
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

  // Insert the currently selected verses (or the selected imported entry)
  // into the open note editor as a markdown blockquote. The editor (docked
  // here, or the popped-out window in Phase D) listens for this window
  // event and inserts at the cursor.
  const addSelectionToNote = async () => {
    if (selectedVerses.length === 0 && !selectedEntry) return;
    const md = selectedEntry ? entryToMarkdown(selectedEntry) : versesToMarkdown(selectedVerses);
    if (notesPopped) {
      // route to the popout only if it's really still open; otherwise fall
      // through to the docked editor (self-heals a missed close signal)
      if (await focusNotesWindow()) {
        emitInsertMarkdown(md);
        return;
      }
      setNotesPopped(false);
    }
    if (!notesOpen) {
      // panel mounts fresh — park the markdown so it drains on mount rather
      // than racing a fixed timeout against the listener attaching
      queueInsertMarkdown(md);
      setNotesOpen(true);
    } else {
      window.dispatchEvent(new CustomEvent('foundation:insert-note-md', { detail: md }));
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
        await seedTutorialNoteIfNeeded();
        setHighlighters(await listHighlighters());
        const srcs = await listSources();
        setSources(srcs);
        // Pane 1 is locked to the KJV (see LOCKED_PANE0_TITLE).
        const kjvId = srcs.find((s) => s.title === LOCKED_PANE0_TITLE)?.id
          ?? srcs.find((s) => s.type === 'bible')?.id
          ?? srcs[0]?.id;
        setPaneSourceIds((prev) => {
          const valid = prev.filter((id) => srcs.some((s) => s.id === id));
          let ids: number[];
          if (valid.length > 0) ids = valid;
          else {
            const bibles = srcs.filter((s) => s.type === 'bible').map((s) => s.id);
            ids = bibles.length >= 2 ? bibles.slice(0, 2) : srcs.slice(0, 1).map((s) => s.id);
          }
          // force pane 1 to the locked translation (replace, don't insert,
          // so parallel arrays stay aligned)
          if (kjvId != null) ids = ids.length ? [kjvId, ...ids.slice(1)] : [kjvId];
          return ids;
        });
        setPhase('ready');
      } catch (e) {
        console.error(e);
        setErrorMsg(String(e));
        setPhase('error');
      }
    })();
  }, []);

  // Keep pane 1 pinned to the KJV even across imports / hot reloads.
  useEffect(() => {
    if (sources.length === 0) return;
    const kjvId = sources.find((s) => s.title === LOCKED_PANE0_TITLE)?.id;
    if (kjvId == null) return;
    setPaneSourceIds((prev) => {
      if (prev.length > 0 && prev[0] === kjvId) return prev;
      return prev.length ? [kjvId, ...prev.slice(1)] : [kjvId];
    });
  }, [sources]);

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
    if (notesPopped) emitNotesContext({ ref: refState, selection, entrySelection: selectedEntry });
  }, [notesPopped, refState, selection, selectedEntry]);

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

  useEffect(() => {
    // popout Highlights/Links list asked to jump to an imported entry
    let un: (() => void) | undefined;
    onNotesNavigateEntry((entry) => navigateToEntry(entry.sourceId, entry.entryId, entry)).then((u) => { un = u; });
    return () => un?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // links changed (possibly in the popout) → refresh bound outlines
    let un: (() => void) | undefined;
    onLinksChanged(() => setLinksVersion((n) => n + 1)).then((u) => { un = u; });
    return () => un?.();
  }, []);

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
    // Imported (freeform) panes always navigate independently — never
    // let them join a Bible sync group (the SyncMenu already disables
    // this; guarded again here in case that's ever bypassed).
    const isImportedPane = sources.find((s) => s.id === paneSourceIds[i])?.type !== 'bible';
    if (isImportedPane && g !== 'solo') return;
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
    if (i === 0) return; // pane 1 is locked to the KJV
    setPaneSourceIds((prev) => prev.map((p, j) => (j === i ? id : p)));
  };

  // Bring a source into view without touching the locked pane 1: reuse it
  // if already shown, else put it in pane 2 when one exists.
  const showSource = (sourceId: number) => {
    if (paneSourceIds.includes(sourceId)) return;
    if (paneSourceIds.length > 1) setPaneSource(1, sourceId);
  };

  // "+ Pane" always adds another Bible pane — imported texts get their own
  // dedicated pane via "Open in a pane" in the Library instead. Inserted
  // just before any trailing imported panes, not appended after them, so
  // imported panes stay pinned rightmost instead of getting bumped inward.
  const addPane = () => {
    if (paneSourceIds.length >= 4 || sources.length === 0) return;
    const bibles = sources.filter((s) => s.type === 'bible');
    const unused = bibles.find((s) => !paneSourceIds.includes(s.id)) ?? bibles[0] ?? sources[0];
    const isImportedId = (id: number) => sources.find((s) => s.id === id)?.type !== 'bible';
    let insertAt = paneSourceIds.length;
    while (insertAt > 0 && isImportedId(paneSourceIds[insertAt - 1])) insertAt--;
    setPaneSourceIds((prev) => [...prev.slice(0, insertAt), unused.id, ...prev.slice(insertAt)]);
    setPaneFlex((prev) => [...prev.slice(0, insertAt), 1, ...prev.slice(insertAt)]);
    setPaneGroups((prev) => [...prev.slice(0, insertAt), 'A', ...prev.slice(insertAt)]);
  };

  // Bring an imported (freeform) source into its own dedicated pane from
  // the Library's "Imported texts" section. Imported panes always sit
  // rightmost — appended after every existing pane — so they never
  // displace or get sandwiched between Bible panes. Always group 'solo':
  // they never join a sync group (see assignPaneGroup/SyncMenu), which
  // also keeps them out of the group-A scroll-reset/sync effects below.
  const openImportedSource = (sourceId: number) => {
    if (!paneSourceIds.includes(sourceId)) {
      if (paneSourceIds.length < 4) {
        setPaneSourceIds((prev) => [...prev, sourceId]);
        setPaneFlex((prev) => [...prev, 1]);
        setPaneGroups((prev) => [...prev, 'solo']);
      } else {
        const last = paneSourceIds.length - 1;
        setPaneSource(last, sourceId);
        setPaneGroups((prev) => prev.map((g, j) => (j === last ? 'solo' : g)));
      }
    }
    setLibraryOpen(false);
  };

  // Jump to a specific imported entry (from the Highlights/Links list, or
  // the popout) — opens/reuses that source's dedicated pane and scrolls to
  // the entry, selecting it so the action bar comes up immediately.
  const [pendingScrollEntry, setPendingScrollEntry] = useState<{ sourceId: number; entryId: number } | null>(null);
  const scrollToEntry = (sourceId: number, entryId: number) => {
    const i = paneSourceIds.indexOf(sourceId);
    if (i === -1) return;
    const el = bodies.current[i]?.querySelector<HTMLElement>(`[data-entry-id="${entryId}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const navigateToEntry = (sourceId: number, entryId: number, entry?: SelectedEntry) => {
    if (entry) selectEntry(entry);
    if (!paneSourceIds.includes(sourceId)) {
      openImportedSource(sourceId);
      setPendingScrollEntry({ sourceId, entryId });
    } else {
      scrollToEntry(sourceId, entryId);
    }
  };
  // Waits for the pane to actually mount + load its entries before
  // scrolling — mirrors scrollToVerse's own fixed-delay heuristic above.
  useEffect(() => {
    if (!pendingScrollEntry) return;
    if (!paneSourceIds.includes(pendingScrollEntry.sourceId)) return;
    const t = setTimeout(() => {
      scrollToEntry(pendingScrollEntry.sourceId, pendingScrollEntry.entryId);
      setPendingScrollEntry(null);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingScrollEntry, paneSourceIds]);

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
      if (hit.source_id != null) showSource(hit.source_id);
      navigate(hit.book, hit.chapter ?? 1);
      if (hit.verse != null && hit.chapter != null) {
        selectSingle(hit.book, hit.chapter, hit.verse);
        scrollToVerse(hit.verse);
      }
    } else if (hit.source_id != null) {
      // freeform text: bring its source into a changeable pane
      showSource(hit.source_id);
    }
  };

  // Shared by the search modal and the docked concordance pane: bring the
  // hit's source into view, navigate, select, and highlight the exact word.
  const goToStrongsHit = (hit: StrongsSearchHit) => {
    showSource(hit.source_id);
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

  // Delete an imported (freeform) source from the Library's "Imported
  // texts" section — cascades to its highlights/notes/links (deleteSource
  // handles that at the DB layer). Closes its pane if it's open, and
  // refreshes every piece of state that could be showing its data.
  const deleteImportedSourceHandler = async (sourceId: number) => {
    const src = sources.find((s) => s.id === sourceId);
    if (!src) return;
    if (!await requestConfirm(
      `Delete "${src.title}"? This also removes any highlights, notes, and links anchored to it. This can't be undone.`,
    )) return;
    try {
      await deleteSource(sourceId);
      const i = paneSourceIds.indexOf(sourceId);
      if (i !== -1) closePane(i);
      await refreshSources();
      setHighlightsVersion((n) => n + 1);
      setLinksVersion((n) => n + 1);
      emitHighlightsChanged();
      emitLinksChanged();
      await reloadNoteDots();
      emitNotesChanged();
    } catch (e) {
      window.alert(`Couldn't delete this source: ${String(e)}`);
    }
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
                  linksVersion={linksVersion}
                  pendingLink={pendingLink}
                  selectedKeys={selectedKeys}
                  selectionAnchor={selectionAnchor}
                  notedVerses={notedVerses}
                  selectedEntryId={selectedEntry?.entryId ?? null}
                  highlightWord={highlightWord}
                  onNavigate={(book, chapter) => handlePaneNavigate(i, book, chapter)}
                  onSelectVerses={selectVerses}
                  onSelectEntry={selectEntry}
                  onChangeSource={(id) => setPaneSource(i, id)}
                  sourceLocked={i === 0}
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
            entrySelection={selectedEntry}
            onNotesChanged={reloadNoteDots}
            onClose={() => setNotesOpen(false)}
            onPopOut={popOutNotes}
            onNavigateVerse={navigateToVerse}
            onNavigateEntry={navigateToEntry}
            highlightsVersion={highlightsVersion}
            onHighlightsChanged={handleHighlightsChanged}
            linksVersion={linksVersion}
            onLinksChanged={() => setLinksVersion((n) => n + 1)}
          />
        )}
        {(pendingLink || selectedEntry || (selectedVerses.length > 0 && selectedVerses.some((v) => v.text))) && (
          <div className="verse-action-bar">
            {pendingLink ? (
              <>
                <span className="verse-action-count">
                  🔗 Linking {pendingLinkLabel} ↔
                </span>
                {currentEndpoint && !sameEndpoint(currentEndpoint, pendingLink) ? (
                  <button className="primary" onClick={completeBind}>
                    Bind {currentLabel}
                  </button>
                ) : (
                  <span className="verse-action-hint">select a verse or section to bind…</span>
                )}
                <button className="icon" onClick={cancelLink} title="Cancel link">✕</button>
              </>
            ) : (
              <>
                <span className="verse-action-count">
                  {selectedEntry
                    ? (selectedEntry.positionRef ?? selectedEntry.sourceTitle)
                    : `${selectedVerses.length} verse${selectedVerses.length > 1 ? 's' : ''}`}
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
                <button onClick={startLink} title="Bind this to another verse or section">🔗 Bind</button>
                <button className="primary" onClick={addSelectionToNote}>✎ Add to note</button>
                <button className="icon" onClick={clearSelection} title="Clear selection">✕</button>
              </>
            )}
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
        <LibraryPanel
          sources={sources}
          onInstalled={refreshSources}
          onOpenImported={openImportedSource}
          onDeleteImported={deleteImportedSourceHandler}
          onClose={() => setLibraryOpen(false)}
        />
      )}
      {importOpen && (
        <ImportWizard
          onDone={async (imported) => {
            setImportOpen(false);
            if (imported) await refreshSources();
          }}
        />
      )}
      <ConfirmDialog />
    </div>
  );
}
