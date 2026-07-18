import {
  findSourceByTitle, getEntryTexts, getMeta, insertParsedSource, setMeta, sourceCount, updateEntryTexts,
} from './db';
import { bibleJsonToParsedSource, type BibleJsonBook } from './bibleJsonFormat';

const SEEDS = [
  { file: '/seed/kjv.json', title: 'King James Version', abbrev: 'KJV' },
  { file: '/seed/bbe.json', title: 'Bible in Basic English', abbrev: 'BBE' },
];

// One-time, offline repair: early versions of the seed conversion stripped
// only the {brace} characters from the source JSON, leaking translator's
// notes ("...: Heb. ...") into entries.text for ~6,500 KJV verses. This
// re-converts the bundled seed files with the fixed cleanBraceMarkup and
// updates exactly the rows whose text differs. Gated by a meta flag so it
// runs once; safe to re-run (it diffs before writing). Local files only —
// no network.
const REPAIR_FLAG = 'seed-text-repair-v1';

export async function repairSeededTextsIfNeeded(onProgress: (msg: string) => void): Promise<number> {
  if ((await getMeta(REPAIR_FLAG)) !== null) return 0;
  let repaired = 0;
  for (const seed of SEEDS) {
    const source = await findSourceByTitle(seed.title);
    if (!source) continue;
    onProgress(`Checking ${seed.title} text…`);
    const res = await fetch(seed.file);
    if (!res.ok) throw new Error(`Could not load bundled ${seed.title} (${res.status})`);
    const data: BibleJsonBook[] = await res.json();
    const parsed = bibleJsonToParsedSource(data, seed.title);
    const current = await getEntryTexts(source.id);
    const updates: { id: number; text: string }[] = [];
    for (const book of parsed.books) {
      for (const e of book.entries) {
        const row = current.get(`${book.name}|${e.chapter}|${e.verse}`);
        if (row && row.text !== e.text) updates.push({ id: row.id, text: e.text });
      }
    }
    if (updates.length > 0) {
      onProgress(`Repairing ${updates.length} ${seed.title} verses…`);
      await updateEntryTexts(updates);
      repaired += updates.length;
    }
  }
  await setMeta(REPAIR_FLAG, new Date().toISOString());
  return repaired;
}

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
