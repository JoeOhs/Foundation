import { CANONICAL_BOOKS } from './bibleMeta';
import type { ParsedBook, ParsedSource } from './types';

// Shared by the bundled seed (public/seed/*.json) and the downloadable
// library (src/library.ts) — both use the thiagobodruk/bible JSON shape:
// an array of 66 books in canonical order, each { abbrev, chapters: [[verse, ...]] }.
export interface BibleJsonBook {
  abbrev: string;
  chapters: string[][];
}

// This dataset overloads {braces} for two very different things:
//   {was}                      — a translator-supplied word (KJV italics):
//                                part of the verse, keep the word.
//   {firmament: Heb. expansion} — a translator's note (catchword + gloss):
//                                NOT verse text, must not leak into it.
// The colon separates them cleanly: across all 29,393 brace groups in the
// KJV seed, every note contains a colon and no supplied word does. Notes
// are dropped here (the Strong's add-on captures the same annotations,
// word-anchored, from the OSIS source into entry_notes); supplied words
// keep their text. Naively stripping just the brace characters — which
// this function once did — leaks every note inline into entries.text.
export function cleanBraceMarkup(verse: string): string {
  let out = verse;
  // A few groups nest one level (Micah 7:12) or contain a stray brace from
  // a source typo (Hebrews 10:34), so: match greedily up to the last } not
  // crossing another {, and iterate until stable.
  let prev;
  do {
    prev = out;
    out = out.replace(/\s*\{([^{]*)\}/g, (_, inner: string) => (inner.includes(':') ? '' : ` ${inner}`));
  } while (out !== prev);
  // Unbalanced leftovers (e.g. the «epistle subscription» colophons carry
  // mismatched braces in this dataset) — drop the brace chars, keep text.
  return out.replace(/[{}]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function bibleJsonToParsedSource(data: BibleJsonBook[], title: string): ParsedSource {
  const books: ParsedBook[] = data.map((b, i) => {
    const name = data.length === 66 ? CANONICAL_BOOKS[i] : b.abbrev;
    const entries = b.chapters.flatMap((verses, ci) =>
      verses.map((text, vi) => ({
        chapter: ci + 1,
        verse: vi + 1,
        text: cleanBraceMarkup(text),
        position_ref: null,
      })),
    );
    return { name, entries };
  });
  return { suggestedTitle: title, suggestedType: 'bible', structure: 'verse-keyed', books, warnings: [] };
}
