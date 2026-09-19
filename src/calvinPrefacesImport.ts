// Dedicated, fixed-schema importer for the Arguments, Prefaces and Epistles
// Dedicatory Calvin wrote for his Commentaries. Deliberately NOT routed
// through importer.ts's format sniffing: the input is a known bundle produced
// by tools/calvin-commentaries/build.mjs, from the same CTS translation the
// verse commentaries use.
//
// WHY A SEPARATE WORK. These pieces introduce a whole biblical book (or
// dedicate a volume to a patron) and anchor to no verse, so the verse-keyed
// commentary sources that feed the study footer have nowhere to put them.
// They are read as prose instead, on the Reformation shelf beside the
// Institutes, with the same type and category pairing ('extra-biblical' in
// 'reformation') and the same reasoning recorded there.
//
// SHAPE. One source; one `books` row per commentary group (Genesis, Isaiah,
// Corinthians…), in the order the commentaries shelve; each piece is a
// chapter, one entry per paragraph, with the piece's title as position_ref on
// its opening paragraph. The table of contents is two levels, group → piece,
// on the existing ParsedTocEntry.bookIndex / grouping-row machinery. No
// schema change.
//
// LICENCE. Only Calvin's own pieces are in the bundle, each chosen by name in
// build.mjs's FRONT_MATTER list; the dedications written by his translators,
// printers and editors are not. The reasoning is in that script.
//
// Reads a bundle shipped inside the app (public/library/reformation/), so
// this makes no network request.
//
// Re-running rebuilds the source from scratch rather than duplicating it, and
// deleting the source removes everything below.

import { deleteSource, findSourceByTitle, insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

export const CALVIN_PREFACES_TITLE =
  'John Calvin — Arguments, Prefaces and Dedications to the Commentaries';

const BUNDLE_URL = '/library/reformation/calvin-prefaces.json';

interface BundlePiece {
  title: string;
  paragraphs: string[];
}

interface PrefacesBundle {
  metadata: {
    author: string;
    license_note: string;
    piece_count: number;
  };
  books: { name: string; pieces: BundlePiece[] }[];
}

async function loadBundle(): Promise<PrefacesBundle> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) {
    throw new Error(
      `Could not load the bundled Calvin prefaces (${res.status} ${res.statusText}).`,
    );
  }
  const data = (await res.json()) as PrefacesBundle;
  if (!data.books || data.books.length === 0) {
    throw new Error('The bundled Calvin prefaces contain no pieces.');
  }
  return data;
}

function buildParsedSource(data: PrefacesBundle): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  data.books.forEach((book, bookIndex) => {
    const entries: ParsedEntry[] = [];
    // Level 0 — the commentary group, a grouping heading only.
    toc.push({ title: book.name, level: 0, entryIndex: -1, bookIndex });
    book.pieces.forEach((piece, pieceIndex) => {
      // Level 1 — the piece, opening at its first paragraph.
      toc.push({ title: piece.title, level: 1, entryIndex: entries.length, bookIndex });
      piece.paragraphs.forEach((text, i) => {
        entries.push({
          // The piece's ordinal, purely as a loading unit: the pane fetches
          // one piece at a time.
          chapter: pieceIndex + 1,
          verse: null,
          position_ref: i === 0 ? piece.title : null,
          text,
        });
      });
    });
    books.push({ name: book.name, entries });
  });

  return {
    suggestedTitle: CALVIN_PREFACES_TITLE,
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
export async function installCalvinPrefaces(
  onProgress: (msg: string) => void,
): Promise<number> {
  onProgress('Loading the bundled Calvin prefaces…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  // Idempotent rebuild on the same cascade "delete" uses.
  const existing = await findSourceByTitle(CALVIN_PREFACES_TITLE);
  if (existing) {
    onProgress('Removing the previous copy…');
    await deleteSource(existing.id);
  }

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: CALVIN_PREFACES_TITLE,
      type: 'extra-biblical',
      language: 'en',
      license_note: data.metadata.license_note,
      category: 'reformation',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
