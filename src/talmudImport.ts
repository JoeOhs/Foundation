import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for the William Davidson Talmud — Rabbi
// Adin Even-Israel Steinsaltz's English translation of the Babylonian Talmud
// (Bavli). Not routed through importer.ts's sniffer, since the bundle's shape
// is fixed and known (produced by the standalone builder in
// tools/talmud/build.mjs). Bundled under public/library/rabbinic/ and
// installed from local disk, so it never makes a network call.
//
// LICENSE — this is the only non-public-domain text in the Library, shipped
// under CC BY-NC 4.0 as a deliberate, signed-off exception. The full
// reasoning lives in tools/talmud/build.mjs's header, and the licence guard
// that enforces it lives there too. What matters here: the note travels with
// the source into sources.license_note, so the Library UI shows the user the
// terms rather than burying them in a comment.
//
// SPLIT — one source per Seder (six), not one source for the whole Talmud.
// Josephus folds four works into a single atomic install because it totals
// 4MB; the Talmud is 43MB across 81,481 paragraphs, and a single blob would
// be ~3.5x the largest bundle the Library ships today (JFB, 12MB). Per-Seder
// keeps the biggest install (Moed, 11.1MB) just inside that established
// ceiling and lets a user take the orders they actually study, the same way
// the Church Fathers ship as 37 independently installable volumes rather than
// one collection. Per-*tractate* was rejected despite being closer to the
// patristic precedent: it would flatten the Seder level out of the table of
// contents, and the Seder -> Tractate -> Daf hierarchy is how the work is
// actually navigated.
//
// TEXT — Steinsaltz's explanatory expansions are interleaved with the literal
// translation, as in the printed Koren edition. Sefaria distinguishes the two
// with <b> markup; build.mjs strips it, because entries.text is plain text
// everywhere in this app and no pane renders markup. That loses the
// literal/expansion distinction — a known limitation, tracked in ROADMAP.md.

// A Seder's identity. `key` matches the bundle filename written by
// tools/talmud/build.mjs; `books` is the tractate count, used only for the
// Library blurb.
interface SederSpec {
  key: string;
  // The Seder's place in the traditional order of the six. Carried into the
  // title because the Library sorts rows within a group by title
  // (compareByTitle), and the six Sedarim have no number of their own —
  // without one they would shelve alphabetically, opening on Kodashim
  // instead of Zeraim. The Church Fathers volumes solve the same problem the
  // same way, with "Vol. N" in the title and a numeric-aware comparison.
  order: number;
  label: string;
  tractates: number;
}

export const TALMUD_SEDARIM: SederSpec[] = [
  { key: 'zeraim', order: 1, label: 'Seder Zeraim (Seeds)', tractates: 1 },
  { key: 'moed', order: 2, label: 'Seder Moed (Appointed Times)', tractates: 11 },
  { key: 'nashim', order: 3, label: 'Seder Nashim (Women)', tractates: 7 },
  { key: 'nezikin', order: 4, label: 'Seder Nezikin (Damages)', tractates: 8 },
  { key: 'kodashim', order: 5, label: 'Seder Kodashim (Holy Things)', tractates: 9 },
  { key: 'tahorot', order: 6, label: 'Seder Tahorot (Purities)', tractates: 1 },
];

export function talmudTitle(seder: SederSpec): string {
  return `Talmud Bavli ${seder.order} — ${seder.label} (William Davidson / Steinsaltz)`;
}

interface BundledDaf {
  // The daf's own citation within its tractate: "2a", "2b", "3a"...
  ref: string;
  paragraphs: string[];
}

interface BundledTractate {
  title: string;
  heTitle: string | null;
  description: string | null;
  dafim: BundledDaf[];
}

interface BundledTalmudFile {
  metadata: {
    build_date: string;
    work: string;
    seder: string;
    seder_key: string;
    translator: string;
    source_site: string;
    license: string;
    license_note: string;
    tractate_count: number;
    daf_count: number;
  };
  tractates: BundledTractate[];
}

// The Talmud's own citation is Tractate + daf/amud ("Berakhot 2a"), which has
// nothing to do with Bible book/chapter/verse — so this imports freeform,
// position_ref-anchored, exactly like Josephus and an EPUB. A tractate's
// dafim map onto entries.chapter purely as a *loading* unit: the pane fetches
// one daf's paragraphs at a time (getEntries(source, book, chapter)) instead
// of all 21,000 of Seder Moed's at once, which is what keeps a work this size
// responsive. The ordinal is used rather than the printed daf number because
// entries.chapter is an integer and "2a"/"2b" are not — the printed citation
// lives in position_ref, which is what the reader actually sees.
function buildParsedSource(data: BundledTalmudFile): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  // Level 0 — the Seder. A grouping heading: entryIndex -1 means it labels
  // its children without being jumpable itself.
  toc.push({ title: data.metadata.seder, level: 0, entryIndex: -1 });

  for (const tractate of data.tractates) {
    const entries: ParsedEntry[] = [];
    const bookIndex = books.length;
    // Level 2 rows are collected separately so the level 1 row can be emitted
    // ahead of them — the dropdown has to read Seder -> Tractate -> Daf in
    // order.
    const dafRows: ParsedTocEntry[] = [];

    tractate.dafim.forEach((daf, dafOrdinal) => {
      if (daf.paragraphs.length === 0) return;
      const firstEntryOfDaf = entries.length;
      daf.paragraphs.forEach((text, i) => {
        entries.push({
          chapter: dafOrdinal + 1,
          verse: null,
          // The citation, on the paragraph that opens each daf. Repeating it
          // on every paragraph would just be noise in the reading column.
          position_ref: i === 0 ? `${tractate.title} ${daf.ref}` : null,
          text,
        });
      });
      dafRows.push({
        title: daf.ref,
        level: 2,
        entryIndex: firstEntryOfDaf,
        bookIndex,
      });
    });

    if (entries.length === 0) continue;
    books.push({ name: tractate.title, entries });
    // Level 1 — the tractate, opening at its first paragraph.
    toc.push({ title: tractate.title, level: 1, entryIndex: 0, bookIndex });
    toc.push(...dafRows);
  }

  return {
    suggestedTitle: data.metadata.work,
    // 'extra-biblical' is the behavioural type — it keeps the Talmud out of
    // the Bible panes' source picker and out of verse-scoped search. The
    // Library files it under category 'rabbinic', which `type` has no way to
    // express (Josephus and an EPUB are 'extra-biblical' too).
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: `trans. ${data.metadata.translator}`,
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

async function loadBundle(sederKey: string): Promise<BundledTalmudFile> {
  const res = await fetch(`/library/rabbinic/talmud-${sederKey}.json`);
  if (!res.ok) {
    throw new Error(`Could not load the bundled Talmud (${sederKey}): ${res.status}.`);
  }
  const data: BundledTalmudFile = await res.json();
  if (!data.tractates || data.tractates.length === 0) {
    throw new Error(`Bundled Talmud file for ${sederKey} is empty or malformed.`);
  }
  return data;
}

// Returns the new source's id so the caller can open it straight away.
// One installer per Seder, built from the shared parser above rather than
// copy-pasted six times.
export function installTalmudSeder(
  seder: SederSpec,
): (onProgress: (msg: string) => void) => Promise<number> {
  return async (onProgress) => {
    onProgress(`Loading bundled Talmud — ${seder.label}…`);
    const data = await loadBundle(seder.key);
    const parsed = buildParsedSource(data);

    const sourceId = await insertParsedSource(
      parsed,
      {
        title: talmudTitle(seder),
        type: 'extra-biblical',
        language: 'en',
        license_note: data.metadata.license_note,
        category: 'rabbinic',
      },
      (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
    );

    onProgress('Building table of contents…');
    await insertTocEntries(sourceId, parsed);
    return sourceId;
  };
}
