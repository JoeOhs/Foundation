// Dedicated, fixed-schema importer for the prayers that close Calvin's
// lectures on the Prophets. Deliberately NOT routed through importer.ts's
// format sniffing: the input is a known bundle produced by
// tools/calvin-commentaries/build.mjs, from the same CTS translation the
// verse commentaries use.
//
// A PANE THAT FOLLOWS THE READING. Each prayer closed a lecture on a known
// passage, so the work is verse-keyed like the Companion Bible's notes: one
// `books` row per prophet, each prayer filed in the chapter its lecture
// opened in. It navigates by book and chapter, so it is picked in a Bible
// pane's source list and follows that pane's sync group — reading Jeremiah 5
// shows the four prayers from the lectures on Jeremiah 5. A chapter with no lecture of its own (a lecture can span two)
// shows the pane's usual "no content" line.
//
// A prayer carries no verse of its own — it answers a whole lecture, not one
// verse — so its entry's verse is null and position_ref holds its label
// ("Lecture 19 · Jeremiah 5:4–9"); the pane draws such an entry as a labelled
// block, the way it draws the Companion Bible's introductory notes.
//
// TYPE 'commentary' (read in a pane, verse-keyed) in category 'reformation',
// shelved with Calvin's other works rather than among the Bible commentaries:
// these are prayers, not exposition.
//
// Reads a bundle shipped inside the app (public/library/reformation/), so
// this makes no network request. Re-running rebuilds the source from scratch,
// and deleting the source removes everything below.

import { deleteSource, findSourceByTitle, insertParsedSource } from './db';
import type { ParsedBook, ParsedSource } from './types';

export const CALVIN_PRAYERS_TITLE =
  'John Calvin — Prayers from the Lectures on the Prophets';

const BUNDLE_URL = '/library/reformation/calvin-prayers.json';

interface PrayersBundle {
  metadata: {
    author: string;
    license_note: string;
    prayer_count: number;
  };
  books: { name: string; prayers: { chapter: number; label: string; text: string }[] }[];
}

async function loadBundle(): Promise<PrayersBundle> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) {
    throw new Error(`Could not load the bundled Calvin prayers (${res.status} ${res.statusText}).`);
  }
  const data = (await res.json()) as PrayersBundle;
  if (!data.books || data.books.length === 0) {
    throw new Error('The bundled Calvin prayers contain no books.');
  }
  return data;
}

function buildParsedSource(data: PrayersBundle): ParsedSource {
  const books: ParsedBook[] = data.books.map((book) => ({
    name: book.name,
    entries: book.prayers.map((p) => ({
      chapter: p.chapter,
      verse: null,
      position_ref: p.label,
      text: p.text,
    })),
  }));
  return {
    suggestedTitle: CALVIN_PRAYERS_TITLE,
    suggestedType: 'commentary',
    structure: 'verse-keyed',
    books,
    warnings: [],
    suggestedAuthor: data.metadata.author,
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
  };
}

// Returns the new source's id so the caller can open it straight away.
export async function installCalvinPrayers(
  onProgress: (msg: string) => void,
): Promise<number> {
  onProgress('Loading the bundled Calvin prayers…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  // Idempotent rebuild on the same cascade "delete" uses.
  const existing = await findSourceByTitle(CALVIN_PRAYERS_TITLE);
  if (existing) {
    onProgress('Removing the previous copy…');
    await deleteSource(existing.id);
  }

  return insertParsedSource(
    parsed,
    {
      title: CALVIN_PRAYERS_TITLE,
      type: 'commentary',
      language: 'en',
      license_note: data.metadata.license_note,
      category: 'reformation',
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );
}
