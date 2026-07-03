import { insertParsedSource, sourceCount } from './db';
import { bibleJsonToParsedSource, type BibleJsonBook } from './bibleJsonFormat';

const SEEDS = [
  { file: '/seed/kjv.json', title: 'King James Version', abbrev: 'KJV' },
  { file: '/seed/bbe.json', title: 'Bible in Basic English', abbrev: 'BBE' },
];

export async function seedIfEmpty(onProgress: (msg: string) => void): Promise<boolean> {
  if ((await sourceCount()) > 0) return false;
  for (const seed of SEEDS) {
    onProgress(`Installing ${seed.title}…`);
    const res = await fetch(seed.file);
    if (!res.ok) throw new Error(`Could not load bundled ${seed.title} (${res.status})`);
    const data: BibleJsonBook[] = await res.json();
    const parsed = bibleJsonToParsedSource(data, seed.title);
    await insertParsedSource(
      parsed,
      { title: seed.title, type: 'bible', language: 'en', license_note: 'public domain' },
      (done, total) => onProgress(`Installing ${seed.title}… ${Math.round((done / total) * 100)}%`),
    );
  }
  return true;
}
