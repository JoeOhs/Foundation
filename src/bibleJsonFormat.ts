import { CANONICAL_BOOKS } from './bibleMeta';
import type { ParsedBook, ParsedSource } from './types';

// Shared by the bundled seed (public/seed/*.json) and the downloadable
// library (src/library.ts) — both use the thiagobodruk/bible JSON shape:
// an array of 66 books in canonical order, each { abbrev, chapters: [[verse, ...]] }.
export interface BibleJsonBook {
  abbrev: string;
  chapters: string[][];
}

export function bibleJsonToParsedSource(data: BibleJsonBook[], title: string): ParsedSource {
  const books: ParsedBook[] = data.map((b, i) => {
    const name = data.length === 66 ? CANONICAL_BOOKS[i] : b.abbrev;
    const entries = b.chapters.flatMap((verses, ci) =>
      verses.map((text, vi) => ({
        chapter: ci + 1,
        verse: vi + 1,
        // Some translations mark translator-supplied words with {braces};
        // keep the words, drop the markup.
        text: text.replace(/[{}]/g, ''),
        position_ref: null,
      })),
    );
    return { name, entries };
  });
  return { suggestedTitle: title, suggestedType: 'bible', structure: 'verse-keyed', books, warnings: [] };
}
