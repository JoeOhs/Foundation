import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for Josephus's complete works in William
// Whiston's 1737 translation — not routed through importer.ts's sniffer,
// since the bundle's shape is fixed and known (produced by the standalone
// builder in josephus/build.mjs). Bundled under public/library/ and
// installed from local disk, so it never makes a network call.
//
// This is the first *compound work*: four separate Gutenberg texts combined
// into ONE source with ~30 books under it, and a three-level
// Work → Book → Chapter table of contents. The generalisation that made
// that possible lives in db.ts's insertTocEntries (per-book resolution via
// ParsedTocEntry.bookIndex) rather than here, so the Companion Bible
// commentary — already one source with many books — can grow a TOC the same
// way without a second mechanism.
//
// TRANSLATION: Whiston only. Modern translations of Josephus (Loeb,
// Feldman, Mason/Brill) are separately copyrighted. josephus/build.mjs
// refuses to build a bundle whose Gutenberg header doesn't name Whiston.
//
// FOOTNOTES: Whiston's translator notes and dissertations are *excluded*
// rather than captured. They're stripped in build.mjs, so nothing reaches
// entries.text — the same rule the Strong's import follows, for the reason
// that bug taught: a note merged into the text silently rewrites the work.
// They are not captured into an entry_notes-style table either, and that is
// a deliberate trade rather than an oversight: the Gutenberg transcription
// renders inline note markers as bare digits fused onto the preceding word
// ("Red Sea.4 Now"), with no delimiter separating a marker from a numeral
// that belongs to Josephus ("Genesis 44:20", "the 12 tribes"). Anchoring
// them to a word position would mean guessing which digits are which, and a
// wrong guess corrupts the text. Dropping them loses Whiston's commentary
// but keeps Josephus exact, which is the right way round.
const BUNDLE_URL = '/library/historical/josephus.json';

export const JOSEPHUS_TITLE = 'Josephus — Complete Works (trans. William Whiston, 1737)';

interface BundledSection {
  number: number;
  text: string;
}

interface BundledChapter {
  number: number;
  title: string;
  sections: BundledSection[];
}

interface BundledBook {
  name: string;
  title: string;
  chapters: BundledChapter[];
}

interface BundledPart {
  id: string;
  title: string;
  gutenberg_id: number;
  books: BundledBook[];
}

interface BundledJosephusFile {
  metadata: {
    build_date: string;
    work: string;
    translator: string;
    source_site: string;
    gutenberg_ids: number[];
    license_note: string;
    total_sections: number;
  };
  parts: BundledPart[];
}

// Josephus's own citation is Book.Chapter.Section ("Antiquities 18.3.3"),
// which has nothing to do with Bible book/chapter/verse — so this imports
// freeform, position_ref-anchored, exactly like an EPUB. A book's chapters
// map onto entries.chapter purely as a *loading* unit: the pane fetches one
// chapter's sections at a time (getEntries(source, book, chapter)) instead
// of all 2,277 at once, which is what keeps a work this size responsive.
function buildParsedSource(data: BundledJosephusFile): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const part of data.parts) {
    // Level 0 — the work ("Antiquities of the Jews"). A grouping heading:
    // entryIndex -1 means it labels its children without being jumpable.
    toc.push({ title: part.title, level: 0, entryIndex: -1 });

    for (const book of part.books) {
      const entries: ParsedEntry[] = [];
      // Where this book will land in `books`, for the TOC rows below.
      const bookIndex = books.length;
      // Level 2 rows are collected separately so the level 1 row can be
      // emitted ahead of them — the dropdown has to read Work → Book →
      // Chapter in order.
      const chapterRows: ParsedTocEntry[] = [];

      for (const chapter of book.chapters) {
        if (chapter.sections.length === 0) continue;
        const firstEntryOfChapter = entries.length;
        chapter.sections.forEach((section, i) => {
          entries.push({
            chapter: chapter.number,
            verse: null,
            // Josephus's citation, on the section that opens each chapter.
            // Repeating it on every section would just be noise in the
            // reading column.
            position_ref: i === 0 ? `${book.name}, Chapter ${chapter.number}` : null,
            text: section.text,
          });
        });
        chapterRows.push({
          title: chapter.title
            ? `Chapter ${chapter.number}. ${chapter.title}`
            : `Chapter ${chapter.number}`,
          level: 2,
          entryIndex: firstEntryOfChapter,
          bookIndex,
        });
      }

      if (entries.length === 0) continue;
      books.push({ name: `${part.title} — ${book.name}`, entries });
      // Level 1 — the book, opening at its first section.
      toc.push({ title: book.name, level: 1, entryIndex: 0, bookIndex });
      toc.push(...chapterRows);
    }
  }

  return {
    suggestedTitle: JOSEPHUS_TITLE,
    // 'extra-biblical' is the behavioural type — it keeps Josephus out of
    // the Bible panes' source picker and out of verse-scoped search. The
    // Library files it under category 'historical', which `type` has no way
    // to express (an EPUB is 'extra-biblical' too).
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: 'Flavius Josephus, trans. William Whiston',
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

async function loadBundle(): Promise<BundledJosephusFile> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Could not load the bundled Josephus texts (${res.status}).`);
  const data: BundledJosephusFile = await res.json();
  if (!data.parts || data.parts.length === 0) {
    throw new Error('Bundled Josephus file is empty or malformed.');
  }
  return data;
}

// Returns the new source's id so the caller can open it straight away.
export async function installJosephus(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled Josephus…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: JOSEPHUS_TITLE,
      type: 'extra-biblical',
      language: 'en',
      license_note: data.metadata.license_note,
      category: 'historical',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
