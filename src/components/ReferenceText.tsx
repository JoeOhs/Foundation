import { useMemo } from 'react';
import { parseBullingerRefs, type BullingerRef, type RefSegment } from '../bullingerRefs';
import type { EntryRef } from '../types';

// Renders a Companion Bible note with Bullinger's cross-references made
// clickable. Follows the same rule as StrongsWords: the visible reading is
// always exactly the stored `entries.text`, just partitioned into spans —
// nothing is rewritten, inserted or dropped (parseBullingerRefs guarantees
// the segments concatenate back to the original).
//
// Clicks stop propagating so following a reference doesn't also select the
// note for highlighting.
//
// An entry whose importer already located its references (entry_refs — the
// Institutes' tagged citations) passes them as `refs`, and the text parser is
// skipped: stored spans are exact where parsing Bullinger's notation would
// only guess.

export interface ReferenceTextProps {
  text: string;
  refs?: EntryRef[];
  // The note's own book/chapter, used to resolve bare "v. 22" references.
  context: { book: string; chapter: number } | null;
  onScripture: (book: string, chapter: number, verse: number | null) => void;
  onAppendix: (appendix: number, section: string | null) => void;
}

function describe(ref: BullingerRef): string {
  if (ref.kind === 'scripture') {
    return `Go to ${ref.book} ${ref.chapter}${ref.verse !== null ? `:${ref.verse}` : ''}`;
  }
  return `Go to Appendix ${ref.number}${ref.section ? `, section ${ref.section}` : ''}`;
}

// Partitions `text` by stored spans, with the same concatenation guarantee
// parseBullingerRefs makes. A span that doesn't fit the text (overlapping,
// or past its end) is left as plain text rather than trusted.
function segmentsFromRefs(text: string, refs: EntryRef[]): RefSegment[] {
  const out: RefSegment[] = [];
  let at = 0;
  for (const r of refs) {
    if (r.char_start < at || r.char_end > text.length || r.char_end <= r.char_start) continue;
    if (r.char_start > at) out.push({ text: text.slice(at, r.char_start), ref: null });
    out.push({
      text: text.slice(r.char_start, r.char_end),
      ref: { kind: 'scripture', book: r.book, chapter: r.chapter, verse: r.verse },
    });
    at = r.char_end;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at), ref: null });
  return out;
}

export default function ReferenceText({ text, refs, context, onScripture, onAppendix }: ReferenceTextProps) {
  const segments = useMemo(
    () => (refs ? segmentsFromRefs(text, refs) : parseBullingerRefs(text, context)),
    [text, refs, context],
  );

  // Nothing recognised — render the string as-is rather than a pile of spans.
  if (segments.length === 1 && !segments[0].ref) return <>{text}</>;

  return (
    <>
      {segments.map((seg, i) => {
        if (!seg.ref) return <span key={i}>{seg.text}</span>;
        const ref = seg.ref;
        return (
          <span
            key={i}
            className={`bref bref-${ref.kind}`}
            role="link"
            tabIndex={0}
            title={describe(ref)}
            onClick={(e) => {
              e.stopPropagation();
              if (ref.kind === 'scripture') onScripture(ref.book, ref.chapter, ref.verse);
              else onAppendix(ref.number, ref.section);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              e.stopPropagation();
              if (ref.kind === 'scripture') onScripture(ref.book, ref.chapter, ref.verse);
              else onAppendix(ref.number, ref.section);
            }}
          >
            {seg.text}
          </span>
        );
      })}
    </>
  );
}
