// Dedicated, fixed-schema importer for Thomas Aquinas's Summa Contra
// Gentiles in Joseph Rickaby's 1905 translation, "Of God and His Creatures".
// Deliberately NOT routed through importer.ts's sniffer: the input is a known
// bundle produced by tools/aquinas-gentiles/build.mjs, which records why this
// edition was pinned and how its licence is guarded.
//
// Reads a bundle shipped inside the app (public/library/apologetics/), so
// this makes no network request.
//
// TYPE — 'extra-biblical' in category 'apologetics', beside Chesterton: a
// case for the faith addressed to non-believers, which is what the category
// was named for.
//
// SHAPE — the Institutes' compound shape: ONE source, a `books` row per Book
// (plus Rickaby's preface and afterword), Book → Chapter table of contents.
// position_ref carries the chapter citation ("I.13"; merged chapters as
// "II.32, 35") on the paragraph that opens each chapter. entries.chapter is
// the chapter's ordinal within its Book, purely as a loading unit.
//
// Rickaby's footnotes follow each chapter as apparatus (is_apparatus), the
// column added for Riley's notes on Ovid, labelled once per run. The "[n]"
// markers in the prose are Rickaby's note numbers.

import { deleteSource, findSourceByTitle, insertEntryRefs, insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

export const AQUINAS_GENTILES_TITLE =
  'Thomas Aquinas — Summa Contra Gentiles (Of God and His Creatures, tr. Rickaby, 1905)';

const BUNDLE_URL = '/library/apologetics/gentiles.json';
const NOTES_HEADING = 'Rickaby’s notes';

// [paragraphIndex, charStart, charEnd, book, chapter, verse]
type BundleRef = [number, number, number, string, number, number | null];

interface BundleChapter {
  number: number;
  // The printed number(s): "13", "32, 35", "41–45". Null for the preface
  // and afterword.
  numbers: string | null;
  title: string;
  paragraphs: string[];
  refs?: BundleRef[];
  // Rickaby's footnotes, "n. text", continuation paragraphs unprefixed.
  notes: string[];
  note_refs?: BundleRef[];
}

interface BundleBook {
  name: string;
  // "I"–"IV" for the four Books; null for the preface and afterword.
  citation: string | null;
  chapters: BundleChapter[];
}

interface GentilesBundle {
  metadata: { author: string; license_note: string };
  books: BundleBook[];
}

function refsFor(refs: BundleRef[] | undefined, index: number): ParsedEntry['refs'] {
  return (refs ?? [])
    .filter((r) => r[0] === index)
    .map(([, char_start, char_end, book, chapter, verse]) => ({ char_start, char_end, book, chapter, verse }));
}

async function loadBundle(): Promise<GentilesBundle> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) {
    throw new Error(`Could not load the bundled Summa Contra Gentiles (${res.status} ${res.statusText}).`);
  }
  const data = (await res.json()) as GentilesBundle;
  if (!data.books || data.books.length === 0) {
    throw new Error('The bundled Summa Contra Gentiles contains no books.');
  }
  return data;
}

function buildParsedSource(data: GentilesBundle): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const book of data.books) {
    // Where this book will land in `books`, for its TOC rows.
    const bookIndex = books.length;
    const entries: ParsedEntry[] = [];
    const chapterRows: ParsedTocEntry[] = [];

    book.chapters.forEach((chapter, chapterIndex) => {
      const ordinal = chapterIndex + 1;
      const citation = book.citation && chapter.numbers ? `${book.citation}.${chapter.numbers}` : null;
      const first = entries.length;
      chapter.paragraphs.forEach((text, i) => {
        entries.push({
          chapter: ordinal,
          verse: null,
          position_ref: i === 0 ? citation : null,
          heading: i === 0 && citation ? chapter.title : null,
          text,
          refs: refsFor(chapter.refs, i),
        });
      });
      chapter.notes.forEach((text, i) => {
        entries.push({
          chapter: ordinal,
          verse: null,
          position_ref: null,
          heading: NOTES_HEADING,
          text,
          isApparatus: true,
          refs: refsFor(chapter.note_refs, i),
        });
      });
      if (citation && entries.length > first) {
        chapterRows.push({ title: `${citation}. ${chapter.title}`, level: 1, entryIndex: first, bookIndex });
      }
    });

    if (entries.length === 0) continue;
    books.push({ name: book.name, entries });
    // A Book is a grouping row over its chapters (-1: not itself jumpable);
    // the preface and afterword are single pieces, so their row opens them.
    toc.push({ title: book.name, level: 0, entryIndex: book.citation ? -1 : 0, bookIndex });
    toc.push(...chapterRows);
  }

  return {
    suggestedTitle: AQUINAS_GENTILES_TITLE,
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: data.metadata.author,
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

// Returns the new source's id so the caller can open it straight away.
export async function installAquinasGentiles(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading the bundled Summa Contra Gentiles…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  const existing = await findSourceByTitle(AQUINAS_GENTILES_TITLE);
  if (existing) {
    onProgress('Removing the previous copy…');
    await deleteSource(existing.id);
  }

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: AQUINAS_GENTILES_TITLE,
      type: 'extra-biblical',
      language: 'en',
      license_note: data.metadata.license_note,
      category: 'apologetics',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  onProgress('Linking Scripture references…');
  await insertEntryRefs(sourceId, parsed);
  return sourceId;
}
