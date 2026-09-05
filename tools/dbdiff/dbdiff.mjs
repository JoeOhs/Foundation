// Compare a Foundation database backup against the live one, to confirm an
// install added rows without mutating anything pre-existing.
//
//   node tools/dbdiff/dbdiff.mjs "<backup.db>" "<live.db>" [--expect-changed "Foxe,..."]
//
// --expect-changed lists sources you deliberately reinstalled (install is a
// delete-and-reinsert, so their rows legitimately change). Matched as a
// case-insensitive substring of the title. Anything NOT listed that changed
// is the thing worth investigating.
//
// Uses the sql.js already in node_modules — nothing to install. Read-only:
// it opens copies in memory and never writes to either file.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';

// Resolved against the repo, not the shell's cwd, so this runs from anywhere.
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const argv = process.argv.slice(2);
const expectIdx = argv.indexOf('--expect-changed');
const expected = expectIdx >= 0
  ? (argv[expectIdx + 1] ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)
  : [];
if (expectIdx >= 0) argv.splice(expectIdx, 2);
const [backupPath, livePath] = argv;
if (!backupPath || !livePath) {
  console.error('usage: node tools/dbdiff/dbdiff.mjs "<backup.db>" "<live.db>" [--expect-changed "Foxe"]');
  process.exit(1);
}
// Checked before opening anything, so a wrong path gives a usable message
// rather than a raw ENOENT stack. The common mistakes are pasting a
// placeholder verbatim and pointing at a backup that was never taken, so
// when the file is missing we list the backups that do exist beside it.
function mustExist(p, label) {
  if (fs.existsSync(p)) return;
  console.error(`\n${label} not found:\n  ${p}\n`);
  try {
    const dir = path.dirname(p);
    const found = fs.readdirSync(dir)
      .filter((f) => f.includes('.backup-'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtime }))
      .sort((a, b) => b.t - a.t);
    if (found.length) {
      console.error('Backups that do exist in that folder, newest first:');
      for (const { f, t } of found) console.error(`  ${f}   (${t.toISOString()})`);
    } else {
      console.error(`No *.backup-* files in ${dir} — it looks like no backup was taken.`);
    }
  } catch { /* directory unreadable; the path error above is enough */ }
  console.error('');
  process.exit(1);
}
mustExist(backupPath, 'Backup database');
mustExist(livePath, 'Live database');

const SQL = await initSqlJs({ locateFile: () => path.join(REPO, 'node_modules/sql.js/dist/sql-wasm.wasm') });
const open = (p) => new SQL.Database(new Uint8Array(fs.readFileSync(p)));
const A = open(backupPath), B = open(livePath);

const rows = (db, q) => { const r = db.exec(q); return r.length ? r[0].values : []; };
const tables = (db) => rows(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' ORDER BY name").map(r => r[0]);

console.log('=== row counts (backup -> live) ===');
const all = [...new Set([...tables(A), ...tables(B)])];
for (const t of all) {
  let a = 0, b = 0;
  try { a = rows(A, `SELECT COUNT(*) FROM "${t}"`)[0][0]; } catch { a = NaN; }
  try { b = rows(B, `SELECT COUNT(*) FROM "${t}"`)[0][0]; } catch { b = NaN; }
  const d = b - a;
  if (d !== 0 || Number.isNaN(a) || Number.isNaN(b)) {
    console.log(`  ${t.padEnd(20)} ${String(a).padStart(7)} -> ${String(b).padStart(7)}  ${d > 0 ? '+' + d : d}`);
  }
}

console.log('\n=== sources ===');
const srcA = new Map(rows(A, 'SELECT id,title,category FROM sources').map(r => [r[0], r]));
const srcB = new Map(rows(B, 'SELECT id,title,category FROM sources').map(r => [r[0], r]));
const titlesA = new Map([...srcA.values()].map(r => [r[1], r]));
const titlesB = new Map([...srcB.values()].map(r => [r[1], r]));
for (const [title, r] of titlesB) if (!titlesA.has(title)) console.log(`  + ADDED    [${r[2]}] ${title}`);
for (const [title, r] of titlesA) if (!titlesB.has(title)) console.log(`  - REMOVED  [${r[2]}] ${title}`);
for (const [title, rb] of titlesB) {
  const ra = titlesA.get(title);
  if (ra && ra[0] !== rb[0]) console.log(`  ~ REINSTALLED (new id ${ra[0]} -> ${rb[0]}) ${title}`);
}

// The check that matters: for every source present in BOTH by title and with
// the SAME id, no entry row may have changed.
console.log('\n=== pre-existing entries mutated? ===');
let checked = 0, mutated = 0;
for (const [title, ra] of titlesA) {
  const rb = titlesB.get(title);
  if (!rb || ra[0] !== rb[0]) continue; // added, removed, or reinstalled — reported above
  const q = (db) => rows(db, `SELECT e.id, e.chapter, e.verse, IFNULL(e.position_ref,''), IFNULL(e.heading,''), e.text
      FROM entries e JOIN books b ON b.id = e.book_id WHERE b.source_id = ${ra[0]} ORDER BY e.id`);
  const ea = q(A), eb = q(B);
  const isExpected = expected.some((x) => title.toLowerCase().includes(x));
  checked++;
  const report = (msg) => {
    if (isExpected) console.log(`  ~ ${title}: ${msg} (expected — you reinstalled it)`);
    else { console.log(`  ! ${title}: ${msg}`); mutated++; }
  };
  if (ea.length !== eb.length) { report(`entry count ${ea.length} -> ${eb.length}`); continue; }
  let diffs = 0;
  for (let i = 0; i < ea.length; i++) if (JSON.stringify(ea[i]) !== JSON.stringify(eb[i])) diffs++;
  if (diffs) report(`${diffs} entry row(s) changed`);
}
console.log(`  ${checked} source(s) compared row-by-row; ${mutated} changed unexpectedly.`);
console.log(mutated === 0 ? '  OK — no pre-existing source was mutated.' : '  ** INVESTIGATE **');

console.log('\n=== user data (must never shrink) ===');
for (const t of ['notes', 'highlights', 'links', 'bookmarks', 'highlighters']) {
  let a = 0, b = 0;
  try { a = rows(A, `SELECT COUNT(*) FROM ${t}`)[0][0]; b = rows(B, `SELECT COUNT(*) FROM ${t}`)[0][0]; } catch { continue; }
  console.log(`  ${t.padEnd(14)} ${a} -> ${b}  ${b < a ? '** LOST ROWS **' : 'ok'}`);
}
