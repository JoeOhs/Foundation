import type { LinkRow, SelectedEntry, SelectedVerse } from './types';

// A human reference for a run of selected verses: "John 3:16", "John
// 3:16-18", or "John 3:16, 18" when the selection has gaps.
export function versesReference(verses: SelectedVerse[]): string {
  if (verses.length === 0) return '';
  const { book, chapter } = verses[0];
  const nums = verses.map((v) => v.verse).sort((a, b) => a - b);
  const runs: string[] = [];
  let runStart = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    if (i < nums.length && nums[i] === prev + 1) {
      prev = nums[i];
      continue;
    }
    runs.push(runStart === prev ? `${runStart}` : `${runStart}-${prev}`);
    if (i < nums.length) {
      runStart = nums[i];
      prev = nums[i];
    }
  }
  return `${book} ${chapter}:${runs.join(', ')}`;
}

// A single imported-entry selection rendered as a markdown blockquote —
// the freeform counterpart to versesToMarkdown.
export function entryToMarkdown(e: SelectedEntry): string {
  const ref = e.positionRef ?? e.sourceTitle;
  const source = e.sourceTitle && e.sourceTitle !== ref ? ` — ${e.sourceTitle}` : '';
  return `> **${ref}**${source}\n>\n> ${e.text.trim()}`;
}

// A LinkRow's endpoint rendered as a markdown blockquote, dispatching on
// whether it's a canonical verse or an imported entry.
function linkEndpointMarkdown(
  kind: 'a' | 'b',
  l: LinkRow,
): string {
  const text = kind === 'a' ? l.text_a : l.text_b;
  const entryId = kind === 'a' ? l.entry_id_a : l.entry_id_b;
  if (entryId !== null) {
    const ref = (kind === 'a' ? l.position_ref_a : l.position_ref_b) ?? (kind === 'a' ? l.source_title_a : l.source_title_b) ?? '';
    const sourceTitle = kind === 'a' ? l.source_title_a : l.source_title_b;
    const source = sourceTitle && sourceTitle !== ref ? ` — ${sourceTitle}` : '';
    return `> **${ref}**${source}\n>\n> ${text.trim()}`;
  }
  const book = kind === 'a' ? l.book_a : l.book_b;
  const chapter = kind === 'a' ? l.chapter_a : l.chapter_b;
  const verse = kind === 'a' ? l.verse_a : l.verse_b;
  return `> **${book} ${chapter}:${verse}**\n>\n> ${text.trim()}`;
}

// Both endpoints of a link (verse and/or imported entry, in any
// combination) rendered as a markdown fragment — used when sending a link
// to a note, replacing the verse-only linkToMarkdown above for the
// generalized LinkRow shape.
export function linkRowToMarkdown(l: LinkRow): string {
  return `${linkEndpointMarkdown('a', l)}\n\n🔗 *linked with*\n\n${linkEndpointMarkdown('b', l)}`;
}

// Render selected verses as a markdown blockquote suitable for insertion
// into a note: a bold reference + source, then each verse (numbered when
// more than one). Verses are ordered by number regardless of click order.
export function versesToMarkdown(verses: SelectedVerse[]): string {
  if (verses.length === 0) return '';
  const ordered = [...verses].sort((a, b) => a.verse - b.verse);
  const ref = versesReference(ordered);
  const source = ordered[0].sourceTitle ? ` — ${ordered[0].sourceTitle}` : '';
  const lines = ordered.map((v) => {
    const num = ordered.length > 1 ? `**${v.verse}** ` : '';
    return `> ${num}${v.text.trim()}`;
  });
  return `> **${ref}**${source}\n>\n${lines.join('\n')}`;
}

// The verses an entry's printed range (entries.position_ref) refers to — the
// inverse of versesReference above. Bullinger writes these as "3", "1, 2",
// "4-6", and with a hyphen marking half a verse: "7-" (first part of 7),
// "-7" (second part), "18, 19-". A partial verse still means that whole verse
// for the purpose of pointing at the text.
//
// Shared by the Companion Bible's Structure lines and JFB's footer comments,
// which is why it lives here rather than in either component.
export function versesInRefRange(ref: string | null): number[] {
  if (!ref) return [];
  const out = new Set<number>();
  for (const part of ref.split(',')) {
    const span = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(part);
    if (span) {
      const [lo, hi] = [Number(span[1]), Number(span[2])].sort((a, b) => a - b);
      for (let v = lo; v <= hi; v++) out.add(v);
      continue;
    }
    const one = /(\d+)/.exec(part);
    if (one) out.add(Number(one[1]));
  }
  return [...out];
}
