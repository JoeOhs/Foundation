import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for the Philadelphia Edition of Luther's
// works — "Works of Martin Luther, with Introductions and Notes" (A. J.
// Holman Company, 1915–1932), in which a team of Lutheran scholars
// translated Luther's major treatises, sermons and catechisms directly from
// the German and Latin. Not routed through importer.ts's sniffer, since the
// bundle's shape is fixed and known (produced by the standalone builder in
// tools/luther/build.mjs). Bundled under public/library/reformation/ and
// installed from local disk, so it never makes a network call.
//
// THREE OF SIX VOLUMES, and they did not arrive the same way. Volumes I and
// II are Project Gutenberg transcriptions (#31604 and #34904). Volume III has
// no Gutenberg edition and never will unless someone makes one: it exists as
// a page scan on the Internet Archive, and its text is recovered from that
// scan's OCR by tools/luther/vol3-normalise.mjs before the shared builder
// sees it. Every title carries its volume number rather than naming the
// edition alone, so the Library never reads as if it holds the complete
// six-volume set — see ROADMAP.md.
//
// VOLUMES IV–VI ARE NOT MISSING BY OVERSIGHT. They are still under US
// copyright: IV and V (1931) until 1 January 2027, VI (1932) until 1 January
// 2028, and Volume V's copyright was actively renewed (CCE R238530). Do not
// add them before those dates. The full findings are in ROADMAP.md.
//
// SPLIT — one source per volume, not one source for both. This is the
// Church Fathers' precedent (37 independently installable volumes) rather
// than Josephus's (four works folded into one atomic install). Neither
// volume is near the size that forced the Talmud's per-Seder split, so the
// split is about shelving rather than bytes: it is how every other
// multi-volume work in this Library is filed, and it is what let Volume III
// land without restructuring I–II — as IV–VI will when they clear copyright.
//
// CATEGORY — 'reformation', deliberately not 'historical' (which stays
// narrative history: Josephus and the martyrology, not treatises, sermons
// and catechisms) and not 'commentary' (reserved for works commenting on the
// Bible, which most of this collection is not). The category is named for
// the movement rather than for Luther so other Reformers can file beside him
// later. `type` stays 'extra-biblical', which is what actually keeps this
// out of the Bible panes' source picker and out of verse-scoped search.
//
// FOOTNOTES — the translators' and editors' numbered notes are excluded from
// entries.text entirely by the builder and logged to
// tools/luther/luther-exclusions.txt, the same standard Josephus and JFB
// hold to. Each work's scholarly *Introduction* is kept: the edition is
// titled "with Introductions and Notes" and the introductions are content,
// read as the work's opening section. The translators' bracketed Scripture
// citations ("[Matt. 16:18]", ~1,370 across the three volumes) are kept too
// — they are cross-references in the reading text, not apparatus. On Volume
// III they are OCR of the printed margin, so only those that resolve to a
// real book and chapter are carried; the rest are dropped and logged.
//
// SIDENOTES — the printed marginal sidenotes are lifted onto entries.heading,
// the nullable column added for JFB's section headings and reused by Foxe,
// rather than being dropped or left inline as bracketed noise mid-column. On
// Volume III these are reconstructed from the scan's page geometry and kept
// only where they read as a topic note; see tools/luther/README.md.
//
// TRANSLATOR ATTRIBUTION — left in the text where the edition puts it, as the
// signature closing each work's introduction ("J. J. SCHINDEL."), not lifted
// into a metadata field. `books` has no column for it, and inventing a
// parallel storage path for something the text already carries is exactly
// what this project's schema rules forbid.

export interface LutherVolumeSpec {
  // Matches the bundle filename written by tools/luther/build.mjs.
  key: string;
  // Volume number, carried into the title because the Library sorts rows
  // within a section by title (compareByTitle, numeric-aware) — the same
  // reason the Church Fathers volumes and the Talmud's Sedarim carry theirs.
  volume: number;
  roman: string;
  year: number;
  // How the volume reached us, which differs across the set and is not
  // cosmetic: it decides what the Library can claim about the text's
  // provenance. Volumes I and II are Gutenberg transcriptions; Volume III is
  // OCR of a page scan, recovered by tools/luther/vol3-normalise.mjs.
  digitisation:
    | { kind: 'gutenberg'; gutenbergId: number }
    | { kind: 'archive'; iaIdentifier: string };
  // The imprint as it stands on this volume's own title page, used in the
  // Library title. It is not the same across the set: Volumes I and II are
  // A. J. Holman Company alone, Volumes III–VI add The Castle Press.
  imprintLabel: string;
  // Luther's own pieces in the volume — used only for the Library blurb, and
  // deliberately not the same as the number of `books` rows: Volume I also
  // carries the edition's general introduction and translators' note as a
  // book of their own, which is front matter rather than a treatise.
  treatises: number;
  hasFrontMatterBook: boolean;
}

export const LUTHER_VOLUMES: LutherVolumeSpec[] = [
  {
    key: 'vol1', volume: 1, roman: 'I', year: 1915,
    digitisation: { kind: 'gutenberg', gutenbergId: 31604 },
    imprintLabel: 'Philadelphia Edition',
    treatises: 8, hasFrontMatterBook: true,
  },
  {
    key: 'vol2', volume: 2, roman: 'II', year: 1916,
    digitisation: { kind: 'gutenberg', gutenbergId: 34904 },
    imprintLabel: 'Philadelphia Edition',
    treatises: 8, hasFrontMatterBook: false,
  },
  {
    key: 'vol3', volume: 3, roman: 'III', year: 1930,
    // Only the scan the text actually came from. The two further scans the
    // builder cross-checks it against are its business, not the app's.
    digitisation: { kind: 'archive', iaIdentifier: 'worksofmartinlut03luth_0' },
    // Named for the imprint on the volume rather than "Philadelphia Edition",
    // which is the name the *Muhlenberg Press* reprint prints on its title
    // page. The Holman & Castle Press original carries no edition name at
    // all; "Philadelphia Edition" is how the set is generally known and is
    // still used for the series, but a volume-level title that claimed it
    // would be attributing the reprint's wording to this printing.
    imprintLabel: 'Holman & Castle Press',
    treatises: 8, hasFrontMatterBook: false,
  },
];

export function lutherTitle(vol: LutherVolumeSpec): string {
  return `Works of Martin Luther, Vol. ${vol.roman} (${vol.imprintLabel}, ${vol.year})`;
}

interface BundledParagraph {
  text: string;
  // The printed marginal sidenote labelling this paragraph, where there is
  // one — null on the great majority.
  heading: string | null;
}

interface BundledSection {
  // Null only for a work whose opening paragraphs precede any heading; the
  // work's own name stands in as the citation in that case.
  title: string | null;
  paragraphs: BundledParagraph[];
}

interface BundledWork {
  name: string;
  sections: BundledSection[];
}

interface BundledLutherFile {
  metadata: {
    build_date: string;
    work: string;
    edition: string;
    publisher: string;
    printed_year: number;
    volume: number;
    volumes_in_edition: number;
    // Present on the Gutenberg volumes only.
    gutenberg_id?: number;
    gutenberg_released?: string;
    // Present on Volume III only — the Internet Archive item its text was
    // recovered from.
    ia_identifier?: string;
    source_site: string;
    license_note: string;
    work_count: number;
    section_count: number;
    paragraph_count: number;
  };
  books: BundledWork[];
}

// Luther's treatises have no Bible book/chapter/verse of their own, so this
// imports freeform and position_ref-anchored, exactly like Josephus, the
// Talmud and the martyrology. A work's section index maps onto
// entries.chapter purely as a *loading* unit: the pane fetches one section's
// paragraphs at a time (getEntries(source, book, chapter)) instead of pulling
// a 550-paragraph treatise into the DOM at once.
//
// Paragraph-per-entry granularity, not section-per-entry: highlights, notes
// and links all need a paragraph-sized selection unit, and a section here can
// run to 233 paragraphs ("A Treatise on Good Works").
function buildParsedSource(data: BundledLutherFile, vol: LutherVolumeSpec): ParsedSource {
  const books: ParsedBook[] = [];
  const toc: ParsedTocEntry[] = [];

  data.books.forEach((work, bookIndex) => {
    const entries: ParsedEntry[] = [];
    const sectionRows: ParsedTocEntry[] = [];

    work.sections.forEach((section, sectionIndex) => {
      if (section.paragraphs.length === 0) return;
      const firstEntryOfSection = entries.length;
      const label = section.title ?? work.name;

      section.paragraphs.forEach((para, i) => {
        entries.push({
          // 1-based so the loading unit reads naturally in a citation and
          // never collides with 0 meaning "unset".
          chapter: sectionIndex + 1,
          verse: null,
          // The citation, on the paragraph that opens each section. Repeating
          // it on every paragraph would just be noise in the reading column,
          // and searchAll already resolves a hit to the nearest preceding
          // labelled entry in the same chapter.
          position_ref: i === 0 ? `${work.name} — ${label}` : null,
          // The printed marginal sidenote, where this paragraph carries one.
          heading: para.heading,
          text: para.text,
        });
      });

      sectionRows.push({ title: label, level: 1, entryIndex: firstEntryOfSection, bookIndex });
    });

    if (entries.length === 0) return;
    // Level 0 — the work. A grouping row (entryIndex -1): it labels its
    // sections without being jumpable itself, the same shape Josephus's
    // "Work" level uses. Unlike Foxe — where three chapters had no named
    // sub-entries and so would have become unreachable dead rows — every
    // work here has at least one section beneath it, so nothing is stranded.
    toc.push({ title: work.name, level: 0, entryIndex: -1, bookIndex });
    toc.push(...sectionRows);
    books.push({ name: work.name, entries });
  });

  return {
    suggestedTitle: lutherTitle(vol),
    // 'extra-biblical' is the behavioural type — it keeps this out of the
    // Bible panes' source picker and out of verse-scoped search. The Library
    // files it under category 'reformation', which `type` has no way to
    // express (an EPUB is 'extra-biblical' too).
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books,
    warnings: [],
    suggestedAuthor: 'Martin Luther (Philadelphia Edition translators)',
    suggestedLanguage: 'en',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
}

async function loadBundle(key: string): Promise<BundledLutherFile> {
  const res = await fetch(`/library/reformation/luther-${key}.json`);
  if (!res.ok) throw new Error(`Could not load the bundled Luther volume (${res.status}).`);
  const data: BundledLutherFile = await res.json();
  if (!data.books || data.books.length === 0) {
    throw new Error(`Bundled Luther file for ${key} is empty or malformed.`);
  }
  return data;
}

// Returns the new source's id so the caller can open it straight away.
// One installer per volume, built from the shared parser above rather than
// copy-pasted per volume.
export function installLutherVolume(
  vol: LutherVolumeSpec,
): (onProgress: (msg: string) => void) => Promise<number> {
  return async (onProgress) => {
    onProgress(`Loading bundled Luther — Volume ${vol.roman}…`);
    const data = await loadBundle(vol.key);
    const parsed = buildParsedSource(data, vol);

    const sourceId = await insertParsedSource(
      parsed,
      {
        title: lutherTitle(vol),
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
  };
}
