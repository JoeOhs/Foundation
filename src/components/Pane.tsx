import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  entriesWithNotes, getChapters, getEntries, getEntryLocation, getEntryNotesForEntries,
  getStrongsWordsForEntries, getStructureForSource, getTocEntries, highlightsForChapter,
  highlightsForEntries, linksForChapter, linksForEntries, listBooks,
} from '../db';
import { openReferencePageWindow } from '../notesbus';
import { versesInRefRange } from '../scripture';
import { isEntryAnchored, isFooterOnly, isNavigable } from '../sourceRoles';
import ReferenceText from './ReferenceText';
import StrongsVerseText from './StrongsWords';
import type {
  Book, Entry, EntryNote, LinkEndpoint, Reference, SelectedEntry, SelectedVerse, Source,
  HoveredVerses, StrongsWordRow, StrongsWordSlot, StructureData, StructureDiagramRow, StructureLineRow, TocEntryRow,
  VerseSelection,
} from '../types';


// A consecutive run of outline lines under one brace (label null = no brace).
interface GroupRun {
  label: string | null;
  lines: StructureLineRow[];
}

interface DiagramBlock {
  diagram: StructureDiagramRow;
  runs: GroupRun[];
  entryById: Map<number, Entry>;
}

// translucent so verse text stays legible on any theme surface
export function highlightBackground(color: string): string {
  return `color-mix(in srgb, ${color} 32%, transparent)`;
}

export interface HighlightWord extends VerseSelection {
  wordIndex: number;
}

// controller: leads its sync group — active book/chapter selectors drive
//   the group reference via onNavigate. Pane 1 is always group A's
//   controller; group B's controller is its lowest-index member.
// follower: mirrors its group's reference; shows a dimmed location label.
// solo: navigates entirely on its own with local selectors.
export type PaneMode = 'controller' | 'follower' | 'solo';

interface PaneProps {
  sources: Source[];
  sourceId: number;
  mode: PaneMode;
  // group reference (controller/follower); solo panes ignore it
  reference: Reference;
  // Pane 1's reference — note dots apply only when this pane is showing it
  noteAnchorRef: Reference;
  // bump to force a re-query of persistent verse/entry highlights
  highlightsVersion: number;
  // bump to force a re-query of verse/entry links (bound outlines)
  linksVersion: number;
  // the in-progress link's first endpoint (dashed pending outline) — a
  // verse or an imported entry
  pendingLink: LinkEndpoint | null;
  // keys "book|chapter|verse" of currently selected verses, for highlight
  selectedKeys: Set<string>;
  // anchor for shift+click range extension (null starts a fresh selection)
  selectionAnchor: VerseSelection | null;
  notedVerses: Set<number>;
  // id of the currently selected imported-pane entry (single-select only)
  selectedEntryId: number | null;
  highlightWord: HighlightWord | null;
  // the reference hovered in any pane, and this pane's reporter for it
  hoveredVerses: HoveredVerses | null;
  onHoverVerses: (h: HoveredVerses | null) => void;
  // following one of Bullinger's cross-references out of a commentary note
  onScriptureRef: (book: string, chapter: number, verse: number | null) => void;
  onAppendixRef: (appendix: number, section: string | null) => void;
  onNavigate?: (book: string, chapter: number) => void;
  onSelectVerses: (verses: SelectedVerse[], anchor: VerseSelection) => void;
  onSelectEntry: (entry: SelectedEntry) => void;
  onChangeSource: (id: number) => void;
  // pane 1's translation is pinned (KJV) — its source selector is disabled
  sourceLocked?: boolean;
  onClose: () => void;
  canClose: boolean;
  // Receives the whole slot, not just its text — the slot's Strong's
  // numbers are what the concordance needs to look the word up exactly.
  onWordClick?: (slot: StrongsWordSlot) => void;
  bodyRef: (el: HTMLDivElement | null) => void;
  onScroll: () => void;
}

// Imperative surface for jumping this pane to an arbitrary entry from
// outside (a cross-reference, a Highlights/Links row) — see jumpToEntry.
export interface PaneBookmarkInfo {
  sourceId: number;
  sourceTitle: string;
  sourceCategory: string | null;
  book: string | null;
  chapter: number | null;
  entryId: number | null;
  positionRef: string | null;
  label: string;
}

export interface PaneHandle {
  jumpToEntry: (entryId: number) => void;
  getBookmarkInfo: () => PaneBookmarkInfo | null;
}

function Pane({
  sources, sourceId, mode, reference, noteAnchorRef, highlightsVersion, linksVersion, pendingLink,
  selectedKeys, selectionAnchor, notedVerses, selectedEntryId, highlightWord, hoveredVerses, onHoverVerses,
  onScriptureRef, onAppendixRef,
  onNavigate, onSelectVerses, onSelectEntry, onChangeSource, onClose, canClose, onWordClick, bodyRef, onScroll, sourceLocked,
}: PaneProps, ref: React.ForwardedRef<PaneHandle>) {
  const source = sources.find((s) => s.id === sourceId);
  // Two independent roles (see sourceRoles.ts). Imported texts (EPUB and
  // other freeform library imports) are not navigable: a static title + TOC
  // dropdown instead of the translation/book/chapter selectors, and never a
  // sync group. Anything that isn't a Bible translation is entry-anchored:
  // clicks select an entries row, and highlights/links/notes attach to it
  // rather than to a canonical verse. A verse-keyed commentary is both
  // navigable and entry-anchored.
  const navigable = source ? isNavigable(source) : false;
  const entryAnchored = source ? isEntryAnchored(source) : false;
  // Footer commentaries navigate by reference but are read in the study
  // footer, never in a pane, so they're kept out of the picker.
  const pickableSources = useMemo(
    () => sources.filter((s) => isNavigable(s) && !isFooterOnly(s)),
    [sources],
  );
  const [books, setBooks] = useState<Book[]>([]);
  const [localBook, setLocalBook] = useState<string | null>(null);
  const [localChapter, setLocalChapter] = useState<number>(1);
  const [chapters, setChapters] = useState<number[]>([]);
  const [activeChapter, setActiveChapter] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [hasChapters, setHasChapters] = useState(true);
  const [wordsByEntry, setWordsByEntry] = useState<Map<number, StrongsWordRow[]>>(new Map());
  const [notesByEntry, setNotesByEntry] = useState<Map<number, EntryNote[]>>(new Map());
  const [highlightsByVerse, setHighlightsByVerse] = useState<Map<number, { color: string; highlighterId: number }>>(new Map());
  const [linksByVerse, setLinksByVerse] = useState<Map<number, { color: string | null }>>(new Map());
  const [highlightsByEntry, setHighlightsByEntry] = useState<Map<number, { color: string; highlighterId: number }>>(new Map());
  const [linksByEntry, setLinksByEntry] = useState<Map<number, { color: string | null }>>(new Map());
  const [toc, setToc] = useState<TocEntryRow[]>([]);
  const [structure, setStructure] = useState<StructureData | null>(null);
  const [collapsedDiagrams, setCollapsedDiagrams] = useState<Set<number>>(new Set());
  const bodyElRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    listBooks(sourceId).then((b) => {
      if (!live) return;
      setBooks(b);
      setLocalBook((prev) => (prev && b.some((x) => x.name === prev) ? prev : b[0]?.name ?? null));
    });
    return () => { live = false; };
  }, [sourceId]);

  useEffect(() => {
    if (navigable) { setToc([]); return; }
    let live = true;
    getTocEntries(sourceId).then((rows) => { if (live) setToc(rows); });
    return () => { live = false; };
  }, [sourceId, navigable]);

  // Structure diagrams (Companion Bible outlines). Only a commentary carries
  // them, and they're small enough to fetch per source rather than per
  // chapter — the render keys them onto entries by entry_id.
  useEffect(() => {
    if (!entryAnchored) { setStructure(null); return; }
    let live = true;
    getStructureForSource(sourceId).then((s) => { if (live) setStructure(s.diagrams.length > 0 ? s : null); });
    return () => { live = false; };
  }, [sourceId, entryAnchored]);

  // Grouped panes follow the group reference when their source has that
  // book; sources without it (freeform texts) always navigate locally.
  const hasRefBook = useMemo(() => books.some((b) => b.name === reference.book), [books, reference.book]);
  const followsRef = mode !== 'solo' && hasRefBook;
  const effectiveBook = followsRef ? reference.book : localBook;

  // Jumps this (always-solo, entry-anchored) pane to an arbitrary entry —
  // the TOC dropdown below, or an external caller via the imperative
  // handle (a cross-reference, a Highlights/Links row). A chaptered
  // source (e.g. the Companion Bible Appendixes, one chapter per
  // appendix) only has its target chapter's entries loaded at any time,
  // so this may need to switch chapters first rather than just scrolling
  // to something already on screen.
  const [pendingScrollEntryId, setPendingScrollEntryId] = useState<number | null>(null);
  const jumpToEntry = async (entryId: number) => {
    const already = bodyElRef.current?.querySelector(`[data-entry-id="${entryId}"]`);
    if (already) {
      already.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const target = await getEntryLocation(entryId);
    if (!target) return;
    // Book as well as chapter: a compound work (one source, many books)
    // restarts chapter numbering per book, so setting only the chapter would
    // land in whichever book the pane was already showing.
    setPendingScrollEntryId(entryId);
    setLocalBook(target.book);
    if (target.chapter !== null) setLocalChapter(target.chapter);
  };
  // Fires once the chapter switch above finishes loading and the target
  // entry is actually in the DOM.
  useEffect(() => {
    if (pendingScrollEntryId === null) return;
    const el = bodyElRef.current?.querySelector(`[data-entry-id="${pendingScrollEntryId}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setPendingScrollEntryId(null);
    }
  }, [entries, pendingScrollEntryId]);

  useImperativeHandle(ref, () => ({
    jumpToEntry,
    getBookmarkInfo: (): PaneBookmarkInfo | null => {
      if (!source) return null;
      if (navigable) {
        return {
          sourceId: source.id, sourceTitle: source.title,
          sourceCategory: source.category, book: effectiveBook,
          chapter: activeChapter, entryId: null, positionRef: null,
          label: effectiveBook && activeChapter != null
            ? `${effectiveBook} ${activeChapter}` : source.title,
        };
      }
      const tocEntry = activeTocEntry;
      const firstEntry = entries[0] ?? null;
      return {
        sourceId: source.id, sourceTitle: source.title,
        sourceCategory: source.category,
        book: effectiveBook, chapter: activeChapter,
        entryId: tocEntry?.entry_id ?? firstEntry?.id ?? null,
        positionRef: tocEntry?.title ?? firstEntry?.position_ref ?? null,
        label: tocEntry?.title
          ? `${source.title} — ${tocEntry.title}`
          : source.title,
      };
    },
  }));

  // Which TOC entry the pane is currently showing — only meaningful for a
  // chaptered source (e.g. the Companion Bible Appendixes, one chapter per
  // appendix); an unchaptered one (EPUB) has no single reliable "current
  // section" without tracking scroll position, so this stays null there
  // and the dropdown keeps its placeholder.
  // Book must match too — a compound work restarts chapter numbering in
  // every book, so chapter alone would light up the wrong TOC row.
  const activeTocEntry = useMemo(
    () => toc.find((t) => (
      t.chapter !== null && t.chapter === activeChapter
      && (t.book_name === null || t.book_name === effectiveBook)
    )) ?? null,
    [toc, activeChapter, effectiveBook],
  );

  useEffect(() => {
    if (!effectiveBook) return;
    let live = true;
    (async () => {
      const ch = await getChapters(sourceId, effectiveBook);
      const chaptered = ch.length > 0;
      const desired = followsRef ? reference.chapter : localChapter;
      const chapter = chaptered ? (ch.includes(desired) ? desired : ch[0]) : null;
      const rows = await getEntries(sourceId, effectiveBook, chapter);
      if (!live) return;
      setChapters(ch);
      setHasChapters(chaptered);
      setActiveChapter(chapter);
      setEntries(rows);
    })();
    return () => { live = false; };
  }, [sourceId, effectiveBook, followsRef, reference.chapter, localChapter]);

  useEffect(() => {
    const ids = entries.map((e) => e.id);
    if (ids.length === 0) {
      setWordsByEntry(new Map());
      setNotesByEntry(new Map());
      return;
    }
    let live = true;
    Promise.all([getStrongsWordsForEntries(ids), getEntryNotesForEntries(ids)]).then(([rows, noteRows]) => {
      if (!live) return;
      const map = new Map<number, StrongsWordRow[]>();
      for (const r of rows) {
        if (!map.has(r.entry_id)) map.set(r.entry_id, []);
        map.get(r.entry_id)!.push(r);
      }
      setWordsByEntry(map);
      const noteMap = new Map<number, EntryNote[]>();
      for (const n of noteRows) {
        if (!noteMap.has(n.entry_id)) noteMap.set(n.entry_id, []);
        noteMap.get(n.entry_id)!.push(n);
      }
      setNotesByEntry(noteMap);
    });
    return () => { live = false; };
  }, [entries]);

  // Where a navigation action from THIS pane's header goes: the group
  // (controller) or this pane only (solo).
  const go = (book: string, chapter: number) => {
    if (mode === 'controller') onNavigate?.(book, chapter);
    else {
      setLocalBook(book);
      setLocalChapter(chapter);
    }
  };

  const stepChapter = async (dir: 1 | -1) => {
    if (!effectiveBook) return;
    const cur = activeChapter ?? chapters[0] ?? 1;
    const ci = chapters.indexOf(cur);
    const ni = ci + dir;
    if (ni >= 0 && ni < chapters.length) {
      go(effectiveBook, chapters[ni]);
      return;
    }
    const bi = books.findIndex((b) => b.name === effectiveBook);
    const nb = books[bi + dir];
    if (!nb) return;
    const nch = await getChapters(sourceId, nb.name);
    go(nb.name, dir === 1 ? nch[0] ?? 1 : nch[nch.length - 1] ?? 1);
  };

  // persistent verse highlights for the shown chapter (canonical anchor)
  useEffect(() => {
    if (!effectiveBook || activeChapter === null) {
      setHighlightsByVerse(new Map());
      return;
    }
    let live = true;
    highlightsForChapter(effectiveBook, activeChapter).then((m) => { if (live) setHighlightsByVerse(m); });
    return () => { live = false; };
  }, [effectiveBook, activeChapter, highlightsVersion]);

  // verse links (bound-outline) for the shown chapter
  useEffect(() => {
    if (!effectiveBook || activeChapter === null) {
      setLinksByVerse(new Map());
      return;
    }
    let live = true;
    linksForChapter(effectiveBook, activeChapter).then((m) => { if (live) setLinksByVerse(m); });
    return () => { live = false; };
  }, [effectiveBook, activeChapter, linksVersion]);

  const [notedEntrySet, setNotedEntrySet] = useState<Set<number>>(new Set());

  // Entry-anchored highlights/links/notes for the currently loaded entries.
  // Keyed on the entries themselves, so unlike the verse-based effects above
  // it re-runs whenever the loaded set changes, chapter or not.
  useEffect(() => {
    if (!entryAnchored || entries.length === 0) {
      setHighlightsByEntry(new Map());
      setLinksByEntry(new Map());
      setNotedEntrySet(new Set());
      return;
    }
    let live = true;
    const ids = entries.map((e) => e.id);
    highlightsForEntries(ids).then((m) => { if (live) setHighlightsByEntry(m); });
    linksForEntries(ids).then((m) => { if (live) setLinksByEntry(m); });
    entriesWithNotes(ids).then((s) => { if (live) setNotedEntrySet(s); });
    return () => { live = false; };
  }, [entryAnchored, entries, highlightsVersion, linksVersion]);

  const showNav = mode === 'controller' || mode === 'solo';

  // A diagram renders as one block, at the position of its first loaded
  // entry, rather than line-by-line through the entries loop. Two reasons:
  // bracket lines have no entry at all and would otherwise vanish, taking
  // the outline's top level with them; and a brace group has to be drawn
  // once across a run of lines, not repeated on each one.
  const diagramBlocks = useMemo(() => {
    const blocks = new Map<number, DiagramBlock>();
    if (!structure) return blocks;
    const entryById = new Map(entries.map((e) => [e.id, e]));
    const groupByLine = new Map<number, string>();
    for (const g of structure.groups) {
      if (!groupByLine.has(g.structure_line_id)) groupByLine.set(g.structure_line_id, g.label);
    }
    for (const diagram of structure.diagrams) {
      const lines = structure.lines.filter((l) => l.diagram_id === diagram.id);
      // Only render a diagram whose lines are actually on screen.
      const firstEntry = lines.find((l) => l.entry_id !== null && entryById.has(l.entry_id));
      if (!firstEntry?.entry_id) continue;
      // Chunk consecutive lines sharing a brace label; each chunk is one
      // brace, labelled once.
      const runs: GroupRun[] = [];
      for (const line of lines) {
        const label = groupByLine.get(line.id) ?? null;
        const last = runs[runs.length - 1];
        if (last && last.label === label) last.lines.push(line);
        else runs.push({ label, lines: [line] });
      }
      blocks.set(firstEntry.entry_id, { diagram, runs, entryById });
    }
    return blocks;
  }, [structure, entries]);

  // Every entry that belongs to a diagram — the loop skips these, since the
  // diagram block above renders them all together.
  const entryIdsInDiagrams = useMemo(() => {
    const ids = new Set<number>();
    for (const l of structure?.lines ?? []) if (l.entry_id !== null) ids.add(l.entry_id);
    return ids;
  }, [structure]);

  // positionRefOverride: a structure line's stored position_ref is the bare
  // range Bullinger prints ("10, 11"), which reads fine in the outline but
  // is meaningless once quoted into a note — so a self-describing reference
  // is substituted there.
  const clickEntry = (e: Entry, positionRefOverride?: string) => {
    if (!source) return;
    onSelectEntry({
      entryId: e.id,
      sourceId: source.id,
      sourceTitle: source.title,
      positionRef: positionRefOverride ?? e.position_ref,
      text: e.text,
    });
  };

  const structureRefLabel = (line: StructureLineRow, diagram: StructureDiagramRow): string => {
    const { anchor_book, anchor_chapter } = diagram;
    const where = line.ref_range
      ? `${anchor_book} ${anchor_chapter}:${line.ref_range}`
      : `${anchor_book} ${anchor_chapter}`;
    return `${where} · Structure${line.label ? ` ${line.label}` : ''}`;
  };

  // Verse click: plain click starts a one-verse selection; shift+click
  // extends a contiguous range from the anchor (when it's in this same
  // book/chapter), pulling verse text straight from the loaded entries.
  const clickVerse = (e: React.MouseEvent, verse: number, verseChapter: number) => {
    if (!effectiveBook) return;
    const title = source?.title ?? '';
    if (
      e.shiftKey &&
      selectionAnchor &&
      selectionAnchor.book === effectiveBook &&
      selectionAnchor.chapter === verseChapter
    ) {
      const lo = Math.min(selectionAnchor.verse, verse);
      const hi = Math.max(selectionAnchor.verse, verse);
      const range: SelectedVerse[] = entries
        .filter((en) => en.verse != null && en.verse >= lo && en.verse <= hi)
        .map((en) => ({ book: effectiveBook, chapter: verseChapter, verse: en.verse as number, text: en.text, sourceTitle: title }));
      onSelectVerses(range, selectionAnchor);
    } else {
      const one: SelectedVerse = { book: effectiveBook, chapter: verseChapter, verse, text: entries.find((x) => x.verse === verse)?.text ?? '', sourceTitle: title };
      onSelectVerses([one], one);
    }
  };
  const showsNoteAnchor =
    effectiveBook === noteAnchorRef.book && activeChapter === noteAnchorRef.chapter;

  // Does the hovered reference (from this or any other pane) touch these
  // verses? Book and chapter must agree, so a note only ever lights up the
  // verse it actually annotates.
  const hoverTouches = (chapter: number, verses: number[]): boolean => {
    if (!hoveredVerses || verses.length === 0) return false;
    if (hoveredVerses.book !== effectiveBook || hoveredVerses.chapter !== chapter) return false;
    return verses.some((v) => hoveredVerses.verses.includes(v));
  };

  const reportHover = (chapter: number, verses: number[]) => {
    if (!effectiveBook || verses.length === 0) return;
    onHoverVerses({ book: effectiveBook, chapter, verses });
  };

  // Commentary prose carries Bullinger's cross-references; Bible text never
  // does, so only an entry-anchored source pays for the scan.
  const renderText = (text: string, chapter: number) => (
    entryAnchored ? (
      <ReferenceText
        text={text}
        context={effectiveBook ? { book: effectiveBook, chapter } : null}
        onScripture={onScriptureRef}
        onAppendix={onAppendixRef}
      />
    ) : text
  );

  // Selection/highlight/link decoration for one entry, read from whichever
  // anchor kind this source uses. Shared by all three row shapes below so a
  // structure line lights up exactly like a verse.
  const decorate = (e: Entry, verseChapter: number) => {
    const hl = entryAnchored
      ? highlightsByEntry.get(e.id)
      : e.verse !== null ? highlightsByVerse.get(e.verse) : undefined;
    const link = entryAnchored
      ? linksByEntry.get(e.id)
      : e.verse !== null ? linksByVerse.get(e.verse) : undefined;
    const isSel = entryAnchored
      ? selectedEntryId === e.id
      : effectiveBook !== null && e.verse !== null &&
        selectedKeys.has(`${effectiveBook}|${verseChapter}|${e.verse}`);
    const isPending = entryAnchored
      ? pendingLink !== null && pendingLink.kind === 'entry' && pendingLink.entryId === e.id
      : pendingLink !== null && pendingLink.kind === 'verse' && effectiveBook !== null &&
        pendingLink.book === effectiveBook && pendingLink.chapter === verseChapter &&
        pendingLink.verse === e.verse;
    const noted = entryAnchored
      ? notedEntrySet.has(e.id)
      : e.verse !== null && showsNoteAnchor && notedVerses.has(e.verse);
    const style: React.CSSProperties = {};
    if (hl) style.background = highlightBackground(hl.color);
    if (link?.color) style.outlineColor = link.color;
    const cls = `${isSel ? ' selected' : ''}${hl ? ' highlighted' : ''}${link ? ' bound' : ''}${isPending ? ' link-pending' : ''}`;
    return { cls, style, noted };
  };

  // One line of an outline. A bracket line (no entry) is Bullinger's own
  // spanning letter: shown so the outline keeps its shape, but inert —
  // there's no text to highlight, bind or annotate.
  const renderStructureLine = (line: StructureLineRow, diagram: StructureDiagramRow, entry: Entry | undefined) => {
    const indent = { marginLeft: `${line.depth * 0.9}rem` };
    if (!entry) {
      return (
        <div key={`b${line.id}`} className="structure-line bracket" style={indent}>
          {line.label && <span className="structure-label">{line.label}</span>}
        </div>
      );
    }
    const chapter = entry.chapter ?? activeChapter ?? 1;
    const { cls, style, noted } = decorate(entry, chapter);
    const covers = versesInRefRange(line.ref_range);
    const peer = hoverTouches(chapter, covers) ? ' peer-hover' : '';
    return (
      <div
        key={entry.id}
        data-entry-id={entry.id}
        className={`structure-line${cls}${peer}`}
        style={{ ...style, ...indent }}
        onClick={() => clickEntry(entry, structureRefLabel(line, diagram))}
        onMouseEnter={() => reportHover(chapter, covers)}
        onMouseLeave={() => onHoverVerses(null)}
      >
        {line.label && <span className="structure-label">{line.label}</span>}
        {line.ref_range && <span className="structure-ref">{line.ref_range}</span>}
        <span className="structure-text">{renderText(entry.text, chapter)}</span>
        {noted && <span className="note-dot" title="Has notes" />}
      </div>
    );
  };

  // A whole Structure diagram: title, optional link to the page scan, then
  // the outline with each brace group drawn once down the right margin.
  // Collapsible, because a diagram is tall — folding it away puts the
  // verse-keyed notes back up against the translation they annotate.
  const renderDiagram = (block: DiagramBlock) => {
    const { diagram, runs, entryById } = block;
    const refPdf = diagram.reference_pdf_path;
    const open = !collapsedDiagrams.has(diagram.id);
    return (
      <div key={`d${diagram.id}`} className="structure-diagram">
        <div className="structure-diagram-header">
          <button
            className="structure-collapse"
            aria-expanded={open}
            onClick={() => setCollapsedDiagrams((prev) => {
              const next = new Set(prev);
              if (next.has(diagram.id)) next.delete(diagram.id);
              else next.add(diagram.id);
              return next;
            })}
            title={open ? 'Hide this Structure' : 'Show this Structure'}
          >
            <span className="structure-caret">{open ? '▾' : '▸'}</span>
            <span className="structure-diagram-title">{diagram.title}</span>
          </button>
          {refPdf && (
            <button
              className="structure-page-link"
              onClick={() => openReferencePageWindow({
                src: refPdf,
                page: diagram.reference_pdf_page ?? 1,
                title: diagram.title,
              })}
              title="Open the original scanned page in a separate window"
            >
              View original page
            </button>
          )}
        </div>
        {open && runs.map((run, i) => {
          const lines = run.lines.map((l) =>
            renderStructureLine(l, diagram, l.entry_id === null ? undefined : entryById.get(l.entry_id)));
          if (!run.label) return <div key={i}>{lines}</div>;
          return (
            <div className="structure-group" key={i}>
              <div className="structure-group-lines">{lines}</div>
              <div className="structure-group-brace" title={`Bullinger's brace: "${run.label}"`}>
                <span className="structure-group-label">{run.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderVerse = (e: Entry) => {
    const verseChapter = e.chapter ?? activeChapter ?? 1;
    const { cls, style, noted } = decorate(e, verseChapter);
    const isHighlightTarget =
      highlightWord !== null &&
      effectiveBook !== null &&
      highlightWord.book === effectiveBook &&
      highlightWord.chapter === verseChapter &&
      highlightWord.verse === e.verse;
    // Highlight every slot carrying the same Strong's number(s) as the
    // clicked occurrence — a word used twice in one verse lights up in both
    // places, not just the clicked one.
    let highlightSet: Set<number> | null = null;
    if (isHighlightTarget) {
      const rows = wordsByEntry.get(e.id) ?? [];
      const targetNumbers = new Set(
        rows.filter((r) => r.word_index === highlightWord.wordIndex).map((r) => r.strongs_number),
      );
      highlightSet = new Set(
        rows.filter((r) => targetNumbers.has(r.strongs_number)).map((r) => r.word_index),
      );
      if (highlightSet.size === 0) highlightSet = new Set([highlightWord.wordIndex]);
    }
    return (
      <div
        key={e.id}
        data-verse={e.verse ?? undefined}
        data-entry-id={entryAnchored ? e.id : undefined}
        className={`verse${cls}${e.verse !== null && hoverTouches(verseChapter, [e.verse]) ? ' peer-hover' : ''}`}
        style={style}
        onClick={(ev) => {
          if (entryAnchored) clickEntry(e);
          else if (e.verse !== null) clickVerse(ev, e.verse, verseChapter);
        }}
        onMouseEnter={() => e.verse !== null && reportHover(verseChapter, [e.verse])}
        onMouseLeave={() => onHoverVerses(null)}
      >
        <span className="vnum">{e.verse}</span>
        {entryAnchored ? (
          renderText(e.text, verseChapter)
        ) : (
          <StrongsVerseText
            text={e.text}
            words={wordsByEntry.get(e.id) ?? []}
            notes={notesByEntry.get(e.id) ?? []}
            highlightWordIndexes={highlightSet}
            onWordClick={onWordClick}
          />
        )}
        {noted && <span className="note-dot" title="Has notes" />}
      </div>
    );
  };

  const renderSection = (e: Entry) => {
    const { cls, style, noted } = decorate(e, activeChapter ?? 1);
    return (
      <div
        key={e.id}
        data-verse={e.sort_order + 1}
        data-entry-id={e.id}
        className={`section-entry${cls}`}
        style={style}
        onClick={() => clickEntry(e)}
      >
        {e.position_ref && <div className="section-ref">{e.position_ref}</div>}
        <div className="section-text">{renderText(e.text, activeChapter ?? 1)}</div>
        {noted && <span className="note-dot" title="Has notes" />}
      </div>
    );
  };

  return (
    <div className="pane">
      <div className="pane-header">
        {!navigable ? (
          <>
            <span className="pane-title" title={source?.title}>{source?.title ?? 'Untitled'}</span>
            {toc.length > 0 && (
              <select
                className="pane-toc-select"
                value={activeTocEntry?.entry_id ?? ''}
                onChange={(e) => { const id = Number(e.target.value); if (id) jumpToEntry(id); }}
                title="Table of contents"
              >
                <option value="" disabled>Table of contents…</option>
                {toc.map((t) => (
                  <option key={t.id} value={t.entry_id ?? ''} disabled={t.entry_id === null}>
                    {'—'.repeat(t.level)} {t.title}
                  </option>
                ))}
              </select>
            )}
            {(hasChapters || books.length > 1) && (
              <>
                <button className="icon" onClick={() => stepChapter(-1)} title="Previous section">◀</button>
                <button className="icon" onClick={() => stepChapter(1)} title="Next section">▶</button>
              </>
            )}
          </>
        ) : (
          <>
            <select
              value={sourceId}
              disabled={sourceLocked}
              onChange={(e) => onChangeSource(Number(e.target.value))}
              title={sourceLocked ? 'Pane 1 is locked to the King James Version' : 'Translation / source'}
            >
              {pickableSources.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            {showNav && books.length > 0 && (
              <select
                value={effectiveBook ?? ''}
                onChange={(e) => go(e.target.value, 1)}
                title="Book"
              >
                {books.map((b) => (
                  <option key={b.id} value={b.name}>{b.name}</option>
                ))}
              </select>
            )}
            {showNav && hasChapters && chapters.length > 0 && (
              <select
                className="pane-chapter-select"
                value={activeChapter ?? chapters[0]}
                onChange={(e) => effectiveBook && go(effectiveBook, Number(e.target.value))}
                title="Chapter"
              >
                {chapters.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {showNav && hasChapters && (
              <>
                <button className="icon" onClick={() => stepChapter(-1)} title="Previous chapter">◀</button>
                <button className="icon" onClick={() => stepChapter(1)} title="Next chapter">▶</button>
              </>
            )}
            {mode === 'follower' && (
              <span className="pane-loc-label" title="Following the group leader's navigation">
                {effectiveBook ?? '—'}{hasChapters && activeChapter ? ` ${activeChapter}` : ''}
              </span>
            )}
          </>
        )}
        {canClose && (
          <button className="icon" onClick={onClose} title="Close pane">✕</button>
        )}
      </div>
      <div
        className="pane-body"
        ref={(el) => { bodyElRef.current = el; bodyRef(el); }}
        onScroll={onScroll}
      >
        {entries.length === 0 && (
          <div className="pane-empty">
            {source ? `${source.title} has no content for ${effectiveBook ?? 'this book'} ${hasChapters && activeChapter ? activeChapter : ''}`.trim() : 'No source selected'}
          </div>
        )}
        {/* Shape is per entry, not per pane: a commentary mixes outline
            lines with verse-keyed prose in the same chapter. */}
        {entries.map((e) => {
          const block = diagramBlocks.get(e.id);
          if (block) return renderDiagram(block);
          // Already drawn as part of its diagram block above.
          if (entryIdsInDiagrams.has(e.id)) return null;
          if (e.verse !== null) return renderVerse(e);
          return renderSection(e);
        })}
      </div>
    </div>
  );
}

export default forwardRef(Pane);
