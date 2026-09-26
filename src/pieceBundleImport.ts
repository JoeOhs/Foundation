// Shared installer for the "book → piece → paragraph" prose bundles on the
// Reformation shelf: Calvin's Arguments, Prefaces and Dedications
// (tools/calvin-commentaries/build.mjs) and Zwingli's Selected Works
// (tools/zwingli/build.mjs) write the same shape, so they install the same
// way. Each caller keeps its own file for its title, bundle path and the
// reasoning behind its scope; only the mechanics live here.
//
// SHAPE. One source; one `books` row per group in the bundle's order; each
// piece is a chapter, one entry per paragraph, with the piece's title as
// position_ref on its opening paragraph. The table of contents is two
// levels, group → piece, on the existing ParsedTocEntry.bookIndex /
// grouping-row machinery. No schema change.
//
// Reads a bundle shipped inside the app (public/library/), so this makes no
// network request. Re-running rebuilds the source from scratch rather than
// duplicating it, and deleting the source removes everything below.

import { deleteSource, findSourceByTitle, insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry, SourceCategory } from './types';

interface BundlePiece {
  title: string;
  paragraphs: string[];
}

interface PieceBundle {
  metadata: {
    author: string;
    license_note: string;
    piece_count: number;
  };
  books: { name: string; pieces: BundlePiece[] }[];
}

export interface PieceBundleWork {
  title: string;
  bundleUrl: string;
  category: SourceCategory;
  // How the work is named in progress and error messages: "the Calvin prefaces".
  label: string;
}

async function loadBundle(work: PieceBundleWork): Promise<PieceBundle> {
  const res = await fetch(work.bundleUrl);
  if (!res.ok) {
    throw new Error(`Could not load the bundled ${work.label} (${res.status} ${res.statusText}).`);
  }
  const data = (await res.json()) as PieceBundle;
  if (!data.books || data.books.length === 0) {
    throw new Error(`The bundled ${work.label} contain no pieces.`);
  }
  return data;
}

function buildParsedSource(work: PieceBundleWork, data: PieceBundle): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  data.books.forEach((book, bookIndex) => {
    const entries: ParsedEntry[] = [];
    // Level 0 — the group, a grouping heading only.
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
    suggestedTitle: work.title,
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
export async function installPieceBundle(
  work: PieceBundleWork,
  onProgress: (msg: string) => void,
): Promise<number> {
  onProgress(`Loading the bundled ${work.label}…`);
  const data = await loadBundle(work);
  const parsed = buildParsedSource(work, data);

  // Idempotent rebuild on the same cascade "delete" uses.
  const existing = await findSourceByTitle(work.title);
  if (existing) {
    onProgress('Removing the previous copy…');
    await deleteSource(existing.id);
  }

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: work.title,
      type: 'extra-biblical',
      language: 'en',
      license_note: data.metadata.license_note,
      category: work.category,
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
