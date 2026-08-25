import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for the Jerusalem Talmud (Talmud
// Yerushalmi) in Heinrich W. Guggenheimer's English translation. Not routed
// through importer.ts's sniffer, since the bundle's shape is fixed and known
// (produced by the standalone builder in tools/yerushalmi/build.mjs). Bundled
// under public/library/rabbinic/ and installed from local disk, so it never
// makes a network call.
//
// Prior art: src/talmudImport.ts, which does the same job for the Bavli
// (commit 0c55e0d). The compound-work shape — one source, one books row per
// tractate, freeform entries anchored by position_ref, a 3-level
// toc_entries hierarchy — is that importer's, reused rather than reinvented.
//
// LICENSE — Guggenheimer's translation is CC-BY: attribution only, with no
// non-commercial restriction. That makes it *looser* than the Bavli's CC
// BY-NC 4.0, so this is not a second instance of that signed-off exception —
// only the Bavli carries the non-commercial condition. The full reasoning,
// and the guard that enforces the licence at build time, live in
// tools/yerushalmi/build.mjs's header. What matters here: the note travels
// with the source into sources.license_note, so the Library UI shows the user
// the terms rather than burying them in a comment.
//
// SPLIT — one source for the whole work, where the Bavli takes six (one per
// Seder). The Bavli splits because it is 43MB, and one blob would be ~3.5x
// the largest bundle the Library ships (JFB, 12MB). The Yerushalmi is a
// different size of problem: 11.0MB across 12,243 paragraphs, which is one
// install *inside* that established ceiling. Splitting it per Seder anyway
// would produce a Seder Tahorot install of a single tractate (Niddah, 98
// paragraphs, ~90KB) — a Library row that costs more to explain than it
// saves to skip. So the Seder survives as the top level of the table of
// contents rather than as an install boundary.
//
// ADDRESSING — the Yerushalmi is cited chapter:halakhah ("Berakhot 1:1"),
// not by daf/amud. Its Sefaria text array is three levels deep (Chapter ->
// Halakhah -> Segment) against the Bavli's two, and is plainly 1-indexed
// with none of the notional-daf-1 offset dafLabel() has to correct for.
//
// TEXT — Guggenheimer's edition is a translation *and commentary*, and
// Sefaria splices the commentary into the middle of the translated sentence
// as footnotes. build.mjs strips them; inlining them would weld a note into
// the sentence it interrupts, which is the same note-leak that had to be
// repaired out of entries.text once already (the {braces} repair in
// src/seed.ts). That drops roughly a third of the shipped characters — a
// real loss, tracked as a known limitation in ROADMAP.md.

// A Seder's identity within the bundle. Mirrors the builder's SEDARIM.
interface BundledSeder {
  key: string;
  label: string;
  tractates: BundledTractate[];
}

interface BundledHalakhah {
  // The halakhah's own citation within its tractate: "1:1", "1:2", "2:1"...
  ref: string;
  paragraphs: string[];
}

interface BundledTractate {
  title: string;
  heTitle: string | null;
  halakhot: BundledHalakhah[];
}

interface BundledYerushalmiFile {
  metadata: {
    build_date: string;
    work: string;
    translator: string;
    publisher: string;
    source_site: string;
    source_export: string;
    license: string;
    version_title: string;
    license_note: string;
    seder_count: number;
    tractate_count: number;
    halakhah_count: number;
  };
  sedarim: BundledSeder[];
}

export const YERUSHALMI_TITLE =
  'Talmud Yerushalmi — The Jerusalem Talmud (Guggenheimer)';

// The Yerushalmi's own citation is Tractate + chapter:halakhah ("Berakhot
// 1:1"), which has nothing to do with Bible book/chapter/verse — so this
// imports freeform, position_ref-anchored, exactly like the Bavli, Josephus
// and an EPUB. A tractate's halakhot map onto entries.chapter purely as a
// *loading* unit: the pane fetches one halakhah's paragraphs at a time
// (getEntries(source, book, chapter)) instead of a whole tractate's at once.
// The ordinal is used rather than the printed citation because entries.chapter
// is an integer and "1:1" is not — the printed citation lives in
// position_ref, which is what the reader actually sees.
function buildParsedSource(data: BundledYerushalmiFile): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  for (const seder of data.sedarim) {
    // Level 0 — the Seder. A grouping heading: entryIndex -1 means it labels
    // its children without being jumpable itself. The Bavli emits one of
    // these per source because each source *is* a Seder; here all five sit in
    // one source, so the level-0 row is what keeps the orders apart in the
    // dropdown.
    toc.push({ title: seder.label, level: 0, entryIndex: -1 });

    for (const tractate of seder.tractates) {
      const entries: ParsedEntry[] = [];
      const bookIndex = books.length;
      // Level 2 rows are collected separately so the level 1 row can be
      // emitted ahead of them — the dropdown has to read Seder -> Tractate ->
      // Halakhah in order.
      const halakhahRows: ParsedTocEntry[] = [];

      tractate.halakhot.forEach((halakhah, ordinal) => {
        if (halakhah.paragraphs.length === 0) return;
        const firstEntryOfHalakhah = entries.length;
        halakhah.paragraphs.forEach((text, i) => {
          entries.push({
            chapter: ordinal + 1,
            verse: null,
            // The citation, on the paragraph that opens each halakhah.
            // Repeating it on every paragraph would just be noise in the
            // reading column.
            position_ref: i === 0 ? `${tractate.title} ${halakhah.ref}` : null,
            text,
          });
        });
        halakhahRows.push({
          title: halakhah.ref,
          level: 2,
          entryIndex: firstEntryOfHalakhah,
          bookIndex,
        });
      });

      if (entries.length === 0) continue;
      books.push({ name: tractate.title, entries });
      // Level 1 — the tractate, opening at its first paragraph.
      toc.push({ title: tractate.title, level: 1, entryIndex: 0, bookIndex });
      toc.push(...halakhahRows);
    }
  }

  return {
    suggestedTitle: data.metadata.work,
    // 'extra-biblical' is the behavioural type — it keeps the Talmud out of
    // the Bible panes' source picker and out of verse-scoped search. The
    // Library files it under category 'rabbinic', which `type` has no way to
    // express (the Bavli, Josephus and an EPUB are 'extra-biblical' too).
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

async function loadBundle(): Promise<BundledYerushalmiFile> {
  const res = await fetch('/library/rabbinic/yerushalmi.json');
  if (!res.ok) {
    throw new Error(`Could not load the bundled Jerusalem Talmud: ${res.status}.`);
  }
  const data: BundledYerushalmiFile = await res.json();
  if (!data.sedarim || data.sedarim.length === 0) {
    throw new Error('Bundled Jerusalem Talmud file is empty or malformed.');
  }
  return data;
}

// Returns the new source's id so the caller can open it straight away.
export async function installYerushalmi(
  onProgress: (msg: string) => void,
): Promise<number> {
  onProgress('Loading the bundled Jerusalem Talmud…');
  const data = await loadBundle();
  const parsed = buildParsedSource(data);

  const sourceId = await insertParsedSource(
    parsed,
    {
      title: YERUSHALMI_TITLE,
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
}
