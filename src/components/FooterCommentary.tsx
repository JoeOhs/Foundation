// The study footer's Commentary tab: a horizontal strip of verse-labeled
// cells covering Pane 1's current chapter, re-populating whenever that
// chapter changes — "turning the page" of a study Bible's footnotes.
//
// Shaped deliberately unlike the Dictionary tab. A dictionary is a lookup
// (headword list beside one article, vertical); a verse commentary is a
// companion to the chapter you're already reading, so it runs left-to-right
// in verse order and you scan along it rather than searching it.
//
// Overlapping comments. JFB comments on a verse range as one block ("4-23")
// and often *also* comments on single verses inside that range — 2,713
// verses in the text are covered twice or more. Both are real commentary and
// both are shown: the broader comment is the cell, and any comment nested
// inside its range renders as a sub-note within it.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEntries } from '../db';
import { versesInRefRange } from '../scripture';
import ReferenceText from './ReferenceText';
import type { Entry, HoveredVerses, Reference, Source } from '../types';

interface FooterCommentaryProps {
  // Every installed footer commentary; the tab picks between them when
  // there's more than one.
  sources: Source[];
  // Pane 1's reference — the footer follows it, never leads it.
  reference: Reference;
  hoveredVerses: HoveredVerses | null;
  onHoverVerses: (hovered: HoveredVerses | null) => void;
  // The verse(s) selected by clicking in a reading pane. A selection pins the
  // strip: see the note on `pin` below for why hover-follow alone isn't
  // enough to actually read a comment.
  selectedVerses: HoveredVerses | null;
  onScriptureRef: (book: string, chapter: number, verse: number | null) => void;
  onAppendixRef: (appendix: number, section: string | null) => void;
}

// One comment plus the comments nested inside its verse range.
export interface CommentNode {
  entry: Entry;
  verses: number[];
  children: CommentNode[];
}

// The comments for a chapter, arranged into containment order, plus the
// verse → cell index the hover mechanism needs.
export interface ChapterIndex {
  roots: CommentNode[];
  // verse number → the ids of every comment covering it, broadest first.
  byVerse: Map<number, number[]>;
}

function coveredVerses(entry: Entry): number[] {
  const fromRange = versesInRefRange(entry.position_ref);
  // position_ref is the authority (it carries the whole range); entry.verse
  // is the fallback for a row written before ranges existed, or by another
  // source that doesn't set one.
  if (fromRange.length > 0) return fromRange;
  return entry.verse === null ? [] : [entry.verse];
}

// Arrange a chapter's comments into a containment tree, then index it by
// verse. Built once per chapter load rather than per hover: with ~40 cells a
// chapter and a hover on every mouse move, resolving overlaps per event
// would redo this work hundreds of times a second for no gain.
//
// A comment nests inside another when every verse it covers is also covered
// by the wider one. Entries arrive in sort_order — chapter, then first verse,
// then widest first — so a single pass with a stack is enough.
//
// Exported (rather than kept module-private) because it's the piece worth
// checking against the real bundle: it's pure, and running it over all 1,178
// chapters is what verifies every comment lands exactly once and that the
// 2,713 overlapping verses resolve the way the source says they should.
export function buildChapterIndex(entries: Entry[]): ChapterIndex {
  const roots: CommentNode[] = [];
  const stack: CommentNode[] = [];

  for (const entry of entries) {
    const verses = coveredVerses(entry);
    if (verses.length === 0) continue;
    const node: CommentNode = { entry, verses, children: [] };
    // Walk out of any open comment this one doesn't fit inside.
    while (stack.length > 0) {
      const parent = stack[stack.length - 1];
      const inside = verses.every((v) => parent.verses.includes(v));
      // Equal coverage isn't nesting — two comments on the same verse are
      // siblings, not one inside the other.
      if (inside && verses.length < parent.verses.length) break;
      stack.pop();
    }
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  const byVerse = new Map<number, number[]>();
  const walk = (nodes: CommentNode[]) => {
    for (const n of nodes) {
      for (const v of n.verses) {
        const ids = byVerse.get(v);
        if (ids) ids.push(n.entry.id);
        else byVerse.set(v, [n.entry.id]);
      }
      walk(n.children);
    }
  };
  walk(roots);

  return { roots, byVerse };
}

// JFB's bold lemma ("5-6. rain, mist--") is stored as **…**, the one piece of
// formatting the source carries that's worth keeping — it's the phrase being
// commented on, and it's what makes a cell skimmable.
function renderMarkedUp(
  text: string,
  onScripture: FooterCommentaryProps['onScriptureRef'],
  onAppendix: FooterCommentaryProps['onAppendixRef'],
  context: Reference,
) {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((chunk, i) => {
    if (chunk.startsWith('**') && chunk.endsWith('**')) {
      return <b key={i}>{chunk.slice(2, -2)}</b>;
    }
    return (
      <ReferenceText
        key={i}
        text={chunk}
        context={context}
        onScripture={onScripture}
        onAppendix={onAppendix}
      />
    );
  });
}

// Identifies one pin, so a repeat selection of the same verses is the same
// pin (and stays released) while a new selection re-pins.
function pinKey(v: HoveredVerses | null): string | null {
  return v && v.verses.length > 0 ? `${v.book}|${v.chapter}|${v.verses.join(',')}` : null;
}

export default function FooterCommentary({
  sources, reference, hoveredVerses, onHoverVerses, selectedVerses,
  onScriptureRef, onAppendixRef,
}: FooterCommentaryProps) {
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSourceId((prev) =>
      prev !== null && sources.some((s) => s.id === prev) ? prev : sources[0]?.id ?? null,
    );
  }, [sources]);

  // Re-populate on chapter navigation. The stale-response guard matters:
  // paging quickly through a book fires several loads, and without it a slow
  // earlier chapter could land after a faster later one.
  useEffect(() => {
    if (sourceId === null) { setEntries([]); return; }
    let current = true;
    setLoading(true);
    getEntries(sourceId, reference.book, reference.chapter)
      .then((rows) => {
        if (!current) return;
        setEntries(rows);
        setError('');
      })
      .catch((e) => {
        if (!current) return;
        setEntries([]);
        setError(String(e));
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [sourceId, reference.book, reference.chapter]);

  const { roots, byVerse } = useMemo(() => buildChapterIndex(entries), [entries]);

  // Hover-follow alone can't be read. Moving the mouse from a verse down to
  // its comment drags the cursor across every verse in between, and each one
  // re-marks and re-scrolls the strip, so the comment you were heading for
  // has slid away by the time you get there. Clicking a verse therefore PINS
  // the strip to it: the pinned cells stay marked and stay put, and hover is
  // ignored entirely until the pin is released. Released by clicking ✕ on the
  // pin chip, or by clearing the selection in the pane.
  const [releasedKey, setReleasedKey] = useState<string | null>(null);
  const selectionKey = pinKey(selectedVerses);
  const candidate = selectionKey !== null && selectionKey !== releasedKey ? selectedVerses : null;

  // Which cells a reference marks. Only a reference in this same book and
  // chapter counts — another pane may be sitting elsewhere.
  const idsFor = useCallback((ref: HoveredVerses | null): Set<number> => {
    const ids = new Set<number>();
    if (!ref || ref.book !== reference.book || ref.chapter !== reference.chapter) return ids;
    for (const v of ref.verses) {
      for (const id of byVerse.get(v) ?? []) ids.add(id);
    }
    return ids;
  }, [byVerse, reference.book, reference.chapter]);

  const pinnedIds = useMemo(() => idsFor(candidate), [idsFor, candidate]);
  const hoveredIds = useMemo(() => idsFor(hoveredVerses), [idsFor, hoveredVerses]);
  // A selection only pins if it actually lands on a comment. Clicking a verse
  // JFB doesn't comment on would otherwise freeze the strip on nothing, which
  // reads as the tab having broken; better to leave hover-follow running.
  const pin = pinnedIds.size > 0 ? candidate : null;
  // While pinned, hover marks nothing: the whole point is that the strip
  // stops reacting to the mouse crossing the pane.
  const markedIds = pin ? pinnedIds : hoveredIds;

  // Scroll the first marked cell into view. Horizontal only ('nearest' on the
  // block axis) so marking a cell never scrolls the reading pane the user is
  // hovering in out from under them.
  //
  // Skipped when the hover started on a cell here: that cell is already under
  // the cursor, and centring it would slide the strip out from under the
  // mouse. Only a reference arriving from a reading pane scrolls the strip.
  const selfHover = useRef(false);
  const firstMarked = markedIds.size > 0 ? [...markedIds][0] : null;
  useEffect(() => {
    if (firstMarked === null || selfHover.current) return;
    const cell = stripRef.current?.querySelector(`[data-comment-id="${firstMarked}"]`);
    cell?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }, [firstMarked]);

  const reportHover = (verses: number[]) => {
    selfHover.current = true;
    onHoverVerses({ book: reference.book, chapter: reference.chapter, verses });
  };


  const clearHover = () => {
    selfHover.current = false;
    onHoverVerses(null);
  };

  const renderNode = (node: CommentNode, nested: boolean) => {
    const { entry } = node;
    const marked = markedIds.has(entry.id) ? (pin ? ' pinned' : ' marked') : '';
    return (
      <div
        key={entry.id}
        data-comment-id={entry.id}
        className={`commentary-cell${nested ? ' nested' : ''}${marked}`}
        onMouseEnter={() => reportHover(node.verses)}
        onMouseLeave={clearHover}
      >
        {entry.heading && <div className="commentary-heading">{entry.heading}</div>}
        <div className="commentary-verse-label">
          {reference.book} {entry.chapter}:{entry.position_ref ?? entry.verse}
        </div>
        <div className="commentary-text">
          {entry.text.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{renderMarkedUp(p, onScriptureRef, onAppendixRef, reference)}</p>
          ))}
        </div>
        {node.children.length > 0 && (
          <div className="commentary-subnotes">
            {node.children.map((child) => renderNode(child, true))}
          </div>
        )}
      </div>
    );
  };

  if (sources.length === 0) {
    return (
      <div className="pane-empty footer-empty">
        No footer commentaries installed yet — the Library lists them under "Commentaries".
        (The Companion Bible works read in their own panes.)
      </div>
    );
  }

  return (
    <div className="footer-commentary">
      <div className="footer-commentary-bar">
        {/* Always rendered, even with one commentary installed: it's the only
            place that names which commentary you're reading, and showing it
            is what makes it obvious more can be added from the Library. */}
        <select
          className="commentary-source-picker"
          value={sourceId ?? ''}
          onChange={(e) => setSourceId(Number(e.target.value))}
          title="Which commentary this strip is showing — install more from the Library"
        >
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        <span className="footer-commentary-ref">
          {reference.book} {reference.chapter}
        </span>
        {pin && (
          <span className="commentary-pin" title="Pinned — hovering verses won't move the strip">
            📌 {pin.book} {pin.chapter}:{pin.verses.join(', ')}
            <button
              className="commentary-pin-release"
              onClick={() => setReleasedKey(selectionKey)}
              title="Release the pin and follow the cursor again"
            >✕</button>
          </span>
        )}
        <span className="footer-commentary-count">
          {roots.length === 0 ? '' : `${entries.length} comment${entries.length === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="commentary-strip" ref={stripRef}>
        {error && <div className="import-warning">⚠ {error}</div>}
        {!error && !loading && roots.length === 0 && (
          <div className="pane-empty footer-empty">
            No commentary on {reference.book} {reference.chapter}.
          </div>
        )}
        {!error && roots.map((node) => renderNode(node, false))}
      </div>
    </div>
  );
}
