// Installs the bundled Smith's Bible Dictionary (built by
// smiths-dictionary/build.mjs from the public-domain CrossWire "Smith"
// module — see that script for provenance and why the archive.org OCR
// scans were rejected).
//
// The dictionary maps onto the standard sources → books → entries model:
// one 'dictionary'-category source, one book per initial letter, one entry
// per article with the headword in position_ref. Lookup is a position_ref
// prefix query (dictionaryLookup in db.ts); the study footer is the default
// home and renders the results itself. A per-letter TOC is written as well,
// but only the optional pane view ("Open as a pane" in the footer) uses it.

import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedSource, ParsedTocEntry } from './types';

export const SMITHS_TITLE = "Smith's Bible Dictionary (1884)";

const BUNDLE_URL = '/library/smiths.json';

interface BundledEntry { word: string; text: string }
interface BundledLetter { letter: string; entries: BundledEntry[] }
interface BundledSmithsFile {
  metadata: { title: string; license_note: string; source_url: string };
  letters: BundledLetter[];
}

async function loadBundle(): Promise<BundledSmithsFile> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Couldn't load the bundled dictionary (HTTP ${res.status})`);
  const data = (await res.json()) as BundledSmithsFile;
  if (!Array.isArray(data.letters) || data.letters.length === 0) {
    throw new Error('The bundled dictionary file is empty or malformed.');
  }
  return data;
}

function buildParsedSource(data: BundledSmithsFile): ParsedSource {
  const books: ParsedBook[] = data.letters.map((l) => ({
    name: l.letter,
    entries: l.entries.map((e) => ({
      chapter: 1,
      verse: null,
      position_ref: e.word,
      text: e.text,
    })),
  }));
  // One TOC row per letter, pointing at that letter's first article — only
  // used when the dictionary is promoted into a pane ("Open as a pane"),
  // where the TOC dropdown is the letter navigation; the footer has its own
  // A–Z grid and never reads this.
  const toc: ParsedTocEntry[] = books.map((b, bookIndex) => ({
    title: b.name,
    level: 0,
    entryIndex: 0,
    bookIndex,
  }));
  return {
    toc,
    suggestedTitle: SMITHS_TITLE,
    suggestedType: 'reference',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: 'Dr. William Smith',
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
  };
}

export async function installSmiths(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled dictionary…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);
  const sourceId = await insertParsedSource(parsed, {
    title: SMITHS_TITLE,
    type: 'reference',
    language: 'en',
    license_note: data.metadata.license_note,
    category: 'dictionary',
  }, (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`));
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
