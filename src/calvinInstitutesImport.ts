// Dedicated, fixed-schema importer for Calvin's Institutes of the Christian
// Religion, in Henry Beveridge's 1845 translation. Deliberately NOT routed
// through importer.ts's format sniffing: the input is a known bundle produced
// by tools/calvin-institutes/build.mjs.
//
// Source text: CCEL's ThML edition of Beveridge's translation
// (ccel.org/ccel/calvin/institutes). Public domain — Beveridge died in 1863.
// Beveridge was chosen over John Allen's 1813 (Project Gutenberg) and Thomas
// Norton's archaic 1561 because it is the standard 19th-century English
// rendering and the one most commonly cited in English-language Calvin
// scholarship; that broke the "prefer Gutenberg" default deliberately, the
// same way the Talmud took Steinsaltz over the easier-to-source Rodkinson.
//
// LICENCE — one part of CCEL's file is NOT public domain. It carries a modern
// editorial introduction by John Murray (1898–1975) written for a
// 20th-century reprint, which the work-level rights statement does not cover.
// build.mjs removes it and refuses to build if it cannot find it, then
// re-scans the finished bundle for any trace of it. Nothing of it reaches
// this importer; the reasoning is in that script's header.
//
// Reads a bundle shipped inside the app (public/library/reformation/), so
// this makes no network request.
//
// TYPE — 'extra-biblical' in category 'reformation', the same pair as
// Luther's Philadelphia Edition: its own dedicated pane, not verse-keyed, no
// sync group, out of verse-scoped search. It is systematic theology, so it is
// neither 'commentary' (reserved for works commenting on the Bible verse by
// verse — Calvin's own Commentaries are filed there, and this is deliberately
// not folded in with them) nor 'historical' (which stays narrative history).
// That is the reasoning already recorded for Luther, reaching the same answer.
//
// A COMPOUND WORK in the Josephus mould: ONE source with six `books` rows —
// the four Books, plus the prefatory material and the appended Aphorisms —
// under a three-level Book → Chapter → Section table of contents, on the
// existing ParsedTocEntry.bookIndex / grouping-row machinery. No schema
// change.
//
// CITATION. The Institutes is cited Book.Chapter.Section ("1.7.4"), and that
// is what entries.position_ref carries, on the paragraph that OPENS each
// section — sections run to several paragraphs, so repeating the citation on
// every one of them would just be noise in the reading column. Same placement
// the Talmud uses for a daf's citation. entries.chapter holds the chapter's
// ordinal purely as a loading unit, so the pane fetches one chapter at a time
// rather than a whole Book.
//
// THE EDITION'S CHAPTER OUTLINES are kept, not dropped. Each chapter opens
// with one summary line per section ("Sections." followed by the analysis),
// which is how the printed edition reads and is genuinely useful for finding
// your way about a long chapter. They are marked is_apparatus so the pane
// sets them apart from Calvin's prose and labels the run once — the same
// column added for Riley's notes on Ovid. They are the edition's analysis
// rather than Calvin's argument, and the reader should be able to see which
// is which.
//
// Re-running rebuilds the source from scratch rather than duplicating it, and
// deleting the source removes everything below.

import { deleteSource, findSourceByTitle, insertEntryRefs, insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

export const CALVIN_INSTITUTES_TITLE =
  'John Calvin — Institutes of the Christian Religion (tr. Beveridge, 1845)';

const BUNDLE_URL = '/library/reformation/institutes.json';

interface BundleSection {
  // The printed section number; 0 for an unnumbered piece (the prefatory
  // addresses, each Book's ARGUMENT).
  section: number;
  paragraphs: string[];
  // Calvin's Scripture citations: [paragraphIndex, charStart, charEnd, book,
  // chapter, verse]. Absent when the section cites nothing.
  refs?: BundleRef[];
}

type BundleRef = [number, number, number, string, number, number | null];

// The refs belonging to paragraph `index`, in ParsedEntry's shape.
function refsFor(refs: BundleRef[] | undefined, index: number): ParsedEntry['refs'] {
  return (refs ?? [])
    .filter((r) => r[0] === index)
    .map(([, char_start, char_end, book, chapter, verse]) => ({ char_start, char_end, book, chapter, verse }));
}

interface BundleChapter {
  title: string;
  // The printed chapter number, or null for an ARGUMENT or prefatory piece.
  number: number | null;
  // Who wrote it, for the prefatory pieces; null inside the Books.
  attribution: string | null;
  // The edition's per-section outline, one line per section.
  synopsis: string[];
  // Scripture citations in the outline lines, shaped like BundleSection.refs.
  synopsis_refs?: BundleRef[];
  sections: BundleSection[];
}

interface BundleBook {
  name: string;
  // 1–4 for the four Books; null for the prefatory material and Aphorisms,
  // which carry no Book.Chapter.Section citation.
  citation: number | null;
  chapters: BundleChapter[];
}

interface InstitutesBundle {
  metadata: {
    work: string;
    author: string;
    translator: string;
    license_note: string;
    book_count: number;
    chapter_count: number;
    section_count: number;
    paragraph_count: number;
  };
  books: BundleBook[];
}

async function loadBundle(): Promise<InstitutesBundle> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) {
    throw new Error(
      `Could not load the bundled Institutes (${res.status} ${res.statusText}).`,
    );
  }
  const data = (await res.json()) as InstitutesBundle;
  if (!data.books || data.books.length === 0) {
    throw new Error('The bundled Institutes contains no books.');
  }
  return data;
}

// The label shown above a section's opening paragraph. Inside the four Books
// this is the standard scholarly citation; elsewhere it names the piece,
// since "3.2.1" means nothing for a prefatory address.
function sectionLabel(book: BundleBook, chapter: BundleChapter, section: number): string | null {
  if (book.citation !== null && chapter.number !== null && section > 0) {
    return `${book.citation}.${chapter.number}.${section}`;
  }
  if (book.name === 'One Hundred Aphorisms' && section > 0) return `Aphorism ${section}`;
  if (chapter.attribution) return chapter.attribution;
  if (chapter.title.toUpperCase().startsWith('ARGUMENT')) return 'Argument';
  return null;
}

function buildParsedSource(data: InstitutesBundle): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  data.books.forEach((book, bookIndex) => {
    const entries: ParsedEntry[] = [];
    // Level 0 — the Book. A grouping heading: entryIndex -1 means it labels
    // its children without being jumpable itself.
    toc.push({ title: book.name, level: 0, entryIndex: -1, bookIndex });

    book.chapters.forEach((chapter, chapterIndex) => {
      const chapterOrdinal = chapterIndex + 1;
      const firstEntryOfChapter = entries.length;

      // The edition's outline, ahead of the prose, set apart as apparatus and
      // labelled once at the top of the run.
      chapter.synopsis.forEach((line, i) => {
        entries.push({
          chapter: chapterOrdinal,
          verse: null,
          position_ref: null,
          text: line,
          heading: 'Sections',
          isApparatus: true,
          refs: refsFor(chapter.synopsis_refs, i),
        });
      });

      const sectionRows: ParsedTocEntry[] = [];
      for (const section of chapter.sections) {
        section.paragraphs.forEach((text, i) => {
          if (i === 0 && section.section > 0) {
            sectionRows.push({
              title: sectionLabel(book, chapter, section.section) ?? `§ ${section.section}`,
              level: 2,
              entryIndex: entries.length,
              bookIndex,
            });
          }
          entries.push({
            chapter: chapterOrdinal,
            verse: null,
            // On the opening paragraph only — see the header note.
            position_ref: i === 0 ? sectionLabel(book, chapter, section.section) : null,
            text,
            refs: refsFor(section.refs, i),
          });
        });
      }

      if (entries.length === firstEntryOfChapter) return;
      // Level 1 — the chapter, opening at its first entry.
      toc.push({
        title: chapter.title, level: 1, entryIndex: firstEntryOfChapter, bookIndex,
      });
      toc.push(...sectionRows);
    });

    books.push({ name: book.name, entries });
  });

  return {
    suggestedTitle: CALVIN_INSTITUTES_TITLE,
    // Behavioural type: its own pane, never a Bible pane's source, out of
    // verse-scoped search. The Library files it under 'reformation', which
    // `type` has no way to express.
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
export async function installCalvinInstitutes(
  onProgress: (msg: string) => void,
): Promise<number> {
  onProgress('Loading the bundled Institutes…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  // Idempotent rebuild, reusing deleteSource rather than a bespoke clear so
  // "re-install" and "delete" stay on exactly the same cascade.
  const existing = await findSourceByTitle(CALVIN_INSTITUTES_TITLE);
  if (existing) {
    onProgress('Removing the previous copy…');
    await deleteSource(existing.id);
  }

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: CALVIN_INSTITUTES_TITLE,
      type: 'extra-biblical',
      language: 'en',
      license_note: data.metadata.license_note,
      category: 'reformation',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  onProgress('Linking Scripture references…');
  await insertEntryRefs(sourceId, parsed);
  return sourceId;
}
