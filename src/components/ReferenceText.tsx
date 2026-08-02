import { useMemo } from 'react';
import { parseBullingerRefs, type BullingerRef } from '../bullingerRefs';

// Renders a Companion Bible note with Bullinger's cross-references made
// clickable. Follows the same rule as StrongsWords: the visible reading is
// always exactly the stored `entries.text`, just partitioned into spans —
// nothing is rewritten, inserted or dropped (parseBullingerRefs guarantees
// the segments concatenate back to the original).
//
// Clicks stop propagating so following a reference doesn't also select the
// note for highlighting.

export interface ReferenceTextProps {
  text: string;
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

export default function ReferenceText({ text, context, onScripture, onAppendix }: ReferenceTextProps) {
  const segments = useMemo(() => parseBullingerRefs(text, context), [text, context]);

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
