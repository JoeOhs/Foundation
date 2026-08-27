import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { insertParsedSource } from './db';
import {
  bibleJsonToParsedSource, scrollmapperJsonToParsedSource,
  type BibleJsonBook, type ScrollmapperJson,
} from './bibleJsonFormat';
import { COMPANION_APPENDIX_TITLE, installCompanionAppendixes } from './companionAppendixImport';
import { COMPANION_NOTES_TITLE, installCompanionNotes } from './companionNotesImport';
import { ANF01_TITLE, installANF01 } from './anf01Import';
import { ANF02_TITLE, installANF02 } from './anf02Import';
import { ANF03_TITLE, installANF03 } from './anf03Import';
import { ANF04_TITLE, installANF04 } from './anf04Import';
import { ANF05_TITLE, installANF05 } from './anf05Import';
import { ANF06_TITLE, installANF06 } from './anf06Import';
import { ANF07_TITLE, installANF07 } from './anf07Import';
import { ANF08_TITLE, installANF08 } from './anf08Import';
import { ANF09_TITLE, installANF09 } from './anf09Import';
import { JOSEPHUS_TITLE, installJosephus } from './josephusImport';
import { FOXE_TITLE, installFoxe } from './foxeImport';
import { NPNF101_TITLE, installNPNF101 } from './npnf101Import';
import { NPNF102_TITLE, installNPNF102 } from './npnf102Import';
import { NPNF103_TITLE, installNPNF103 } from './npnf103Import';
import { NPNF104_TITLE, installNPNF104 } from './npnf104Import';
import { NPNF105_TITLE, installNPNF105 } from './npnf105Import';
import { NPNF106_TITLE, installNPNF106 } from './npnf106Import';
import { NPNF107_TITLE, installNPNF107 } from './npnf107Import';
import { NPNF108_TITLE, installNPNF108 } from './npnf108Import';
import { NPNF109_TITLE, installNPNF109 } from './npnf109Import';
import { NPNF110_TITLE, installNPNF110 } from './npnf110Import';
import { NPNF111_TITLE, installNPNF111 } from './npnf111Import';
import { NPNF112_TITLE, installNPNF112 } from './npnf112Import';
import { NPNF113_TITLE, installNPNF113 } from './npnf113Import';
import { NPNF114_TITLE, installNPNF114 } from './npnf114Import';
import { NPNF201_TITLE, installNPNF201 } from './npnf201Import';
import { NPNF202_TITLE, installNPNF202 } from './npnf202Import';
import { NPNF203_TITLE, installNPNF203 } from './npnf203Import';
import { NPNF204_TITLE, installNPNF204 } from './npnf204Import';
import { NPNF205_TITLE, installNPNF205 } from './npnf205Import';
import { NPNF206_TITLE, installNPNF206 } from './npnf206Import';
import { NPNF207_TITLE, installNPNF207 } from './npnf207Import';
import { NPNF208_TITLE, installNPNF208 } from './npnf208Import';
import { NPNF209_TITLE, installNPNF209 } from './npnf209Import';
import { NPNF210_TITLE, installNPNF210 } from './npnf210Import';
import { NPNF211_TITLE, installNPNF211 } from './npnf211Import';
import { NPNF212_TITLE, installNPNF212 } from './npnf212Import';
import { NPNF213_TITLE, installNPNF213 } from './npnf213Import';
import { NPNF214_TITLE, installNPNF214 } from './npnf214Import';
import { SMITHS_TITLE, installSmiths } from './smithsImport';
import { JFB_TITLE, installJfb } from './jfbImport';
import { TALMUD_SEDARIM, installTalmudSeder, talmudTitle } from './talmudImport';
import { YERUSHALMI_TITLE, installYerushalmi } from './yerushalmiImport';
import { importKjvStrongs } from './strongsImport';
import type { ParsedSource, Source, SourceCategory, SourceType } from './types';

export interface LibraryEntry {
  id: string;
  title: string;
  // ISO 639-1 code, matching sources.language — see src/language.ts.
  language: string;
  type: SourceType;
  // Library section this entry files under. Every manifest entry is a Bible
  // translation today, but the field is explicit so a future non-Bible
  // download doesn't silently inherit the wrong section.
  category: SourceCategory;
  license: string;
  // Human-readable note on why this text is safe to redistribute — shown
  // in the UI so the user can judge for themselves, since license status
  // for Bible translations varies a lot by edition/revision.
  licenseDetail: string;
  // bible-json: thiagobodruk/bible shape; scrollmapper-json:
  // scrollmapper/bible_databases shape. Both hosts are already allowed in
  // the Rust HTTP capability scope (raw.githubusercontent.com).
  format: 'bible-json' | 'scrollmapper-json';
  url: string;
}

// Curated manually, not fetched from a remote index (yet — see ROADMAP.md).
// Every entry here has been individually checked for public-domain status;
// this repo (thiagobodruk/bible) hosts many more translations, but most
// modern revisions (NVI, RVR1960, etc.) are still under copyright and were
// deliberately left out. Verify licensing yourself before adding more.
export const LIBRARY_MANIFEST: LibraryEntry[] = [
  {
    id: 'en_kjv',
    title: 'King James Version',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: '1611 translation; crown copyright (UK) does not apply outside the UK, and the text is in the public domain.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json',
  },
  {
    id: 'en_bbe',
    title: 'Bible in Basic English',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Published 1949–1965; now in the public domain.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_bbe.json',
  },
  {
    id: 'ar_svd',
    title: 'Van Dyck Arabic Bible (سميث و فانديك)',
    language: 'ar',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Completed 1865 by Eli Smith and Cornelius Van Dyck; both translators died before 1900.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/ar_svd.json',
  },
  {
    id: 'ru_synodal',
    title: 'Russian Synodal Bible',
    language: 'ru',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Completed 1876 under the Russian Orthodox Holy Synod; long out of copyright.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/ru_synodal.json',
  },
  {
    id: 'zh_cuv',
    title: 'Chinese Union Version (和合本)',
    language: 'zh',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Completed 1919; copyright has expired.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/zh_cuv.json',
  },
  // ---- scrollmapper/bible_databases (github.com/scrollmapper) ----
  {
    id: 'en_asv',
    title: 'American Standard Version',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Published 1901; US copyright long expired. The classic formal-equivalence revision of the KJV tradition.',
    format: 'scrollmapper-json',
    url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/ASV.json',
  },
  {
    id: 'en_bsb',
    title: 'Berean Standard Bible',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Modern English translation dedicated to the public domain (CC0) by its publisher on 30 April 2023.',
    format: 'scrollmapper-json',
    url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/BSB.json',
  },
  {
    id: 'en_ylt',
    title: 'Young’s Literal Translation',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Robert Young’s hyper-literal translation; 1898 revised edition, author died 1888 — public domain.',
    format: 'scrollmapper-json',
    url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/YLT.json',
  },
  {
    id: 'en_darby',
    title: 'Darby Translation',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'John Nelson Darby’s translation (d. 1882); 1890 edition — public domain.',
    format: 'scrollmapper-json',
    url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/Darby.json',
  },
  {
    id: 'en_drc',
    title: 'Douay-Rheims (Challoner Revision)',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Bishop Challoner’s 1749–1752 revision of the Douay-Rheims; the traditional Catholic English Bible, long in the public domain. Includes deuterocanonical books.',
    format: 'scrollmapper-json',
    url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/DRC.json',
  },
  {
    id: 'en_geneva',
    title: 'Geneva Bible (1599)',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'The 16th-century Bible of the Reformation, predating the KJV — public domain by age.',
    format: 'scrollmapper-json',
    url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/Geneva1599.json',
  },
  {
    id: 'en_jps',
    title: 'JPS Tanakh (1917)',
    language: 'en',
    type: 'bible',
    category: 'bible',
    license: 'public domain',
    licenseDetail: 'Jewish Publication Society’s 1917 English Tanakh (Old Testament only); published before 1929 — US public domain.',
    format: 'scrollmapper-json',
    url: 'https://raw.githubusercontent.com/scrollmapper/bible_databases/master/formats/json/JPS.json',
  },
];

export async function downloadAndInstall(
  entry: LibraryEntry,
  onProgress: (msg: string) => void,
): Promise<void> {
  onProgress('Downloading…');
  // Tauri HTTP plugin (Rust-side request) rather than webview fetch, so
  // downloads don't depend on each host's CORS policy.
  const res = await httpFetch(entry.url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  let parsed: ParsedSource;
  if (entry.format === 'scrollmapper-json') {
    const data: ScrollmapperJson = await res.json();
    parsed = scrollmapperJsonToParsedSource(data, entry.title);
  } else {
    const data: BibleJsonBook[] = await res.json();
    parsed = bibleJsonToParsedSource(data, entry.title);
  }
  await insertParsedSource(
    parsed,
    {
      title: entry.title, type: entry.type, language: entry.language,
      license_note: entry.license, category: entry.category,
    },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );
}

// ---------- add-ons ----------
//
// Not standalone sources — these attach extra data onto a translation
// that's already in the library. Same curated, no-account, one-time-
// download pattern as LIBRARY_MANIFEST, just surfaced as a second section
// in the Library panel instead of a new source row.

export interface LibraryAddon {
  id: string;
  title: string;
  requiresSourceTitle: string;
  license: string;
  licenseDetail: string;
  install: (onProgress: (msg: string) => void) => Promise<void>;
}

export const LIBRARY_ADDONS: LibraryAddon[] = [
  {
    id: 'kjv_strongs',
    title: 'KJV — add Strong’s numbers',
    requiresSourceTitle: 'King James Version',
    license: 'public domain text; CC BY-SA dictionary data',
    licenseDetail:
      'Word-tagging from the CrossWire Bible Society KJV2003 OSIS module: "Any copyright that might be ' +
      'obtained for this effort is held by CrossWire Bible Society © 2003-2023 and CrossWire Bible ' +
      'Society hereby grants a general public license to use this text for any purpose." Dictionary glosses ' +
      '(lemma, transliteration, definitions) are the public-domain Strong’s data (James Strong, d. 1894) ' +
      'as structured by OpenScriptures, Copyright OpenScriptures, CC BY-SA.',
    install: importKjvStrongs,
  },
];

export function addonRequirementMet(addon: LibraryAddon, sources: Source[]): boolean {
  return sources.some((s) => s.title === addon.requiresSourceTitle);
}

// ---------- reference works (bundled, no network) ----------
//
// Standalone freeform texts shipped inside the app itself (under
// public/library/) rather than fetched from a remote URL — the same
// bundling trick src/seed.ts uses for the KJV/BBE seed data. Unlike
// LIBRARY_MANIFEST/LIBRARY_ADDONS, installing one of these never makes a
// network call.

export interface BundledLibraryEntry {
  id: string;
  title: string;
  language: string;
  type: SourceType;
  category: SourceCategory;
  license: string;
  licenseDetail: string;
  // Verse-keyed works read alongside a translation: they're picked in a
  // normal Bible pane and can join a sync group, so installing one must NOT
  // force open a dedicated pane the way a freeform text does.
  verseKeyed?: boolean;
  // Sub-group label for the Library panel. Patristic works are grouped by
  // series (Ante-Nicene Fathers, Nicene and Post-Nicene Fathers Series I/II),
  // the same way Bibles are grouped by language.
  series?: string;
  // Returns the new source's id so the caller can open it straight away.
  install: (onProgress: (msg: string) => void) => Promise<number>;
}

export const BUNDLED_LIBRARY: BundledLibraryEntry[] = [
  {
    id: 'companion_appendixes',
    title: COMPANION_APPENDIX_TITLE,
    language: 'en',
    type: 'commentary',
    category: 'commentary',
    license: 'public domain',
    licenseDetail:
      'E.W. Bullinger (1837–1913) — public domain. Scraped from Levend Water\'s public-domain hosting ' +
      '(levendwater.org/companion/) into a clean Markdown bundle shipped with the app; installs 198 short ' +
      'commentary articles as their own browsable source, no network call required. See ' +
      'tools/companion-bible-appendix/scrape.mjs for scrape provenance.',
    install: installCompanionAppendixes,
  },
  {
    id: 'companion_notes',
    title: COMPANION_NOTES_TITLE,
    language: 'en',
    type: 'commentary',
    category: 'commentary',
    license: 'public domain',
    licenseDetail:
      'E.W. Bullinger (1837–1913) — public domain. The Companion Bible\'s verse-keyed marginal notes: ' +
      'his Structure diagrams, encoded as nested outlines so individual lines can be highlighted, bound ' +
      'and annotated, plus the side-notes themselves, with his scripture and appendix cross-references ' +
      'clickable. Reads alongside a translation in a normal pane. Hand-transcribed from the 1913 edition ' +
      'at the Internet Archive; see tools/companion-bible-notes/ for the transcription, its notation and its ' +
      'build script. Installs whichever books have been transcribed so far.',
    verseKeyed: true,
    install: installCompanionNotes,
  },
  {
    id: 'josephus_whiston',
    title: JOSEPHUS_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'historical',
    license: 'public domain',
    licenseDetail:
      'Flavius Josephus (c. 37–100 AD), translated by William Whiston (1737; translator died 1752) — ' +
      'public domain, from Project Gutenberg. One source containing the complete works: The Wars of ' +
      'the Jews, all twenty books of the Antiquities, The Life of Flavius Josephus and Against Apion ' +
      '— ~2,280 sections under a Work → Book → Chapter table of contents. Whiston\'s own translator ' +
      'footnotes are deliberately excluded, so the text is Josephus\'s only. Built by ' +
      'tools/josephus/build.mjs, which refuses any edition that isn\'t Whiston\'s.',
    install: installJosephus,
  },
  {
    id: 'foxe_martyrs',
    title: FOXE_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'historical',
    license: 'public domain',
    licenseDetail:
      'Credited to John Foxe (1516/17–1587); published by The John C. Winston Co. — public domain, ' +
      'from Project Gutenberg (ebook #22400, released 2007), produced by the Online Distributed ' +
      'Proofreading Team. Twenty-three chapters of martyrdom accounts from Stephen to the ' +
      'nineteenth century, under a Chapter → named entry table of contents. ' +
      'Note the edition: this is a 19th-century compilation and abridgement built on Foxe\'s work ' +
      '— its own preface calls it "strictly ... a COMPILATION" — extended by its unnamed editor to ' +
      'cover persecution history down to 1830, not a transcription of Foxe\'s original 1563/1570 ' +
      '"Actes and Monuments". Built by tools/foxe/build.mjs, which refuses a file that no longer ' +
      'carries Gutenberg\'s licence boilerplate.',
    install: installFoxe,
  },
  {
    id: 'anf01',
    title: ANF01_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 1. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf01). Editorial footnotes (both Roberts/Donaldson ' +
      'and Coxe) are excluded from the text. Built by tools/anf/anf01/build.mjs.',
    install: installANF01,
  },
  {
    id: 'anf02',
    title: ANF02_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 2. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf02). Editorial footnotes (both Roberts/Donaldson ' +
      'and Coxe) are excluded from the text. Built by tools/anf/anf02/build.mjs.',
    install: installANF02,
  },
  {
    id: 'anf03',
    title: ANF03_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 3. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf03). Editorial footnotes excluded. Built by tools/anf/anf03/build.mjs.',
    install: installANF03,
  },
  {
    id: 'anf04',
    title: ANF04_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 4. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf04). Editorial footnotes excluded. Built by tools/anf/anf04/build.mjs.',
    install: installANF04,
  },
  {
    id: 'anf05',
    title: ANF05_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 5. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf05). Editorial footnotes excluded. Built by tools/anf/anf05/build.mjs.',
    install: installANF05,
  },
  {
    id: 'anf06',
    title: ANF06_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 6. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf06). Editorial footnotes excluded. Built by tools/anf/anf06/build.mjs.',
    install: installANF06,
  },
  {
    id: 'anf07',
    title: ANF07_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 7. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf07). Editorial footnotes excluded. Built by tools/anf/anf07/build.mjs.',
    install: installANF07,
  },
  {
    id: 'anf08',
    title: ANF08_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 8. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf08). Editorial footnotes excluded. Built by tools/anf/anf08/build.mjs.',
    install: installANF08,
  },
  {
    id: 'anf09',
    title: ANF09_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Ante-Nicene Fathers',
    license: 'public domain',
    licenseDetail:
      'Ante-Nicene Fathers, Vol. 9. Edited by Alexander Roberts and James Donaldson (first published ' +
      '1867, Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
      'Buffalo, NY). All editors deceased before 1930; text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/anf09). Editorial footnotes excluded. Built by tools/anf/anf09/build.mjs.',
    install: installANF09,
  },
  {
    id: 'npnf101',
    title: NPNF101_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 1. Edited by Philip Schaff (first published ' +
      '1886, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text in ' +
      'the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf101). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf101/build.mjs.',
    install: installNPNF101,
  },
  {
    id: 'npnf102',
    title: NPNF102_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 2. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf102). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf102/build.mjs.',
    install: installNPNF102,
  },
  {
    id: 'npnf103',
    title: NPNF103_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 3. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf103). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf103/build.mjs.',
    install: installNPNF103,
  },
  {
    id: 'npnf104',
    title: NPNF104_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 4. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf104). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf104/build.mjs.',
    install: installNPNF104,
  },
  {
    id: 'npnf105',
    title: NPNF105_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 5. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf105). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf105/build.mjs.',
    install: installNPNF105,
  },
  {
    id: 'npnf106',
    title: NPNF106_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 6. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf106). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf106/build.mjs.',
    install: installNPNF106,
  },
  {
    id: 'npnf107',
    title: NPNF107_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 7. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf107). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf107/build.mjs.',
    install: installNPNF107,
  },
  {
    id: 'npnf108',
    title: NPNF108_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 8. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf108). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf108/build.mjs.',
    install: installNPNF108,
  },
  {
    id: 'npnf109',
    title: NPNF109_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 9. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf109). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf109/build.mjs.',
    install: installNPNF109,
  },
  {
    id: 'npnf110',
    title: NPNF110_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 10. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf110). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf110/build.mjs.',
    install: installNPNF110,
  },
  {
    id: 'npnf111',
    title: NPNF111_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 11. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf111). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf111/build.mjs.',
    install: installNPNF111,
  },
  {
    id: 'npnf112',
    title: NPNF112_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 12. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf112). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf112/build.mjs.',
    install: installNPNF112,
  },
  {
    id: 'npnf113',
    title: NPNF113_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 13. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf113). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf113/build.mjs.',
    install: installNPNF113,
  },
  {
    id: 'npnf114',
    title: NPNF114_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series I',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series I, Vol. 14. Edited by Philip Schaff (first published ' +
      '1886–1889, Buffalo, NY, by the Christian Literature Publishing Co.). Editor deceased 1893; text ' +
      'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf114). ' +
      'Editorial footnotes excluded. Built by tools/npnf1/npnf114/build.mjs.',
    install: installNPNF114,
  },
  {
    id: 'npnf201',
    title: NPNF201_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 1. Edited by Philip Schaff and Henry Wace ' +
      '(first published 1890, New York, by the Christian Literature Publishing Co.). Both editors ' +
      'deceased before 1925 (Schaff 1893, Wace 1924); text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf201). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf201/build.mjs.',
    install: installNPNF201,
  },
  {
    id: 'npnf202',
    title: NPNF202_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 2. Edited by Philip Schaff and Henry Wace ' +
      '(first published 1890, New York, by the Christian Literature Publishing Co.). Both editors ' +
      'deceased before 1925 (Schaff 1893, Wace 1924); text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf202). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf202/build.mjs.',
    install: installNPNF202,
  },
  {
    id: 'npnf203',
    title: NPNF203_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 3. Edited by Philip Schaff and Henry Wace ' +
      '(first published 1892, New York, by the Christian Literature Publishing Co.). Both editors ' +
      'deceased before 1925 (Schaff 1893, Wace 1924); text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf203). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf203/build.mjs.',
    install: installNPNF203,
  },
  {
    id: 'npnf204',
    title: NPNF204_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 4. Edited by Philip Schaff and Henry Wace, ' +
      'this volume edited by Archibald Robertson (first published 1892, New York, by the Christian Literature ' +
      'Publishing Co.). All editors deceased before 1935 (Schaff 1893, Wace 1924, Robertson 1931); ' +
      'text in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf204). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf204/build.mjs.',
    install: installNPNF204,
  },
  {
    id: 'npnf205',
    title: NPNF205_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 5. Edited by Philip Schaff and Henry Wace, ' +
      'translated by William Moore and Henry Austin Wilson (first published 1892, New York, by the Christian Literature ' +
      'Publishing Co.). Both editors deceased before 1925 (Schaff 1893, Wace 1924); text in the ' +
      'public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf205). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf205/build.mjs.',
    install: installNPNF205,
  },
  {
    id: 'npnf206',
    title: NPNF206_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 6. Edited by Philip Schaff and Henry Wace, ' +
      'translated by W. H. Fremantle with G. Lewis and W. G. Martley (first published 1892, New York, by the Christian Literature ' +
      'Publishing Co.). Both editors deceased before 1925 (Schaff 1893, Wace 1924); text in the ' +
      'public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf206). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf206/build.mjs.',
    install: installNPNF206,
  },
  {
    id: 'npnf207',
    title: NPNF207_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 7. Edited by Philip Schaff and Henry Wace, ' +
      'Cyril of Jerusalem translated by Edwin Hamilton Gifford and Gregory Nazianzen by Charles Gordon ' +
      'Browne and James Edward Swallow (first published 1894, New York, by the Christian Literature ' +
      'Publishing Co.). Both editors deceased before 1925 (Schaff 1893, Wace 1924); text in the ' +
      'public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf207). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf207/build.mjs.',
    install: installNPNF207,
  },
  {
    id: 'npnf208',
    title: NPNF208_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 8. Edited by Philip Schaff and Henry Wace, ' +
      'translated with notes by Blomfield Jackson (first published 1895, New York, by the Christian ' +
      'Literature Publishing Co.). Both editors deceased before 1925 (Schaff 1893, Wace 1924); text ' +
      'in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf208). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf208/build.mjs.',
    install: installNPNF208,
  },
  {
    id: 'npnf209',
    title: NPNF209_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 9. Edited by Philip Schaff and Henry Wace, ' +
      'Hilary of Poitiers translated by E. W. Watson and L. Pullan under the editorship of W. Sanday ' +
      'and John of Damascus by S. D. F. Salmond (first published 1899, New York, by the Christian ' +
      'Literature Publishing Co.). Both editors deceased before 1925 (Schaff 1893, Wace 1924); text ' +
      'in the public domain in the United States. ' +
      'Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf209). Editorial footnotes excluded. ' +
      'Built by tools/npnf2/npnf209/build.mjs.',
    install: installNPNF209,
  },
  {
    id: 'npnf210',
    title: NPNF210_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 10. Edited by Philip Schaff and Henry Wace, '
      + 'translated by H. de Romestin with E. de Romestin and H. T. F. Duckworth (first published 1896, New '
      + 'York, by the Christian Literature Publishing Co.). Published in the United States before 1929; text '
      + 'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf210). '
      + 'Editorial footnotes excluded. Built by tools/npnf2/npnf210/build.mjs.',
    install: installNPNF210,
  },
  {
    id: 'npnf211',
    title: NPNF211_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 11. Edited by Philip Schaff and Henry Wace; '
      + 'Sulpitius Severus translated by Alexander Roberts, Vincent of Lérins by C. A. Heurtley, and John '
      + 'Cassian by Edgar C. S. Gibson (first published 1894, New York, by the Christian Literature '
      + 'Publishing Co.). Published in the United States before 1929; text in the public domain in the United '
      + 'States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf211). Editorial footnotes excluded. Built '
      + 'by tools/npnf2/npnf211/build.mjs.',
    install: installNPNF211,
  },
  {
    id: 'npnf212',
    title: NPNF212_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 12. Edited by Philip Schaff and Henry Wace; Leo the '
      + 'Great translated by Charles Lett Feltoe and Gregory the Great by James Barmby (first published 1895, '
      + 'New York, by the Christian Literature Publishing Co.). Published in the United States before 1929; '
      + 'text in the public domain in the United States. Source: CCEL\'s ThML XML '
      + '(ccel.org/ccel/schaff/npnf212). Editorial footnotes excluded. Built by '
      + 'tools/npnf2/npnf212/build.mjs.',
    install: installNPNF212,
  },
  {
    id: 'npnf213',
    title: NPNF213_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 13. Edited by Philip Schaff and Henry Wace; Gregory '
      + 'the Great translated by James Barmby, Ephraim Syrus by J. B. Morris, A. Edward Johnston and J. T. S. '
      + 'Stopford, and Aphrahat edited and translated by John Gwynn (first published 1898, New York, by the '
      + 'Christian Literature Publishing Co.). Published in the United States before 1929; text in the public '
      + 'domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf213). Editorial '
      + 'footnotes excluded. Built by tools/npnf2/npnf213/build.mjs.',
    install: installNPNF213,
  },
  {
    id: 'npnf214',
    title: NPNF214_TITLE,
    language: 'en',
    type: 'extra-biblical',
    category: 'patristic',
    series: 'Nicene and Post-Nicene Fathers, Series II',
    license: 'public domain',
    licenseDetail:
      'Nicene and Post-Nicene Fathers, Series II, Vol. 14. Series edited by Philip Schaff and Henry Wace; '
      + 'this volume edited, with notes and translations, by Henry R. Percival (first published 1900, New '
      + 'York, by the Christian Literature Publishing Co.). Published in the United States before 1929; text '
      + 'in the public domain in the United States. Source: CCEL\'s ThML XML (ccel.org/ccel/schaff/npnf214). '
      + 'Editorial footnotes excluded. Built by tools/npnf2/npnf214/build.mjs.',
    install: installNPNF214,
  },
  {
    id: 'smiths_dictionary',
    title: SMITHS_TITLE,
    language: 'en',
    type: 'reference',
    category: 'dictionary',
    license: 'public domain',
    licenseDetail:
      "Dr. William Smith (1813–1893), Smith's Bible Dictionary, 1884 — public domain. Text from the "
      + 'CrossWire SWORD "Smith" module (DistributionLicense: Public Domain), a hand-transcribed edition '
      + 'chosen over the archive.org page scans, whose OCR text is heavily corrupted and covers only one '
      + 'volume of four. ~4,600 headword articles; reads in the study footer\'s Dictionary tab, not in a '
      + 'pane. Built by tools/smiths-dictionary/build.mjs, which refuses any module not marked public domain.',
    install: installSmiths,
  },
  {
    id: 'jfb_commentary',
    title: JFB_TITLE,
    language: 'en',
    type: 'footer-commentary',
    category: 'commentary',
    verseKeyed: true,
    license: 'public domain',
    licenseDetail:
      'Robert Jamieson (1802–1880), A. R. Fausset (1821–1910) and David Brown (1803–1897), '
      + 'Commentary Critical and Explanatory on the Whole Bible, 1871 — public domain; all three authors '
      + "died more than a century ago. Text from the CrossWire Bible Society's OSIS edition "
      + "(DistributionLicense: Public Domain), derived from CCEL's transcription. 19,442 verse-anchored "
      + "comments across all 66 books; reads in the study footer's Commentary tab, following Pane 1's "
      + 'chapter, not in a pane of its own. The introductions and the chronological tables of the Parables '
      + 'and Miracles are excluded — they anchor to no verse (see jfb/jfb-exclusions.txt). Built by '
      + 'tools/jfb/build.mjs, which refuses any module not marked public domain.',
    install: installJfb,
  },
  // The Talmud ships as six sources, one per Seder — see talmudImport.ts for
  // why it isn't one atomic install the way Josephus is. Generated rather
  // than written out six times: the six differ only in Seder name and
  // tractate count, so a copy-pasted block would be five chances to get the
  // licence note subtly wrong on the one non-public-domain text here.
  ...TALMUD_SEDARIM.map((seder) => ({
    id: `talmud_${seder.key}`,
    title: talmudTitle(seder),
    language: 'en',
    type: 'extra-biblical' as SourceType,
    category: 'rabbinic' as SourceCategory,
    series: 'Babylonian Talmud',
    license: 'CC BY-NC 4.0',
    licenseDetail:
      `${seder.label} of the Babylonian Talmud — ${seder.tractates} `
      + `tractate${seder.tractates === 1 ? '' : 's'}, under a Seder → Tractate → Daf table of `
      + 'contents, one entry per paragraph so any passage can be highlighted, annotated and bound. '
      + 'English translation by Rabbi Adin Even-Israel Steinsaltz, from the William Davidson digital '
      + 'edition of the Koren Noé Talmud (Koren Publishers Jerusalem), underwritten by the William '
      + 'Davidson Foundation and published by Sefaria. NOT public domain: licensed CC BY-NC 4.0, free to '
      + 'share with attribution for NON-COMMERCIAL use only — the one text in this Library carrying '
      + 'a non-commercial restriction (see the note under this section). Steinsaltz’s explanatory '
      + 'expansions are interleaved with the literal text, as in the printed edition. Built by '
      + 'tools/talmud/build.mjs, which refuses any version Sefaria does not report as CC-BY-NC.',
    install: installTalmudSeder(seder),
  })),
  {
    id: 'yerushalmi',
    title: YERUSHALMI_TITLE,
    language: 'en',
    type: 'extra-biblical' as SourceType,
    category: 'rabbinic' as SourceCategory,
    series: 'Jerusalem Talmud',
    license: 'CC BY',
    licenseDetail:
      'The complete Jerusalem Talmud — 39 tractates across five Sedarim, under a Seder → '
      + 'Tractate → Chapter:Halakhah table of contents, one entry per paragraph so any passage '
      + 'can be highlighted, annotated and bound. Cited by chapter and halakhah ("Berakhot 1:1"), '
      + 'not by daf: the Yerushalmi has no standard pagination. English translation by Heinrich W. '
      + 'Guggenheimer, published in 17 volumes by Walter de Gruyter (Berlin, 1999–2015) and '
      + 'digitised by Sefaria. NOT public domain, but licensed CC BY — attribution only, with '
      + 'none of the non-commercial restriction the Bavli carries. Guggenheimer’s explanatory '
      + 'footnotes are omitted (see the note under this section). Built by tools/yerushalmi/build.mjs, '
      + 'which refuses any version Sefaria does not report as CC-BY.',
    install: installYerushalmi,
  },
];

export const SERIES_NOTES: Record<string, string> = {
  // The Library's one deliberate exception to commercially-free sourcing.
  // Surfaced here, in the panel itself, rather than left in a code comment or
  // a tooltip: a user deciding whether to install this should see the terms
  // at the moment they decide.
  'Babylonian Talmud':
    'Not public domain, and the only text in this Library restricted to non-commercial use. '
    + 'The William Davidson Talmud is licensed '
    + 'CC BY-NC 4.0 — Rabbi Adin Even-Israel Steinsaltz’s English translation of the Koren Noé '
    + 'Talmud (Koren Publishers Jerusalem), underwritten by the William Davidson Foundation and published '
    + 'by Sefaria. You may share and adapt it with attribution, for non-commercial purposes only. That '
    + 'restriction sits alongside, but is separate from, Foundation’s own MIT-licensed code. It was '
    + 'included anyway because the only public-domain English Talmud (Michael Rodkinson, 1918) covers '
    + 'roughly a third of the tractates and was judged poor by its contemporaries; the Steinsaltz '
    + 'translation is complete and modern, and that completeness decided it.',
  // Not a second exception to the public-domain rule: CC BY is attribution
  // only. The note is here because the reader still has an attribution
  // obligation, and because the footnote omission changes what they get.
  'Jerusalem Talmud':
    'Not public domain, but licensed CC BY — free to share and adapt, including commercially, '
    + 'so long as the translator is credited. The English is Heinrich W. Guggenheimer’s '
    + 'translation and commentary, published in 17 volumes by Walter de Gruyter (Berlin, '
    + '1999–2015) and digitised and published by Sefaria. It was chosen over the only '
    + 'public-domain English Yerushalmi (Moses Schwab, 1886), which covers Berakhot alone — 1 of '
    + '39 tractates — and over Sefaria’s CC0 “Community Translation”, which '
    + 'despite its looser licence reaches only 20 tractates and under 1% of the corpus; '
    + 'completeness decided it, as it did for the Bavli. Guggenheimer’s footnotes are not '
    + 'included: Sefaria splices them into the middle of the translated sentence, and this '
    + 'Library’s reading column is plain text.',
  'Ante-Nicene Fathers':
    'Volume 10 (General Index) intentionally omitted — use Foundation\'s full-text search (scope: Church Fathers or All sources) to find content across all installed volumes.',
  'Nicene and Post-Nicene Fathers, Series I':
    'All 14 volumes available (Augustine, Vols. 1–8; Chrysostom, Vols. 9–14).',
  'Nicene and Post-Nicene Fathers, Series II':
    'All 14 volumes available (Eusebius; Socrates and Sozomen; Theodoret, Jerome, Gennadius and Rufinus; '
    + 'Athanasius; Gregory of Nyssa; Jerome; Cyril of Jerusalem and Gregory Nazianzen; Basil; Hilary of '
    + 'Poitiers and John of Damascus; Ambrose; Sulpitius Severus, Vincent of Lérins and John Cassian; Leo '
    + 'the Great and Gregory the Great; Ephraim Syrus and Aphrahat; the Seven Ecumenical Councils). With '
    + 'this series the Church Fathers collection is complete — 37 volumes across all three series.',
};
