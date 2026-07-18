import type { StrongsWordRow, StrongsWordSlot } from '../types';

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

// The KJV+Strong's source tags most, but not all, words — translators'
// supplied words (traditionally italicized, ~21k of them) carry no Strong's
// number and so have no row in strongs_words at all. Rather than
// reconstructing verse text purely from tagged words (which would silently
// drop every supplied word and read as a broken sentence), this aligns the
// tagged slots onto the entry's existing, already-correct text — a greedy
// left-to-right substring match — so the visible reading is always exactly
// entries.text, just partitioned into clickable/highlightable spans plus
// plain filler wherever a slot can't be located (e.g. minor transcription
// differences between the JSON seed and the OSIS source).
export function alignWordsToText(text: string, slots: StrongsWordSlot[]): TextSegment[] {
  const segments: TextSegment[] = [];
  const lower = text.toLowerCase();
  let cursor = 0;
  for (const slot of slots) {
    const needle = slot.surface_text.trim().toLowerCase();
    if (!needle) continue;
    const idx = lower.indexOf(needle, cursor);
    if (idx === -1) continue;
    if (idx > cursor) segments.push({ text: text.slice(cursor, idx), slot: null });
    segments.push({ text: text.slice(idx, idx + needle.length), slot });
    cursor = idx + needle.length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), slot: null });
  return segments;
}

interface StrongsVerseTextProps {
  text: string;
  words: StrongsWordRow[];
  // word_index of a specific word to highlight (e.g. arrived at via a smart
  // search hit), independent of which strongs_number it carries.
  highlightWordIndex?: number | null;
  onWordClick?: (slot: StrongsWordSlot) => void;
}

// Renders a verse's text, overlaying clickable/highlightable spans for any
// Strong's-tagged words — used by both the reader (Pane.tsx) and the smart
// search results list, so the two stay visually and behaviorally consistent.
// Falls back to plain text automatically when `words` is empty.
export default function StrongsVerseText({ text, words, highlightWordIndex, onWordClick }: StrongsVerseTextProps) {
  if (words.length === 0) return <>{text}</>;
  const segments = alignWordsToText(text, groupWordsByIndex(words));
  return (
    <>
      {segments.map((seg, i) =>
        seg.slot ? (
          <span
            key={i}
            className={`strongs-word${highlightWordIndex === seg.slot.word_index ? ' strongs-highlight' : ''}`}
            title={seg.slot.strongs_numbers.join(', ')}
            onClick={(e) => {
              if (!onWordClick) return;
              e.stopPropagation();
              onWordClick(seg.slot!);
            }}
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
  );
}
