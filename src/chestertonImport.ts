import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for G.K. Chesterton's Christian
// apologetics — not routed through importer.ts's sniffer, since the bundle's
// shape is fixed and known (produced by the standalone builder in
// tools/chesterton/build.mjs). Bundled under public/library/ and installed
// from local disk, so it never makes a network call.
//
// A compound work in the same mould as Josephus: four separate Gutenberg
// texts combined into ONE source rather than four Library rows. Four rows
// would be four near-identical entries for what is really one shelf — the
// same reasoning that keeps the Wars, the Antiquities, the Life and Against
// Apion under a single Josephus row.
//
// SCOPE: apologetics and theology only. Chesterton also wrote detective
// fiction, poetry and a great deal of social criticism, and none of it
// belongs here — a Library row that means "Chesterton's Christian writings"
// stops meaning anything the moment Father Brown is filed under it.
//
// CATEGORY: 'apologetics', which this source introduced. Deliberately not
// 'historical' — that stays narrative history (Josephus and the
// martyrology), and Chesterton is arguing a case, not narrating events — and
// not 'commentary', which is reserved for works commenting on the Bible
// itself. The same reasoning that made 'patristic', 'rabbinic' and
// 'reformation' their own categories rather than stretching an existing one.
const BUNDLE_URL = '/library/apologetics/chesterton.json';

export const CHESTERTON_TITLE = 'G.K. Chesterton — Christian Apologetics';

interface BundledChapter {
  number: number;
  // The citation shown in the reading column: "Chapter 3", "Part 2,
  // Chapter 1", "Appendix 1", "Prefatory Note".
  label: string;
  // The chapter's own name. Empty for a self-describing section — The
  // Everlasting Man's prefatory note runs straight into its text.
  title: string;
  paragraphs: string[];
}

interface BundledTitle {
  id: string;
  title: string;
  year: number;
  gutenberg_id: number;
  chapters: BundledChapter[];
}

interface BundledChestertonFile {
  metadata: {
    build_date: string;
    work: string;
    author: string;
    source_site: string;
    gutenberg_ids: number[];
    license_note: string;
    total_paragraphs: number;
  };
  titles: BundledTitle[];
}

// Freeform prose with no Bible book/chapter/verse of its own, so this
// imports position_ref-anchored, exactly like Josephus, Foxe and an EPUB.
// The chapter number maps onto entries.chapter purely as a *loading* unit:
// the pane fetches one chapter's paragraphs at a time
// (getEntries(source, book, chapter)) rather than a whole book at once.
//
// Paragraph-per-entry granularity, not chapter-per-entry: Chesterton's
// chapters run to thousands of words, and highlights, notes and links all
// need a paragraph-sized selection unit.
function buildParsedSource(data: BundledChestertonFile): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const title of data.titles) {
    const entries: ParsedEntry[] = [];
    // Where this title will land in `books`, for the TOC rows below.
    const bookIndex = books.length;
    // Level 1 rows are collected separately so the level 0 title row can be
    // emitted ahead of them — the dropdown has to read Title → Chapter in
    // order. Same shape as Josephus's chapterRows.
    const chapterRows: ParsedTocEntry[] = [];

    for (const chapter of title.chapters) {
      if (chapter.paragraphs.length === 0) continue;
      const firstEntryOfChapter = entries.length;
      chapter.paragraphs.forEach((text, i) => {
        entries.push({
          chapter: chapter.number,
          verse: null,
          // The citation and the chapter's name, on the paragraph that opens
          // each chapter. Repeating them on every paragraph would just be
          // noise in the reading column, and searchAll already resolves a
          // hit to the nearest preceding labelled entry in the chapter.
          position_ref: i === 0 ? chapter.label : null,
          // entries.heading is the column added for JFB's own section
          // headings, reused here rather than a parallel column invented.
          heading: i === 0 && chapter.title ? chapter.title : null,
          text,
        });
      });
      chapterRows.push({
        title: chapter.title ? `${chapter.label}. ${chapter.title}` : chapter.label,
        level: 1,
        entryIndex: firstEntryOfChapter,
        bookIndex,
      });
    }

    if (entries.length === 0) continue;
    books.push({ name: title.title, entries });
    // Level 0 — the title. Jumpable rather than a bare grouping heading
    // (unlike Josephus's "Work" row, which labels several books): here one
    // title is exactly one book, so the row has an obvious place to open.
    toc.push({ title: `${title.title} (${title.year})`, level: 0, entryIndex: 0, bookIndex });
    toc.push(...chapterRows);
  }

  return {
    suggestedTitle: CHESTERTON_TITLE,
    // 'extra-biblical' is the behavioural type — it keeps this out of the
    // Bible panes' source picker and out of verse-scoped search. The Library
    // files it under category 'apologetics', which `type` has no way to
    // express (Josephus and an EPUB are 'extra-biblical' too).
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: 'G.K. Chesterton',
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

async function loadBundle(): Promise<BundledChestertonFile> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Could not load the bundled Chesterton texts (${res.status}).`);
  const data: BundledChestertonFile = await res.json();
  if (!data.titles || data.titles.length === 0) {
    throw new Error('Bundled Chesterton file is empty or malformed.');
  }
  return data;
}

// Returns the new source's id so the caller can open it straight away.
export async function installChesterton(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled Chesterton…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: CHESTERTON_TITLE,
      type: 'extra-biblical',
      language: 'en',
      license_note: data.metadata.license_note,
      category: 'apologetics',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
