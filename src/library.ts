import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { insertParsedSource } from './db';
import { bibleJsonToParsedSource, type BibleJsonBook } from './bibleJsonFormat';
import { importKjvStrongs } from './strongsImport';
import type { Source, SourceType } from './types';

export interface LibraryEntry {
  id: string;
  title: string;
  language: string;
  type: SourceType;
  license: string;
  // Human-readable note on why this text is safe to redistribute — shown
  // in the UI so the user can judge for themselves, since license status
  // for Bible translations varies a lot by edition/revision.
  licenseDetail: string;
  format: 'bible-json';
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
    language: 'English',
    type: 'bible',
    license: 'public domain',
    licenseDetail: '1611 translation; crown copyright (UK) does not apply outside the UK, and the text is in the public domain.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_kjv.json',
  },
  {
    id: 'en_bbe',
    title: 'Bible in Basic English',
    language: 'English',
    type: 'bible',
    license: 'public domain',
    licenseDetail: 'Published 1949–1965; now in the public domain.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/en_bbe.json',
  },
  {
    id: 'ar_svd',
    title: 'Van Dyck Arabic Bible (سميث و فانديك)',
    language: 'Arabic',
    type: 'bible',
    license: 'public domain',
    licenseDetail: 'Completed 1865 by Eli Smith and Cornelius Van Dyck; both translators died before 1900.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/ar_svd.json',
  },
  {
    id: 'ru_synodal',
    title: 'Russian Synodal Bible',
    language: 'Russian',
    type: 'bible',
    license: 'public domain',
    licenseDetail: 'Completed 1876 under the Russian Orthodox Holy Synod; long out of copyright.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/ru_synodal.json',
  },
  {
    id: 'zh_cuv',
    title: 'Chinese Union Version (和合本)',
    language: 'Chinese',
    type: 'bible',
    license: 'public domain',
    licenseDetail: 'Completed 1919; copyright has expired.',
    format: 'bible-json',
    url: 'https://raw.githubusercontent.com/thiagobodruk/bible/master/json/zh_cuv.json',
  },
];

export function alreadyInstalled(entry: LibraryEntry, sources: Source[]): boolean {
  return sources.some((s) => s.title === entry.title);
}

export async function downloadAndInstall(
  entry: LibraryEntry,
  onProgress: (msg: string) => void,
): Promise<void> {
  onProgress('Downloading…');
  // Tauri HTTP plugin (Rust-side request) rather than webview fetch, so
  // downloads don't depend on each host's CORS policy.
  const res = await httpFetch(entry.url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const data: BibleJsonBook[] = await res.json();
  const parsed = bibleJsonToParsedSource(data, entry.title);
  await insertParsedSource(
    parsed,
    { title: entry.title, type: entry.type, language: entry.language, license_note: entry.license },
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
