import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for Hippolytus's *The Apostolic
// Tradition* in Burton Scott Easton's 1934 translation — not routed through
// importer.ts's sniffer, since the bundle's shape is fixed and known
// (produced by the standalone builder in
// tools/hippolytus-apostolic-tradition/build.mjs). Bundled under
// public/library/ and installed from local disk, so it never makes a network
// call.
//
// ITS OWN FILE, not folded into a shared "additional patristic works"
// importer: this is a one-off, not the first of a pattern. Every other
// patristic source in the Library is an ANF or NPNF volume built from CCEL's
// ThML, and nothing else is queued behind this one. A shared importer would
// be a shape invented for a second source that does not exist — the same
// reason each ANF volume has its own file rather than one parameterised one.
//
// NOT AN ANF VOLUME. The Ante-Nicene Fathers were translated in the 1880s,
// when Hippolytus had not yet been identified as this work's author and no
// critical text of it existed; ANF Vol. 5 carries his *Refutation* and his
// extant fragments, and nothing of the Apostolic Tradition. This is a later,
// separately-sourced addition shelved alongside the numbered volumes, and it
// must never be labelled "Vol. 10" — ANF Vol. 10 is the Roberts/Donaldson
// General Index, which the Library omits for reasons of its own.
//
// TRANSLATION: Easton's, and only Easton's. Gregory Dix's 1937 edition and
// the Dix/Chadwick 1968 revision are still in copyright (SPCK). The builder
// refuses to produce a bundle whose Gutenberg source no longer evidences the
// 1934 US printing that the public-domain clearance rests on.
//
// EASTON'S APPARATUS: his Introduction is included, as its own book with its
// own TOC branch, clearly attributed to him and separate from Hippolytus's
// text. A reconstructed work surviving only through a Latin palimpsest and
// three Oriental versions is not usefully read without the essay explaining
// that transmission, and ANF Vol. 5 sets the precedent by carrying
// Hippolytus's own Introductory Notice as a first-class entry. His *notes*,
// footnotes and indexes are excluded, stripped in build.mjs so that nothing
// of his reaches entries.text — the same rule the ANF/NPNF volumes, Whiston's
// Josephus and the Strong's import all follow, for the reason the
// `{braces}` note-leak bug taught: an editor's note merged into the text
// silently rewrites the work.
const BUNDLE_URL = '/library/patristic/hippolytus-apostolic-tradition.json';

export const HIPPOLYTUS_APOSTOLIC_TRADITION_TITLE =
  'Hippolytus — The Apostolic Tradition (tr. Easton, 1934)';

interface BundledSubsection {
  // Empty for a part's untitled lead-in.
  title: string;
  paragraphs: string[];
}

interface BundledIntroPart {
  title: string;
  subsections: BundledSubsection[];
}

interface BundledChapter {
  // Easton's own chapter number. NOT unique across the work: "Later
  // Additions" reprints 24, 26, 31 and 32 in their Oriental forms.
  number: number;
  // Easton's section title, from the headings over his Notes. Empty where he
  // gave the section no title of its own.
  title: string;
  // Set only where that heading covers a span of chapters ("4-6"), and only
  // on the chapter opening the span.
  span: string;
  paragraphs: string[];
}

interface BundledPart {
  // 'PART I'…'PART IV', 'LATER ADDITIONS', or empty for the preamble.
  label: string;
  name: string;
  chapters: BundledChapter[];
}

interface BundledApostolicTraditionFile {
  metadata: {
    build_date: string;
    work: string;
    author: string;
    translator: string;
    source_site: string;
    gutenberg_id: number;
    license_note: string;
    total_paragraphs: number;
  };
  introduction: BundledIntroPart[];
  translation: BundledPart[];
}

const INTRODUCTION_BOOK = 'Introduction (B. S. Easton, 1934)';
const TRANSLATION_BOOK = 'The Apostolic Tradition';

// The bundle carries the headings in the caps they are printed in. Five
// fixed values, so they are spelled out rather than case-folded by rule —
// a rule would have to know that "II" is a numeral and "Additions" is not.
const PART_LABELS: Record<string, string> = {
  'PART I': 'Part I',
  'PART II': 'Part II',
  'PART III': 'Part III',
  'PART IV': 'Part IV',
  'LATER ADDITIONS': 'Later Additions',
};

// "Chapter 5", "Chapter 2. The Bishop", "Chapters 4–6. The Eucharist".
function chapterRow(chapter: BundledChapter): string {
  const heading = chapter.span
    ? `Chapters ${chapter.span.replace('-', '–')}`
    : `Chapter ${chapter.number}`;
  return chapter.title ? `${heading}. ${chapter.title}` : heading;
}

// Freeform prose with no Bible book/chapter/verse of its own, so this imports
// position_ref-anchored, exactly like Josephus, Chesterton and an EPUB. The
// chapter number maps onto entries.chapter purely as a *loading* unit: the
// pane fetches one section's paragraphs at a time
// (getEntries(source, book, chapter)) rather than the whole work at once. It
// is a running index rather than Easton's own numbering, because his numbers
// repeat across "Later Additions" and a loading key has to be unique; his
// number is what the reader sees, in the entry's label and the TOC row.
//
// Paragraph-per-entry granularity, matching the rest of the patristic
// collection: highlights, notes and links all need a paragraph-sized
// selection unit.
function buildParsedSource(data: BundledApostolicTraditionFile): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  // --- Easton's introduction -------------------------------------------
  const introEntries: ParsedEntry[] = [];
  const introRows: ParsedTocEntry[] = [];
  const introBookIndex = books.length;
  let introChapter = 0;

  for (const part of data.introduction) {
    let firstEntryOfPart = -1;
    const subsectionRows: ParsedTocEntry[] = [];

    for (const subsection of part.subsections) {
      if (subsection.paragraphs.length === 0) continue;
      introChapter++;
      const firstEntry = introEntries.length;
      if (firstEntryOfPart === -1) firstEntryOfPart = firstEntry;

      subsection.paragraphs.forEach((text, i) => {
        introEntries.push({
          chapter: introChapter,
          verse: null,
          // The citation and the section's name, on the paragraph that opens
          // it. Repeating them on every paragraph would just be noise in the
          // reading column, and searchAll already resolves a hit to the
          // nearest preceding labelled entry.
          position_ref: i === 0 ? `Introduction: ${part.title}` : null,
          // entries.heading is the column added for JFB's own section
          // headings, reused here rather than a parallel column invented.
          heading: i === 0 && subsection.title ? subsection.title : null,
          text,
        });
      });

      // An untitled lead-in is already the target of its part's own row.
      if (subsection.title) {
        subsectionRows.push({
          title: subsection.title,
          level: 2,
          entryIndex: firstEntry,
          bookIndex: introBookIndex,
        });
      }
    }

    if (firstEntryOfPart === -1) continue;
    introRows.push({
      title: part.title,
      level: 1,
      entryIndex: firstEntryOfPart,
      bookIndex: introBookIndex,
    });
    introRows.push(...subsectionRows);
  }

  books.push({ name: INTRODUCTION_BOOK, entries: introEntries });
  // Level 0 — jumpable rather than a bare grouping heading: one book here is
  // exactly one top-level row, so it has an obvious place to open.
  toc.push({
    title: INTRODUCTION_BOOK,
    level: 0,
    entryIndex: 0,
    bookIndex: introBookIndex,
  });
  toc.push(...introRows);

  // --- Hippolytus's text ------------------------------------------------
  const textEntries: ParsedEntry[] = [];
  const textRows: ParsedTocEntry[] = [];
  const textBookIndex = books.length;
  let textChapter = 0;

  for (const part of data.translation) {
    // Empty for Hippolytus's preamble, which stands outside the four parts.
    const label = part.label ? PART_LABELS[part.label] ?? part.label : '';
    let firstEntryOfPart = -1;
    const chapterRows: ParsedTocEntry[] = [];

    for (const chapter of part.chapters) {
      if (chapter.paragraphs.length === 0) continue;
      textChapter++;
      const firstEntry = textEntries.length;
      if (firstEntryOfPart === -1) firstEntryOfPart = firstEntry;

      const citation = label
        ? `${label}, Chapter ${chapter.number}`
        : `Chapter ${chapter.number}`;
      chapter.paragraphs.forEach((text, i) => {
        textEntries.push({
          chapter: textChapter,
          verse: null,
          position_ref: i === 0 ? citation : null,
          heading: i === 0 && chapter.title ? chapter.title : null,
          text,
        });
      });

      chapterRows.push({
        title: chapterRow(chapter),
        // Hippolytus's preamble (chapter 1) stands outside the four parts, so
        // its row sits at the parts' own level rather than under a part that
        // does not exist.
        level: label ? 2 : 1,
        entryIndex: firstEntry,
        bookIndex: textBookIndex,
      });
    }

    if (firstEntryOfPart === -1) continue;
    if (label) {
      textRows.push({
        title: part.name ? `${label}. ${part.name}` : label,
        level: 1,
        entryIndex: firstEntryOfPart,
        bookIndex: textBookIndex,
      });
    }
    textRows.push(...chapterRows);
  }

  books.push({ name: TRANSLATION_BOOK, entries: textEntries });
  toc.push({
    title: `${TRANSLATION_BOOK} (Hippolytus, c. 217)`,
    level: 0,
    entryIndex: 0,
    bookIndex: textBookIndex,
  });
  toc.push(...textRows);

  return {
    suggestedTitle: HIPPOLYTUS_APOSTOLIC_TRADITION_TITLE,
    // 'extra-biblical' is the behavioural type — it keeps this out of the
    // Bible panes' source picker and out of verse-scoped search. The Library
    // files it under category 'patristic', which `type` has no way to express
    // (Josephus and an EPUB are 'extra-biblical' too).
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: 'Hippolytus of Rome, trans. Burton Scott Easton',
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

async function loadBundle(): Promise<BundledApostolicTraditionFile> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) {
    throw new Error(`Could not load the bundled Apostolic Tradition (${res.status}).`);
  }
  const data: BundledApostolicTraditionFile = await res.json();
  if (!data.translation || data.translation.length === 0) {
    throw new Error('Bundled Apostolic Tradition file is empty or malformed.');
  }
  return data;
}

// Returns the new source's id so the caller can open it straight away.
export async function installHippolytusApostolicTradition(
  onProgress: (msg: string) => void,
): Promise<number> {
  onProgress('Loading the bundled Apostolic Tradition…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: HIPPOLYTUS_APOSTOLIC_TRADITION_TITLE,
      type: 'extra-biblical',
      language: 'en',
      license_note: data.metadata.license_note,
      category: 'patristic',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
