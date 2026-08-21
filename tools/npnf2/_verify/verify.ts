// Verification harness: runs the app's REAL importer, schema and queries
// against a real SQLite file, outside the Tauri runtime, by aliasing
// @tauri-apps/plugin-sql to a node:sqlite-backed shim. Run with
// `npm run verify` from tools/npnf2, against a throwaway database:
//
//   VERIFY_DB=/some/tmp/dir/verify.db npm run verify
//
// It writes, deletes and re-imports sources, so never point it at
// %APPDATA%/com.foundation.biblestudy/foundation.db.
//
// CAVEAT: node:sqlite is built without FTS5, so initDb() falls back to LIKE
// search and the search checks here exercise the fallback path, not the FTS
// path the desktop app actually uses. FTS behaviour has to be confirmed in
// the running app.
import fs from 'node:fs';
import Database from '@tauri-apps/plugin-sql';
import {
  initDb, listSources, listBooks, getEntries, getTocEntries, searchAll, deleteSource,
  seedHighlightersIfEmpty, listHighlighters, setHighlightEntry, highlightsForEntries,
  removeHighlightEntry, addNote, allNotes, deleteNote, createLink, listLinks, deleteLink,
} from '../../../src/db';
import { installNPNF204 } from '../../../src/npnf204Import';
import { installNPNF205 } from '../../../src/npnf205Import';
import { installNPNF206 } from '../../../src/npnf206Import';

const BUNDLES: Record<string, string> = {
  '/library/patristic/npnf204.json': 'public/library/patristic/npnf204.json',
  '/library/patristic/npnf205.json': 'public/library/patristic/npnf205.json',
  '/library/patristic/npnf206.json': 'public/library/patristic/npnf206.json',
};
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => ({
  ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(BUNDLES[url], 'utf8')),
});

let failures = 0;
const log = (s: string) => console.log(s);
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ' - ' + detail : ''}`);
};

async function counts(sourceId: number) {
  const db = await Database.load('sqlite:foundation.db');
  const one = async (sql: string) => ((await db.select(sql)) as { c: number }[])[0].c;
  return {
    books: await one(`SELECT COUNT(*) c FROM books WHERE source_id=${sourceId}`),
    entries: await one(`SELECT COUNT(*) c FROM entries WHERE book_id IN (SELECT id FROM books WHERE source_id=${sourceId})`),
    toc: await one(`SELECT COUNT(*) c FROM toc_entries WHERE source_id=${sourceId}`),
  };
}

async function main() {
  await initDb();
  await seedHighlightersIfEmpty();

  const installers: [string, number, (f: (m: string) => void) => Promise<number>][] = [
    ['Vol. 4 Athanasius', 4, installNPNF204],
    ['Vol. 5 Gregory of Nyssa', 5, installNPNF205],
    ['Vol. 6 Jerome', 6, installNPNF206],
  ];
  const ids: Record<number, number> = {};

  for (const [name, n, install] of installers) {
    log(`\n=== ${name} ===`);
    ids[n] = await install(() => {});
    const c = await counts(ids[n]);
    check('import succeeded', c.entries > 0, `${c.books} books, ${c.entries} entries, ${c.toc} TOC rows`);

    // The TOC is a flat ordered list; a row's parent is the nearest preceding
    // row of lower level. Two rows may share a title freely across the volume
    // (every treatise has its own "Introduction."); what a reader cannot live
    // with is two identical rows in the SAME sibling group.
    const toc = await getTocEntries(ids[n]);
    const path: string[] = [];
    const groups = new Map<string, string[]>();
    for (const r of toc) {
      path.length = r.level;
      const key = path.join(' > ');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r.title);
      path[r.level] = r.title;
    }
    const dup: string[] = [];
    for (const [key, list] of groups) {
      for (const t of new Set(list.filter((x, i) => list.indexOf(x) !== i))) dup.push(`${key} >> ${t}`);
    }
    check('no duplicate TOC rows within a sibling group', dup.length === 0, dup.slice(0, 3).join(' | '));
    check('TOC has multiple levels', new Set(toc.map((r) => r.level)).size > 1,
      `levels ${[...new Set(toc.map((r) => r.level))].sort().join(',')}`);
  }

  log('\n=== Re-running Vol. 5 alone (idempotency / removability) ===');
  const before4 = await counts(ids[4]);
  const before6 = await counts(ids[6]);
  const again = await installNPNF205(() => {});
  check('re-import is a separate source row, not a mutation of the first', again !== ids[5]);
  await deleteSource(again);
  const after5 = (await listSources()).filter((s) => s.title.includes('Vol. 5'));
  check('deleting the re-import leaves exactly one Vol. 5', after5.length === 1, `${after5.length} rows`);
  check('Vol. 4 unaffected', JSON.stringify(await counts(ids[4])) === JSON.stringify(before4));
  check('Vol. 6 unaffected', JSON.stringify(await counts(ids[6])) === JSON.stringify(before6));

  log('\n=== Search ===');
  // The scope test only means something if another category is present to be
  // excluded, so plant one that matches every probe word.
  {
    const db = await Database.load('sqlite:foundation.db');
    const src = await db.execute(
      "INSERT INTO sources (title, type, language, category) VALUES ('Scope Decoy', 'bible', 'en', 'bible')", []);
    const bk = await db.execute('INSERT INTO books (source_id, name, sort_order) VALUES (?, ?, 0)',
      [src.lastInsertId, 'Decoy']);
    await db.execute('INSERT INTO entries (book_id, chapter, verse, text, sort_order) VALUES (?, 1, 1, ?, 0)',
      [bk.lastInsertId, 'Athanasius Eunomius Vulgate all appear here in a non-patristic source.']);
  }
  const probes: [string, number][] = [['Athanasius', 4], ['Eunomius', 5], ['Vulgate', 6]];
  for (const [q, vol] of probes) {
    const all = await searchAll(q, null);
    const scoped = await searchAll(q, 'patristic');
    const inVol = all.hits.filter((h) => h.source_id === ids[vol]);
    check(`"${q}" found in Vol. ${vol}`, inVol.length > 0, `${inVol.length} of ${all.hits.length} hits`);
    check(`"${q}" unscoped search does reach the non-patristic decoy`,
      all.hits.some((h) => h.source_title === 'Scope Decoy'));
    check(`"${q}" still found under the Church Fathers scope`, scoped.hits.some((h) => h.source_id === ids[vol]));
    const wrongCat = scoped.hits.filter((h) => h.source_category !== 'patristic');
    check(`"${q}" patristic scope excludes other categories`, wrongCat.length === 0, `${wrongCat.length} leaked`);
  }

  log('\n=== Highlight / add-to-note / link on Vol. 6 entries ===');
  const books6 = await listBooks(ids[6]);
  const entries6 = await getEntries(ids[6], books6[0].name, 1);
  const e = entries6[0];
  check('got a Vol. 6 entry', !!e, e ? `entry ${e.id}: ${e.text.slice(0, 60)}` : '');

  const hl = (await listHighlighters())[0];
  await setHighlightEntry(hl.id, e.id);
  const hls = await highlightsForEntries([e.id]);
  check('highlight applied to a Vol. 6 entry', hls.has(e.id), hls.get(e.id)?.color);
  await removeHighlightEntry(e.id);
  check('highlight removed cleanly', !(await highlightsForEntries([e.id])).has(e.id));

  await addNote({ title: 'Jerome verification', content: 'added from Vol. 6', entry_id: e.id });
  const added = (await allNotes()).find((n) => n.title === 'Jerome verification');
  check('"add to note" stored against the Vol. 6 entry', !!added && added.entry_id === e.id,
    added ? `note ${added.id} -> entry ${added.entry_id}` : 'not found');
  if (added) await deleteNote(added.id);

  await createLink({ kind: 'entry', entryId: e.id }, { kind: 'entry', entryId: entries6[1].id });
  const links = await listLinks();
  check('link created between two Vol. 6 entries', links.length > 0, `${links.length} link(s)`);
  for (const l of links) await deleteLink(l.id);

  log('\n=== Delete cascade (Vol. 5) ===');
  const v5 = ids[5];
  await deleteSource(v5);
  const db = await Database.load('sqlite:foundation.db');
  const one = async (sql: string) => ((await db.select(sql)) as { c: number }[])[0].c;
  check('Vol. 5 books gone', (await one(`SELECT COUNT(*) c FROM books WHERE source_id=${v5}`)) === 0);
  check('Vol. 5 TOC gone', (await one(`SELECT COUNT(*) c FROM toc_entries WHERE source_id=${v5}`)) === 0);
  check('no orphaned entries anywhere', (await one('SELECT COUNT(*) c FROM entries WHERE book_id NOT IN (SELECT id FROM books)')) === 0);
  check('no orphaned notes anywhere', (await one('SELECT COUNT(*) c FROM notes WHERE entry_id IS NOT NULL AND entry_id NOT IN (SELECT id FROM entries)')) === 0);
  check('Vol. 5 no longer listed', !(await listSources()).some((s) => s.id === v5));
  check('Vol. 4 intact after the delete', JSON.stringify(await counts(ids[4])) === JSON.stringify(before4));
  check('Vol. 6 intact after the delete', JSON.stringify(await counts(ids[6])) === JSON.stringify(before6));

  log('\nSources at end: ' + (await listSources()).map((s) => s.title.slice(0, 55)).join(' | '));
  log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
