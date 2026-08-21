// Dedicated, fixed-schema importer for the Jamieson, Fausset & Brown
// commentary. Deliberately NOT routed through importer.ts's format sniffing:
// the input is a known bundle produced by jfb/build.mjs.
//
// Source text: Robert Jamieson, A. R. Fausset and David Brown, Commentary
// Critical and Explanatory on the Whole Bible (1871), from the CrossWire
// Bible Society's OSIS edition (DistributionLicense: Public Domain, itself
// derived from CCEL's transcription). All three authors died over a century
// ago. See jfb/build.mjs for provenance, the licence check it enforces, and
// what the build excludes.
//
// Reads a bundle shipped inside the app (public/library/), so this makes no
// network request.
//
// Maps onto the standard sources → books → entries model with no tables of
// its own, the same way Smith's Dictionary does: one 'footer-commentary'
// source, one book per Bible book, one entry per comment block. A comment
// covering a verse range is ONE row — entries.verse holds the first verse it
// covers and entries.position_ref the whole covered range ("5-6"), in the
// notation versesInRefRange() already parses for the Companion Bible's
// Structure lines. The footer builds its verse → comments index from those
// two columns once per chapter.
//
// Re-running rebuilds the source from scratch rather than duplicating it,
// and deleting the source removes everything below.

import { deleteSource, findSourceByTitle, insertParsedSource } from './db';
import type { ParsedBook, ParsedSource } from './types';

export const JFB_TITLE = 'Jamieson, Fausset & Brown Commentary (1871)';

const BUNDLE_URL = '/library/commentaries/jfb.json';

interface BundleComment {
  chapter: number;
  // first verse covered — entries.verse, and what the strip sorts on
  verse: number;
  // every verse covered, as a range string ("12", "5-6", "4-23")
  verses: string;
  heading: string | null;
  text: string;
}

interface BundleBook {
  book: string;
  comments: BundleComment[];
}

interface Bundle {
  metadata: { title: string; author: string; license_note: string; comment_count: number };
  books: BundleBook[];
}

async function loadBundle(): Promise<Bundle> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) {
    throw new Error(`Could not load the bundled JFB commentary (${res.status} ${res.statusText}).`);
  }
  const data = (await res.json()) as Bundle;
  if (!data.books || data.books.length === 0) {
    throw new Error('The bundled JFB commentary contains no books.');
  }
  return data;
}

function buildParsedSource(bundle: Bundle): ParsedSource {
  const books: ParsedBook[] = bundle.books.map((b) => ({
    name: b.book,
    entries: b.comments.map((c) => ({
      chapter: c.chapter,
      verse: c.verse,
      position_ref: c.verses,
      text: c.text,
      heading: c.heading,
    })),
  }));
  return {
    suggestedTitle: JFB_TITLE,
    suggestedType: 'footer-commentary',
    // Verse-keyed, so it follows a book/chapter reference. Unlike the
    // Companion Bible's notes it never becomes a pane — sourceRoles'
    // isFooterOnly keeps it out of every pane's source picker.
    structure: 'verse-keyed',
    books,
    warnings: [],
    suggestedAuthor: bundle.metadata.author,
    suggestedLanguage: 'en',
    suggestedLicenseNote: bundle.metadata.license_note,
  };
}

export async function installJfb(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled JFB commentary…');
  const bundle = await loadBundle();
  const parsed = buildParsedSource(bundle);

  // Idempotent rebuild, reusing deleteSource rather than a bespoke clear so
  // "re-install" and "delete" stay on exactly the same cascade.
  const existing = await findSourceByTitle(JFB_TITLE);
  if (existing) {
    onProgress('Removing the previous copy…');
    await deleteSource(existing.id);
  }

  return insertParsedSource(
    parsed,
    {
      title: JFB_TITLE,
      type: 'footer-commentary',
      language: 'en',
      license_note: bundle.metadata.license_note,
      category: 'commentary',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );
}
