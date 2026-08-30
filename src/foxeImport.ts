import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for Fox's Book of Martyrs — Project
// Gutenberg #22400, the 19th-century compilation published by The John C.
// Winston Co. Not routed through importer.ts's sniffer, since the bundle's
// shape is fixed and known (produced by the standalone builder in
// tools/foxe/build.mjs). Bundled under public/library/historical/ and
// installed from local disk, so it never makes a network call.
//
// EDITION — this is NOT Foxe's own 1563/1570 "Actes and Monuments". It is a
// compilation and abridgement built on his work by an unnamed 19th-century
// editor, who extended it to cover persecution history down to 1830 (Foxe
// died in 1587); its own preface says as much. That provenance travels into
// sources.license_note and is repeated in the Library blurb, so the user
// sees which edition they are reading rather than assuming the 16th-century
// original — the same care taken to distinguish Whiston's Josephus from a
// modern translation.
//
// SINGLE SOURCE, not a compound work. Josephus folds four Gutenberg texts
// into one source with ~30 books, and the Talmud splits into six; this is
// one Gutenberg text end to end, so it is one source with one book. The
// chapters live in entries.chapter rather than in books rows.
//
// HEADINGS — the named sub-entry titles in this bundle are produced by
// structural detection in build.mjs, not by any lexical rule: the text uses
// at least three conventions (roman numeral + name, ordinal word +
// descriptive title, and a bare descriptive title with no numbering).
// Trailing punctuation is trimmed from the label, which is what this file
// turns into a TOC row and a position_ref citation; the paragraph text is
// untouched. See tools/foxe/README.md.
//
// EDITORIAL ASIDES — the compiler's own bracketed interjections, signed
// "--Ed.", are kept in entries.text. They are his voice inside the text, not
// a proofreading artifact and not a footnote of the kind stripped from
// Josephus and the Church Fathers, so there is nothing here to strip.
// tools/foxe/build.mjs --audit lists every instance for review.
const BUNDLE_URL = '/library/historical/foxe.json';

export const FOXE_TITLE = "Fox's Book of Martyrs (19th-c. compilation, Gutenberg #22400)";

interface BundledUnit {
  // The named sub-entry's own heading, or null for a chapter's text before
  // its first named sub-entry (and for whole chapters that have none).
  heading: string | null;
  paragraphs: string[];
}

interface BundledChapter {
  number: number;
  roman: string;
  title: string;
  units: BundledUnit[];
}

interface BundledFoxeFile {
  metadata: {
    build_date: string;
    work: string;
    subtitle: string;
    credited_author: string;
    publisher: string;
    source_site: string;
    gutenberg_id: number;
    gutenberg_released: string;
    produced_by: string;
    edition_note: string;
    license_note: string;
    chapter_count: number;
    named_entry_count: number;
    paragraph_count: number;
  };
  chapters: BundledChapter[];
}

// This is a freeform historical narrative with no Bible book/chapter/verse
// of its own, so it imports position_ref-anchored, exactly like Josephus and
// the Talmud. The printed chapter number maps onto entries.chapter purely as
// a *loading* unit: the pane fetches one chapter's paragraphs at a time
// (getEntries(source, book, chapter)) rather than the whole book at once.
//
// Paragraph-per-entry granularity, not chapter-per-entry and not one entry
// per named sub-section: a single martyr's account often runs several
// paragraphs (Cyprian, Origen, Vincent), and highlights, notes and links all
// need a paragraph-sized selection unit.
function buildParsedSource(data: BundledFoxeFile): ParsedSource {
  const entries: ParsedEntry[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const chapter of data.chapters) {
    if (chapter.units.length === 0) continue;
    const firstEntryOfChapter = entries.length;
    const chapterRef = `Chapter ${chapter.roman}`;
    // Level 1 rows are collected separately so the level 0 chapter row can
    // be emitted ahead of them — the dropdown has to read Chapter → named
    // entry in order. Same shape as Josephus's chapterRows.
    const unitRows: ParsedTocEntry[] = [];

    for (const unit of chapter.units) {
      const firstEntryOfUnit = entries.length;
      unit.paragraphs.forEach((text, i) => {
        entries.push({
          chapter: chapter.number,
          verse: null,
          // The citation, on the paragraph that opens each unit. Repeating
          // it on every paragraph would just be noise in the reading
          // column, and searchAll already resolves a hit to the nearest
          // preceding labelled entry in the same chapter.
          //
          // The chapter reference ONLY. This used to carry the unit's
          // heading appended to it as well — which is what made Foxe's
          // headings appear to display, back when Pane.tsx rendered
          // position_ref and ignored heading entirely. Now that the pane
          // renders both, the duplicate would print the unit name twice on
          // every opening paragraph, so it comes out here and `heading`
          // below carries it alone, which is what that column is for.
          position_ref: i === 0 ? chapterRef : null,
          // entries.heading is the column added for JFB's own section
          // headings; a named sub-entry is exactly that, so it is reused
          // rather than a parallel column invented.
          heading: i === 0 ? unit.heading : null,
          text,
        });
      });
      // A chapter's unnamed leading run gets no row of its own — the
      // chapter row above already opens on it.
      if (unit.heading) {
        unitRows.push({ title: unit.heading, level: 1, entryIndex: firstEntryOfUnit });
      }
    }

    // Level 0 — the chapter. Unlike Josephus's "Work" row this is jumpable
    // rather than a bare grouping heading, because three chapters (IX, XI,
    // XV) are a single continuous narrative with no named sub-entries: as
    // grouping rows they would be unreachable dead rows in the dropdown.
    // Making every chapter row jumpable keeps the two levels uniform.
    toc.push({
      title: chapter.title ? `${chapterRef}. ${chapter.title}` : chapterRef,
      level: 0,
      entryIndex: firstEntryOfChapter,
    });
    toc.push(...unitRows);
  }

  const books: ParsedBook[] = [{ name: data.metadata.work, entries }];

  return {
    suggestedTitle: FOXE_TITLE,
    // 'extra-biblical' is the behavioural type — it keeps this out of the
    // Bible panes' source picker and out of verse-scoped search. The Library
    // files it under category 'historical' alongside Josephus, which `type`
    // has no way to express (an EPUB is 'extra-biblical' too).
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: 'John Foxe (19th-c. compilation)',
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

async function loadBundle(): Promise<BundledFoxeFile> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Could not load the bundled Book of Martyrs (${res.status}).`);
  const data: BundledFoxeFile = await res.json();
  if (!data.chapters || data.chapters.length === 0) {
    throw new Error("Bundled Fox's Book of Martyrs file is empty or malformed.");
  }
  return data;
}

// Returns the new source's id so the caller can open it straight away.
export async function installFoxe(onProgress: (msg: string) => void): Promise<number> {
  onProgress("Loading bundled Book of Martyrs…");
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: FOXE_TITLE,
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
