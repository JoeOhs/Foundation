import { insertParsedSource } from './db';
import { bibleJsonToParsedSource, type BibleJsonBook } from './bibleJsonFormat';
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
  const res = await fetch(entry.url);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const data: BibleJsonBook[] = await res.json();
  const parsed = bibleJsonToParsedSource(data, entry.title);
  await insertParsedSource(
    parsed,
    { title: entry.title, type: entry.type, language: entry.language, license_note: entry.license },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );
}
