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
//
// Currently pointed at Series II Vols. 7-9 (batch 3). Two neighbours from
// the other patristic series are installed alongside them — Ante-Nicene
// Fathers Vol. 1 and NPNF Series I Vol. 1 — so that "this batch does not
// disturb anything else" is measured rather than assumed: their row counts
// are taken before the new volumes arrive and compared again after a
// Series II volume has been re-imported and deleted.
import fs from 'node:fs';
import Database from '@tauri-apps/plugin-sql';
import {
  initDb, listSources, listBooks, getEntries, getTocEntries, searchAll, deleteSource,
  seedHighlightersIfEmpty, listHighlighters, setHighlightEntry, highlightsForEntries,
  removeHighlightEntry, addNote, allNotes, deleteNote, createLink, listLinks, deleteLink,
} from '../../../src/db';
import { installANF01 } from '../../../src/anf01Import';
import { installNPNF101 } from '../../../src/npnf101Import';
import { installNPNF207 } from '../../../src/npnf207Import';
import { installNPNF208 } from '../../../src/npnf208Import';
import { installNPNF209 } from '../../../src/npnf209Import';

const BUNDLES: Record<string, string> = {
  '/library/patristic/anf01.json': '../../public/library/patristic/anf01.json',
  '/library/patristic/npnf101.json': '../../public/library/patristic/npnf101.json',
  '/library/patristic/npnf207.json': '../../public/library/patristic/npnf207.json',
  '/library/patristic/npnf208.json': '../../public/library/patristic/npnf208.json',
  '/library/patristic/npnf209.json': '../../public/library/patristic/npnf209.json',
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

// A TOC row's parent is the nearest preceding row of lower level. Two rows
// may share a title freely across a volume (every treatise has its own
// "Introduction."); what a reader cannot live with is two identical rows in
// the SAME sibling group.
async function checkTocShape(sourceId: number, label: string) {
  const toc = await getTocEntries(sourceId);
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
  check(`${label}: no duplicate TOC rows within a sibling group`, dup.length === 0, dup.slice(0, 3).join(' | '));
  check(`${label}: TOC has multiple levels`, new Set(toc.map((r) => r.level)).size > 1,
    `levels ${[...new Set(toc.map((r) => r.level))].sort().join(',')}`);
  return toc;
}

// Every top-level TOC row of a volume, so that a section quietly absorbed
// into another - Vol. 9's whole Hilary half hiding under a div1 titled
// "Title Page" - shows up as a missing row rather than as nothing at all.
function topLevel(toc: { title: string; level: number }[]) {
  return toc.filter((r) => r.level === 0).map((r) => r.title);
}

// A work's chapter rows, for counting a run against what the source says it
// holds. Rows under `work` up to the next row at the work's own level.
// A title can appear more than once at different levels - a section holding
// one work of its own name gives "The Letters." at level 0 and again at
// level 1 - so every occurrence is measured and the one that actually
// carries the chapters is the answer.
function chaptersUnder(toc: { title: string; level: number }[], work: string) {
  let best: string[] = [];
  toc.forEach((row, i) => {
    if (row.title !== work) return;
    const out: string[] = [];
    for (let j = i + 1; j < toc.length && toc[j].level > row.level; j++) {
      if (toc[j].level === row.level + 1) out.push(toc[j].title);
    }
    if (out.length > best.length) best = out;
  });
  return best;
}

async function main() {
  await initDb();
  await seedHighlightersIfEmpty();

  log('\n=== Neighbours from the other patristic series (baseline) ===');
  const anf1 = await installANF01(() => {});
  const npnf1_1 = await installNPNF101(() => {});
  const baseANF = await counts(anf1);
  const baseNPNF1 = await counts(npnf1_1);
  check('ANF Vol. 1 installed', baseANF.entries > 0, `${baseANF.entries} entries`);
  check('NPNF I Vol. 1 installed', baseNPNF1.entries > 0, `${baseNPNF1.entries} entries`);

  const installers: [string, number, (f: (m: string) => void) => Promise<number>][] = [
    ['Vol. 7 Cyril of Jerusalem, Gregory Nazianzen', 7, installNPNF207],
    ['Vol. 8 Basil', 8, installNPNF208],
    ['Vol. 9 Hilary of Poitiers, John of Damascus', 9, installNPNF209],
  ];
  const ids: Record<number, number> = {};
  const tocs: Record<number, { title: string; level: number }[]> = {};

  for (const [name, n, install] of installers) {
    log(`\n=== ${name} ===`);
    ids[n] = await install(() => {});
    const c = await counts(ids[n]);
    check('import succeeded', c.entries > 0, `${c.books} books, ${c.entries} entries, ${c.toc} TOC rows`);
    tocs[n] = await checkTocShape(ids[n], `Vol. ${n}`);
    log(`  top-level sections: ${topLevel(tocs[n]).join(' | ')}`);
  }

  log('\n=== Two authors per volume, each its own top-level branch ===');
  {
    const t7 = topLevel(tocs[7]);
    check('Vol. 7 keeps Cyril and Gregory apart',
      t7.some((s) => /Cyril/i.test(s)) && t7.filter((s) => /Gregory Nazianzen/i.test(s)).length === 2,
      t7.join(' | '));
    check('Vol. 7 Cyril section holds no Gregory row and vice versa',
      !/Gregory/i.test(t7.find((s) => /Cyril/i.test(s)) ?? '')
      && !t7.some((s) => /Gregory/i.test(s) && /Cyril/i.test(s)));

    const t9 = topLevel(tocs[9]);
    check('Vol. 9 keeps Hilary and John of Damascus apart',
      t9.some((s) => /Hilary/i.test(s)) && t9.some((s) => /John of Damascus/i.test(s)),
      t9.join(' | '));
    check('Vol. 9 Hilary branch is not absorbed into John of Damascus', t9.length === 2, `${t9.length} sections`);
  }

  log('\n=== Counts against what the source itself claims ===');
  check('Cyril: Procatechesis + Lectures I-XXIII = 24 chapters',
    chaptersUnder(tocs[7], 'The Catechetical Lectures of S. Cyril.').length === 24,
    `${chaptersUnder(tocs[7], 'The Catechetical Lectures of S. Cyril.').length}`);
  check('Gregory: 25 select orations',
    chaptersUnder(tocs[7], 'Select Orations of Saint Gregory Nazianzen.').length === 25,
    `${chaptersUnder(tocs[7], 'Select Orations of Saint Gregory Nazianzen.').length}`);
  {
    // 366 numbered letters in 356 rows: the source collapses three short
    // groups of fragments into one division each.
    const letters = chaptersUnder(tocs[8], 'The Letters.');
    const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    const value = (s: string) => {
      const d = s.split('').map((c) => ROMAN[c] ?? 0);
      return d.reduce((t, n, i) => t + (n < (d[i + 1] ?? 0) ? -n : n), 0);
    };
    const seen = new Set<number>();
    for (const t of letters) for (const m of t.matchAll(/Letters? ([IVXLCDM]+)\b/g)) seen.add(value(m[1]));
    // Two of the three collapsed rows name only their first number in the
    // heading ("Letters CCCLXI-CCCLXV"), so the rest of each range is
    // covered by that row.
    for (const r of [[330, 333], [361, 365]]) {
      if (seen.has(r[0])) for (let i = r[0]; i <= r[1]; i++) seen.add(i);
    }
    // The third takes its heading from the source's div title, "Without
    // address.", and carries CCCXVI-CCCXIX only in its first line of text.
    // It is the one row in the run with no number at all, and it sits
    // between CCCXV and CCCXX, which is what is asserted here rather than
    // simply forgiving the gap.
    const unnumbered = letters.filter((t) => !/Letters? [IVXLCDM]+\b/.test(t));
    const at = letters.findIndex((t) => !/Letters? [IVXLCDM]+\b/.test(t));
    if (unnumbered.length === 1 && /CCCXV\./.test(letters[at - 1]) && /CCCXX\./.test(letters[at + 1])) {
      for (let i = 316; i <= 319; i++) seen.add(i);
    }
    const missing = [...Array(366).keys()].map((i) => i + 1).filter((i) => !seen.has(i));
    check('Basil: 356 letter rows covering all 366 numbered letters',
      letters.length === 356 && missing.length === 0,
      `${letters.length} rows, missing ${missing.join(',') || 'none'}`);
  }
  check('Basil: Hexaemeron is nine homilies',
    chaptersUnder(tocs[8], 'The Hexæmeron.').length === 9,
    `${chaptersUnder(tocs[8], 'The Hexæmeron.').length}`);
  check('Basil: De Spiritu Sancto is thirty chapters',
    chaptersUnder(tocs[8], 'De Spiritu Sancto.').length === 30,
    `${chaptersUnder(tocs[8], 'De Spiritu Sancto.').length}`);
  check('Hilary: De Trinitate is twelve books',
    chaptersUnder(tocs[9], 'De Trinitate or On the Trinity.').length === 12,
    `${chaptersUnder(tocs[9], 'De Trinitate or On the Trinity.').length}`);
  check('Hilary: Homilies on the Psalms are three',
    chaptersUnder(tocs[9], 'Homilies on the Psalms.').length === 3,
    `${chaptersUnder(tocs[9], 'Homilies on the Psalms.').length}`);
  for (const [book, n] of [['Book I', 14], ['Book II', 30], ['Book III', 29], ['Book IV', 27]] as [string, number][]) {
    check(`John of Damascus: Exposition ${book} has ${n} chapters`,
      chaptersUnder(tocs[9], book).length === n, `${chaptersUnder(tocs[9], book).length}`);
  }

  log('\n=== Re-running Vol. 8 alone (idempotency / removability) ===');
  const before7 = await counts(ids[7]);
  const before9 = await counts(ids[9]);
  const again = await installNPNF208(() => {});
  check('re-import is a separate source row, not a mutation of the first', again !== ids[8]);
  await deleteSource(again);
  const after8 = (await listSources()).filter((s) => s.title.includes('Vol. 8'));
  check('deleting the re-import leaves exactly one Vol. 8', after8.length === 1, `${after8.length} rows`);
  check('Vol. 7 unaffected', JSON.stringify(await counts(ids[7])) === JSON.stringify(before7));
  check('Vol. 9 unaffected', JSON.stringify(await counts(ids[9])) === JSON.stringify(before9));
  check('ANF Vol. 1 unaffected', JSON.stringify(await counts(anf1)) === JSON.stringify(baseANF));
  check('NPNF I Vol. 1 unaffected', JSON.stringify(await counts(npnf1_1)) === JSON.stringify(baseNPNF1));

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
      [bk.lastInsertId, 'Procatechesis Libanius theandric all appear here in a non-patristic source.']);
  }
  const probes: [string, number][] = [['Procatechesis', 7], ['Libanius', 8], ['theandric', 9]];
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

  log('\n=== Highlight / add-to-note / link, one entry per volume ===');
  for (const n of [7, 8, 9]) {
    const books = await listBooks(ids[n]);
    const entries = await getEntries(ids[n], books[0].name, 1);
    const e = entries[0];
    check(`Vol. ${n}: got an entry`, !!e, e ? `entry ${e.id}: ${e.text.slice(0, 50)}` : '');
    if (!e) continue;

    const hl = (await listHighlighters())[0];
    await setHighlightEntry(hl.id, e.id);
    check(`Vol. ${n}: highlight applied`, (await highlightsForEntries([e.id])).has(e.id));
    await removeHighlightEntry(e.id);
    check(`Vol. ${n}: highlight removed cleanly`, !(await highlightsForEntries([e.id])).has(e.id));

    await addNote({ title: `Vol ${n} verification`, content: 'added from the volume', entry_id: e.id });
    const added = (await allNotes()).find((x) => x.title === `Vol ${n} verification`);
    check(`Vol. ${n}: "add to note" stored against the entry`, !!added && added.entry_id === e.id);
    if (added) await deleteNote(added.id);

    await createLink({ kind: 'entry', entryId: e.id }, { kind: 'entry', entryId: entries[1].id });
    const links = await listLinks();
    check(`Vol. ${n}: link created between two entries`, links.length > 0, `${links.length} link(s)`);
    for (const l of links) await deleteLink(l.id);
  }

  log('\n=== Delete cascade (Vol. 9) ===');
  const v9 = ids[9];
  await deleteSource(v9);
  const db = await Database.load('sqlite:foundation.db');
  const one = async (sql: string) => ((await db.select(sql)) as { c: number }[])[0].c;
  check('Vol. 9 books gone', (await one(`SELECT COUNT(*) c FROM books WHERE source_id=${v9}`)) === 0);
  check('Vol. 9 TOC gone', (await one(`SELECT COUNT(*) c FROM toc_entries WHERE source_id=${v9}`)) === 0);
  check('no orphaned entries anywhere', (await one('SELECT COUNT(*) c FROM entries WHERE book_id NOT IN (SELECT id FROM books)')) === 0);
  check('no orphaned notes anywhere', (await one('SELECT COUNT(*) c FROM notes WHERE entry_id IS NOT NULL AND entry_id NOT IN (SELECT id FROM entries)')) === 0);
  check('no orphaned TOC rows anywhere', (await one('SELECT COUNT(*) c FROM toc_entries WHERE source_id NOT IN (SELECT id FROM sources)')) === 0);
  check('Vol. 9 no longer listed', !(await listSources()).some((s) => s.id === v9));
  check('Vol. 7 intact after the delete', JSON.stringify(await counts(ids[7])) === JSON.stringify(before7));
  check('Vol. 8 intact after the delete', (await counts(ids[8])).entries > 0);
  check('ANF Vol. 1 intact after the delete', JSON.stringify(await counts(anf1)) === JSON.stringify(baseANF));
  check('NPNF I Vol. 1 intact after the delete', JSON.stringify(await counts(npnf1_1)) === JSON.stringify(baseNPNF1));

  log('\nSources at end: ' + (await listSources()).map((s) => s.title.slice(0, 55)).join(' | '));
  log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
