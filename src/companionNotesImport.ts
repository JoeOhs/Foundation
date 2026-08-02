// Dedicated, fixed-schema importer for the Companion Bible's verse-keyed
// side-notes. Deliberately NOT routed through importer.ts's format sniffing:
// the input is a known bundle produced by companion-bible-notes/build.mjs.
//
// Source text: The Companion Bible — the Authorized Version of 1611 with
// the structures and critical, explanatory and suggestive notes, by
// E. W. Bullinger (1913). Public domain: Bullinger died in 1913, so the work
// is out of copyright in every jurisdiction this app is used in. The
// Structure diagram is hand-transcribed from page scans of the 1913 edition
// held at the Internet Archive (archive.org item `companionbibleau0000unse`).
//
// Reads a bundle shipped inside the app (public/library/), so this makes no
// network request.
//
// Installs whichever books the bundle contains as ONE source — one `books`
// row each — so the work grows a book at a time without changing anything
// here. Re-running rebuilds the source from scratch rather than duplicating
// it, and deleting the source removes everything below.

import {
  deleteSource, findSourceByTitle, getEntries, getMeta, setMeta,
  insertParsedSource, insertStructureDiagram, insertStructureGroups, insertStructureLines,
} from './db';
import type { ParsedEntry, ParsedSource } from './types';

export const COMPANION_NOTES_TITLE = 'The Companion Bible — E.W. Bullinger (Notes)';

const BUNDLE_URL = '/library/companion-bible-notes.json';

const LICENSE_NOTE =
  'Public domain. The Companion Bible (1913) by E. W. Bullinger, who died in 1913. ' +
  'Structure diagram hand-transcribed from page scans of the 1913 edition held at the ' +
  'Internet Archive (item companionbibleau0000unse).';

interface BundleLine {
  idx: number;
  parent: number | null;
  depth: number;
  label: string;
  ref_range: string | null;
  text: string | null;
}

interface BundleDiagram {
  title: string;
  anchor_book: string;
  anchor_chapter: number;
  anchor_verse_start: number | null;
  anchor_verse_end: number | null;
  reference_pdf_path: string | null;
  reference_pdf_page: number | null;
  lines: BundleLine[];
  groups: { label: string; members: number[] }[];
}

interface BundleBook {
  book: string;
  diagrams: BundleDiagram[];
  // verse null = a book-level introductory note, printed before the text
  prose: { verse: number | null; text: string }[];
  // the page's own heading over those introductory notes
  prose_heading?: string | null;
}

interface Bundle {
  books: BundleBook[];
}

async function loadBundle(): Promise<Bundle> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) {
    throw new Error(`Could not load the bundled Companion Bible notes (${res.status} ${res.statusText}).`);
  }
  const data = (await res.json()) as Bundle;
  if (!data.books || data.books.length === 0) {
    throw new Error('The bundled Companion Bible notes contain no books.');
  }
  return data;
}

// Entries are laid out diagram-lines-first, then prose, so a Structure reads
// at the head of the chapter exactly as it does on the page. Bracket lines
// carry no text and so get no entry at all — their index stays null.
//
// Each Bible book becomes its own `books` row. lineEntryIndex is therefore
// indexed [bookIndex][diagramIndex][lineIndex], and the entry positions
// within it are relative to that book's own entry list, since the ids are
// requeried per book.
function buildParsedSource(bundle: Bundle): {
  parsed: ParsedSource;
  lineEntryIndex: (number | null)[][][];
} {
  const parsedBooks: ParsedSource['books'] = [];
  const lineEntryIndex: (number | null)[][][] = [];

  for (const b of bundle.books) {
    const entries: ParsedEntry[] = [];
    const perBook: (number | null)[][] = [];

    for (const d of b.diagrams) {
      const perLine: (number | null)[] = [];
      for (const line of d.lines) {
        if (line.text === null) {
          perLine.push(null);
          continue;
        }
        perLine.push(entries.length);
        entries.push({
          chapter: d.anchor_chapter,
          // No verse: an outline line spans a range ("18, 19-"), which
          // position_ref carries verbatim. Keeping verse null also stops
          // these rows colliding with the prose notes' verse numbering.
          verse: null,
          position_ref: line.ref_range,
          text: line.text,
        });
      }
      perBook.push(perLine);
    }

    // Book-level introductory notes carry no verse. Only the first is
    // labelled — the heading belongs to the run as a whole, and repeating it
    // above every paragraph just reads as noise.
    let introLabelled = false;
    for (const note of b.prose) {
      let positionRef: string | null = null;
      if (note.verse === null && !introLabelled) {
        positionRef = b.prose_heading ? `Introduction · ${b.prose_heading}` : 'Introduction';
        introLabelled = true;
      }
      entries.push({
        chapter: b.diagrams[0]?.anchor_chapter ?? 1,
        verse: note.verse,
        position_ref: positionRef,
        text: note.text,
      });
    }

    parsedBooks.push({ name: b.book, entries });
    lineEntryIndex.push(perBook);
  }

  const parsed: ParsedSource = {
    suggestedTitle: COMPANION_NOTES_TITLE,
    // 'commentary', matching the Appendixes import — these are Bullinger's
    // notes on the text, not a lookup-style reference work.
    suggestedType: 'commentary',
    // Verse-keyed, so it reads alongside a translation in a normal pane and
    // can join a sync group, rather than becoming a dedicated solo pane.
    structure: 'verse-keyed',
    books: parsedBooks,
    warnings: [],
    suggestedAuthor: 'E.W. Bullinger',
    suggestedLanguage: 'English',
    suggestedLicenseNote: LICENSE_NOTE,
  };
  return { parsed, lineEntryIndex };
}

// The Philemon proof-of-concept shipped under its own title. Now that the
// notes install as one growing source, a database still holding that old
// source would be stranded: it no longer matches a Library entry, so it
// couldn't be reinstalled or deleted from the UI, while still showing up in
// every pane's source picker. Retire it once, on boot.
const RETIRED_TEST_TITLE = 'The Companion Bible — E.W. Bullinger (Philemon test)';
const RETIRE_FLAG = 'companion-notes-philemon-test-retired';

export async function retireCompanionNotesTestSource(): Promise<boolean> {
  if ((await getMeta(RETIRE_FLAG)) !== null) return false;
  const stale = await findSourceByTitle(RETIRED_TEST_TITLE);
  // deleteSource takes its highlights/links/notes and structure rows with it.
  if (stale) await deleteSource(stale.id);
  await setMeta(RETIRE_FLAG, new Date().toISOString());
  return stale !== null;
}

export async function installCompanionNotes(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled Companion Bible notes…');
  const bundle = await loadBundle();
  const { parsed, lineEntryIndex } = buildParsedSource(bundle);

  // Idempotent rebuild. Reusing deleteSource rather than a bespoke clear
  // keeps "re-install" and "delete" on exactly the same cascade, so the two
  // can't drift apart.
  const existing = await findSourceByTitle(COMPANION_NOTES_TITLE);
  if (existing) {
    onProgress('Removing the previous copy…');
    await deleteSource(existing.id);
  }

  const sourceId = await insertParsedSource(
    parsed,
    { title: COMPANION_NOTES_TITLE, type: 'commentary', language: 'en', license_note: LICENSE_NOTE, category: 'commentary' },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  try {
    onProgress('Building structure diagrams…');
    for (let bi = 0; bi < bundle.books.length; bi++) {
      const b = bundle.books[bi];
      // Requery per book to turn entry positions into real ids, rather than
      // threading them out of insertParsedSource — same approach as
      // insertTocEntries.
      const inserted = await getEntries(sourceId, b.book, null);
      for (let di = 0; di < b.diagrams.length; di++) {
        const d = b.diagrams[di];
        const diagramId = await insertStructureDiagram(sourceId, {
          title: d.title,
          anchor_book: d.anchor_book,
          anchor_chapter: d.anchor_chapter,
          anchor_verse_start: d.anchor_verse_start,
          anchor_verse_end: d.anchor_verse_end,
          reference_pdf_path: d.reference_pdf_path,
          reference_pdf_page: d.reference_pdf_page,
        });
        const lineIds = await insertStructureLines(
          diagramId,
          d.lines.map((line) => {
            const entryIdx = lineEntryIndex[bi][di][line.idx];
            return {
              entryId: entryIdx === null ? null : inserted[entryIdx]?.id ?? null,
              parentIndex: line.parent,
              depth: line.depth,
              label: line.label || null,
              refRange: line.ref_range,
            };
          }),
        );
        await insertStructureGroups(
          diagramId,
          d.groups.map((g) => ({ label: g.label, memberLineIds: g.members.map((m) => lineIds[m]) })),
        );
      }
    }
  } catch (err) {
    // Never leave a source installed with half its diagrams: roll the whole
    // thing back so a retry starts clean.
    await deleteSource(sourceId).catch(() => {});
    throw err;
  }

  return sourceId;
}
