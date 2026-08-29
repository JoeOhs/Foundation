import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for Ovid's Metamorphoses in Henry T.
// Riley's 1851 English prose translation — not routed through importer.ts's
// sniffer, since the bundle's shape is fixed and known (produced by the
// standalone builder in tools/ovid/build.mjs). Bundled under public/library/
// and installed from local disk, so it never makes a network call.
//
// A compound work in the Josephus mould: two separate Gutenberg texts
// (21765, Books I–VII; 26073, Books VIII–XV) combined into ONE source with
// fifteen books under it.
//
// UNITS ARE NOT ALWAYS ONE FABLE. Riley sometimes prints two or three fables
// under a single heading ("FABLES IV. V. AND VI."). The heading is what the
// book divides on, so it is what a pane loads: entries.chapter carries the
// unit's ordinal — dense and unique within its book, which is what stops two
// units merging — while position_ref carries Riley's own numbering, "XV.4-6"
// where a unit spans three. The TOC is two levels, Book → Fable, not the three
// Josephus needs: Josephus has Work → Book → Chapter because it folds four
// distinct works together, whereas the Metamorphoses is one work already, so
// Book → Fable is the natural depth. Both run on the same
// ParsedTocEntry.bookIndex machinery in db.ts.
//
// TRANSLATION: Riley only. Modern translations of the Metamorphoses
// (Melville, Lombardo, Martin, Raeburn) are separately copyrighted.
// tools/ovid/build.mjs refuses to build a bundle whose Gutenberg header
// doesn't name Riley. There is no licence exception to guard here the way
// the Talmud has one — Riley died in 1878 and the two source reprints are
// 1893 and 1899, so this is an unambiguous public-domain import.
//
// FOOTNOTES: captured, not excluded — the opposite call from Josephus, and
// for a concrete reason rather than a change of heart. Whiston's notes are
// dropped because the transcription fuses their markers onto the preceding
// word as bare digits, with no way to tell a marker from a numeral belonging
// to Josephus. Riley's are anchored: the builder parses Gutenberg's HTML,
// where every marker links to the note it points at, so a note is filed
// under the unit whose prose carries its marker. That mapping is exact
// rather than inferred, and the build fails if any note is left unclaimed.
//
// EXPLANATIONS: Riley closes each Fable with his own "Explanation" of it.
// These deliberately do NOT go to the study footer's Commentary tab. That
// tab is for works commenting on the Bible (JFB today); Riley is commenting
// on a classical poem, so routing him there would be a category error even
// though the plumbing would accept it. They render instead at the foot of
// the Fable's own content, inside the pane.
const BUNDLE_URL = '/library/historical/ovid.json';

export const OVID_TITLE = 'Ovid — Metamorphoses (trans. Henry T. Riley, 1851)';

// The labels carried in entries.heading on the apparatus entries. They are
// the pane's only cue that an entry is Riley's commentary rather than the
// fable itself, so they are constants rather than strings written twice.
const EXPLANATION_HEADING = 'Explanation';
const NOTES_HEADING = 'Notes';

interface BundledNote {
  number: number;
  // The Latin line the note keys itself to ("Ver. 5."), where it names one.
  // Carried for provenance; the note is filed by its marker, not by this.
  ver: number | null;
  text: string;
}

interface BundledFable {
  // Position within the book. This is the loading unit (entries.chapter),
  // never a citation.
  ordinal: number;
  // The fable number(s) Riley printed over this unit — [8], or [6, 7] where
  // he prints two under one heading ("FABLES VI AND VII.").
  numerals: number[];
  label: string;
  citation: string;
  paragraphs: string[];
  explanation: string[];
  notes: BundledNote[];
}

// Book I opens on THE ARGUMENT, Ovid's proem, before Fable I.
interface BundledPreamble {
  title: string;
  paragraphs: string[];
  notes: BundledNote[];
}

interface BundledBook {
  number: number;
  roman: string;
  name: string;
  preamble: BundledPreamble | null;
  fables: BundledFable[];
}

interface BundledOvidFile {
  metadata: {
    build_date: string;
    work: string;
    translator: string;
    source_site: string;
    gutenberg_ids: number[];
    reprints: string[];
    license_note: string;
    total_books: number;
    total_units: number;
    total_fables: number;
    total_paragraphs: number;
    total_explanation_paragraphs: number;
    total_footnotes: number;
    exclusions: string[];
    source_anomalies: string[];
  };
  books: BundledBook[];
}

// Ovid's citation is Book.Fable ("I.7"), which has nothing to do with Bible
// book/chapter/verse — so this imports freeform and position_ref-anchored,
// exactly like Josephus and the Talmud. A book's fables map onto
// entries.chapter purely as a *loading* unit: the pane fetches one fable's
// entries at a time (getEntries(source, book, chapter)) rather than a whole
// book at once.
function buildParsedSource(data: BundledOvidFile): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const book of data.books) {
    if (book.fables.length === 0) continue;
    const entries: ParsedEntry[] = [];
    const bookIndex = books.length;
    // Level 1 rows are collected as the book is walked so the level 0 book
    // row can be emitted ahead of them — the dropdown has to read
    // Book → Fable in order. Same shape as Josephus's chapterRows.
    const fableRows: ParsedTocEntry[] = [];

    // Riley's apparatus, at the foot of the unit it belongs to. These carry a
    // heading and NO position_ref, which is exactly how the pane tells them
    // apart from the narrative: an entry with a heading but no citation of
    // its own is apparatus attached to the block above it. entries.heading is
    // the nullable column added for JFB's section headings, reused rather
    // than a parallel column being invented. The heading repeats on every
    // paragraph of a run rather than sitting on the first alone, because it
    // is what marks the entry as apparatus at all; the pane prints the label
    // once, at the top of the run.
    const pushApparatus = (chapter: number, texts: string[], heading: string) => {
      for (const text of texts) {
        entries.push({ chapter, verse: null, position_ref: null, heading, text });
      }
    };

    // Book I's preamble is THE ARGUMENT — Ovid's proem, his own words, not
    // apparatus. It rides in the first unit so it keeps that unit's loading
    // chapter, but under its own citation and its own TOC row, so it is
    // neither folded invisibly into Fable I nor renumbered around.
    if (book.preamble && book.preamble.paragraphs.length > 0) {
      const ref = `${book.roman} — ${book.preamble.title}`;
      book.preamble.paragraphs.forEach((text, i) => {
        entries.push({
          chapter: book.fables[0].ordinal,
          verse: null,
          position_ref: i === 0 ? ref : null,
          heading: null,
          text,
        });
      });
      pushApparatus(book.fables[0].ordinal, book.preamble.notes.map(formatNote), NOTES_HEADING);
      fableRows.push({
        title: book.preamble.title,
        level: 1,
        entryIndex: 0,
        bookIndex,
      });
    }

    for (const fable of book.fables) {
      const firstEntryOfFable = entries.length;

      fable.paragraphs.forEach((text, i) => {
        entries.push({
          // The unit's ordinal, not Riley's numeral: entries.chapter is the
          // pane's loading unit and has to be dense and unique within the
          // book. Where Riley prints two fables under one heading his
          // numerals skip, and the citation below carries that faithfully.
          chapter: fable.ordinal,
          verse: null,
          // The citation goes on the paragraph that opens the unit —
          // "II.8", or "II.6-7" for a combined heading. Repeating it on
          // every paragraph would just be noise in the reading column, and
          // searchAll already resolves a hit to the nearest preceding
          // labelled entry in the same chapter.
          position_ref: i === 0 ? fable.citation : null,
          heading: null,
          text,
        });
      });

      pushApparatus(fable.ordinal, fable.explanation, EXPLANATION_HEADING);
      pushApparatus(fable.ordinal, fable.notes.map(formatNote), NOTES_HEADING);

      fableRows.push({
        title: `${fable.label} (${fable.citation})`,
        level: 1,
        entryIndex: firstEntryOfFable,
        bookIndex,
      });
    }

    if (entries.length === 0) continue;
    books.push({ name: book.name, entries });
    // Level 0 — the book, opening on its first unit. Jumpable rather than a
    // bare grouping row: with only two levels there is no third level for a
    // grouping row to label, and an unreachable row in the dropdown would be
    // dead weight. Same call Fox's Book of Martyrs made.
    toc.push({ title: book.name, level: 0, entryIndex: 0, bookIndex });
    toc.push(...fableRows);
  }

  return {
    suggestedTitle: OVID_TITLE,
    // 'extra-biblical' is the behavioural type — it keeps Ovid out of the
    // Bible panes' source picker and out of verse-scoped search. The Library
    // files it under category 'historical' alongside Josephus, which `type`
    // has no way to express (an EPUB is 'extra-biblical' too).
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: 'Ovid, trans. Henry T. Riley',
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

// A footnote reads as its own paragraph, opening with the marker Riley
// printed against it so it can be matched back to the text by eye. The
// "Ver. N" the note names is already the first thing in its own text, so it
// isn't repeated here.
function formatNote(note: BundledNote): string {
  return `${note.number}. ${note.text}`;
}

async function loadBundle(): Promise<BundledOvidFile> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Could not load the bundled Metamorphoses text (${res.status}).`);
  const data: BundledOvidFile = await res.json();
  if (!data.books || data.books.length === 0) {
    throw new Error('Bundled Metamorphoses file is empty or malformed.');
  }
  return data;
}

// Returns the new source's id so the caller can open it straight away.
export async function installOvid(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled Metamorphoses…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: OVID_TITLE,
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
