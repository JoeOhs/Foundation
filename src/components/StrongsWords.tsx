import { useEffect, useState } from 'react';
import type { EntryNote, StrongsWordRow, StrongsWordSlot } from '../types';

// A word slot is usually one strongs_words row, but occasionally two rows
// share a word_index (e.g. an untranslated Hebrew particle folded into the
// following word's English rendering) — group them back into one span.
export function groupWordsByIndex(rows: StrongsWordRow[]): StrongsWordSlot[] {
  const byIndex = new Map<number, StrongsWordSlot>();
  for (const r of rows) {
    const existing = byIndex.get(r.word_index);
    if (existing) existing.strongs_numbers.push(r.strongs_number);
    else byIndex.set(r.word_index, { word_index: r.word_index, surface_text: r.surface_text, strongs_numbers: [r.strongs_number] });
  }
  return [...byIndex.values()].sort((a, b) => a.word_index - b.word_index);
}

interface TextSegment {
  text: string;
  slot: StrongsWordSlot | null;
}

// The Strong's source and the seeded KJV text disagree on punctuation: the
// tagged spans carry typographic apostrophes and en-dashes ("his wife’s",
// "Tubal–cain") where the verse text has ASCII or nothing at all ("his
// wife's", "Tubalcain"). Matching literally loses those spans — ~2,700
// tagged words across the KJV had no clickable span because of it — so
// comparison runs on a punctuation-folded copy.
const APOSTROPHES = /[‘’ʼ´`]/; // ‘ ’ ʼ ´ `
const DASHES = /[-‐-―−]/; // - ‐ ‑ ‒ – — ― −

// Folds the match-only differences away, keeping `offsets[i]` pointing at the
// source index of folded character `i` so a match can be sliced back out of
// the original string verbatim.
function foldForMatch(s: string): { folded: string; offsets: number[] } {
  let folded = '';
  const offsets: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (DASHES.test(c)) continue;
    // one output char per input char keeps offsets a straight 1:1 map
    const lower = c.toLowerCase();
    folded += APOSTROPHES.test(c) ? "'" : (lower.length === 1 ? lower : c);
    offsets.push(i);
  }
  return { folded, offsets };
}

// The KJV+Strong's source tags most, but not all, words — translators'
// supplied words (traditionally italicized, ~21k of them) carry no Strong's
// number and so have no row in strongs_words at all. Rather than
// reconstructing verse text purely from tagged words (which would silently
// drop every supplied word and read as a broken sentence), this aligns the
// tagged slots onto the entry's existing, already-correct text — a greedy
// left-to-right substring match — so the visible reading is always exactly
// entries.text, just partitioned into clickable/highlightable spans plus
// plain filler wherever a slot can't be located (~2,000 spans, where the
// source's versification puts the words in a neighbouring verse).
export function alignWordsToText(text: string, slots: StrongsWordSlot[]): TextSegment[] {
  const segments: TextSegment[] = [];
  const { folded, offsets } = foldForMatch(text);
  let searchFrom = 0; // cursor in folded space
  let emitted = 0; // cursor in original-text space
  for (const slot of slots) {
    const needle = foldForMatch(slot.surface_text.trim()).folded;
    if (!needle) continue;
    const at = folded.indexOf(needle, searchFrom);
    if (at === -1) continue;
    const start = offsets[at];
    const end = offsets[at + needle.length - 1] + 1;
    if (start > emitted) segments.push({ text: text.slice(emitted, start), slot: null });
    segments.push({ text: text.slice(start, end), slot });
    emitted = end;
    searchFrom = at + needle.length;
  }
  if (emitted < text.length) segments.push({ text: text.slice(emitted), slot: null });
  return segments;
}

// A translator's-note marker with its popover bubble. The marker is a
// persistent superscript (so it never shifts layout by appearing); the
// bubble is absolutely positioned. Hover shows it transiently; click pins
// it open (for touch, and to keep it up while moving the mouse); clicking
// the marker again or anywhere else dismisses a pinned popover.
function FootnoteMarker({
  note, open, onHover, onPin,
}: {
  note: EntryNote;
  open: boolean;
  onHover: (id: number | null) => void;
  onPin: (id: number | null) => void;
}) {
  return (
    <span className="footnote-wrap">
      <span
        className="footnote-marker"
        title={open ? undefined : 'Translator’s note'}
        onMouseEnter={() => onHover(note.id)}
        onMouseLeave={() => onHover(null)}
        onClick={(e) => {
          e.stopPropagation();
          onPin(open ? null : note.id);
        }}
      >
        °
      </span>
      {open && (
        <span className="footnote-pop" onClick={(e) => e.stopPropagation()}>
          {note.note_text}
        </span>
      )}
    </span>
  );
}

interface StrongsVerseTextProps {
  text: string;
  words: StrongsWordRow[];
  // Translator's notes for this entry — rendered as footnote markers after
  // the word each is anchored to (or at the verse end for verse-level
  // notes). Empty/omitted means no markers, no footprint.
  notes?: EntryNote[];
  // word_indexes to highlight. A search-hit row highlights just its own
  // occurrence; the reader highlights every slot sharing the clicked
  // occurrence's Strong's number, so a word used twice in one verse
  // (Ezek 5:6 "my statutes" ×2) lights up completely.
  highlightWordIndexes?: ReadonlySet<number> | null;
  onWordClick?: (slot: StrongsWordSlot) => void;
}

// Renders a verse's text, overlaying clickable/highlightable spans for any
// Strong's-tagged words — used by both the reader (Pane.tsx) and the smart
// search results list, so the two stay visually and behaviorally consistent.
// Falls back to plain text automatically when `words` is empty.
export default function StrongsVerseText({ text, words, notes = [], highlightWordIndexes, onWordClick }: StrongsVerseTextProps) {
  const [hoverNoteId, setHoverNoteId] = useState<number | null>(null);
  const [pinnedNoteId, setPinnedNoteId] = useState<number | null>(null);

  // Click-elsewhere dismiss for a click-pinned popover.
  useEffect(() => {
    if (pinnedNoteId === null) return;
    const dismiss = () => setPinnedNoteId(null);
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [pinnedNoteId]);

  const renderMarkers = (forNotes: EntryNote[]) =>
    forNotes.map((n) => (
      <FootnoteMarker
        key={n.id}
        note={n}
        open={pinnedNoteId === n.id || hoverNoteId === n.id}
        onHover={setHoverNoteId}
        onPin={setPinnedNoteId}
      />
    ));

  if (words.length === 0 && notes.length === 0) return <>{text}</>;

  const segments = alignWordsToText(text, groupWordsByIndex(words));
  // Notes anchored to a word_index that has a rendered segment attach after
  // it; everything else (verse-level, or anchor didn't align) goes to the
  // verse end so no note is ever silently dropped.
  const renderedIndices = new Set(segments.filter((s) => s.slot).map((s) => s.slot!.word_index));
  const notesByIndex = new Map<number, EntryNote[]>();
  const verseEndNotes: EntryNote[] = [];
  for (const n of notes) {
    if (n.word_index !== null && renderedIndices.has(n.word_index)) {
      if (!notesByIndex.has(n.word_index)) notesByIndex.set(n.word_index, []);
      notesByIndex.get(n.word_index)!.push(n);
    } else {
      verseEndNotes.push(n);
    }
  }

  return (
    <>
      {segments.map((seg, i) =>
        seg.slot ? (
          <span key={i}>
            <span
              className={`strongs-word${highlightWordIndexes?.has(seg.slot.word_index) ? ' strongs-highlight' : ''}`}
              title={seg.slot.strongs_numbers.join(', ')}
              onClick={(e) => {
                if (!onWordClick) return;
                e.stopPropagation();
                onWordClick(seg.slot!);
              }}
            >
              {seg.text}
            </span>
            {notesByIndex.has(seg.slot.word_index) && renderMarkers(notesByIndex.get(seg.slot.word_index)!)}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
      {verseEndNotes.length > 0 && renderMarkers(verseEndNotes)}
    </>
  );
}
