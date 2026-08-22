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
// Currently pointed at Series II Vols. 10-14 (batch 4), which completes the
// series and the whole Church Fathers collection. Three neighbours from
// elsewhere in the collection are installed alongside them — Ante-Nicene
// Fathers Vol. 1, NPNF Series I Vol. 1 and Series II Vol. 9, the last volume
// of the previous batch — so that "this batch does not disturb anything
// else" is measured rather than assumed: their row counts are taken before
// the new volumes arrive and compared again after a new volume has been
// re-imported and deleted.
import fs from 'node:fs';
import Database from '@tauri-apps/plugin-sql';
import {
  initDb, listSources, listBooks, getEntries, getTocEntries, searchAll, deleteSource,
  seedHighlightersIfEmpty, listHighlighters, setHighlightEntry, highlightsForEntries,
  removeHighlightEntry, addNote, allNotes, deleteNote, createLink, listLinks, deleteLink,
} from '../../../src/db';
import { installANF01 } from '../../../src/anf01Import';
import { installNPNF101 } from '../../../src/npnf101Import';
import { installNPNF209 } from '../../../src/npnf209Import';
import { installNPNF210 } from '../../../src/npnf210Import';
import { installNPNF211 } from '../../../src/npnf211Import';
import { installNPNF212 } from '../../../src/npnf212Import';
import { installNPNF213 } from '../../../src/npnf213Import';
import { installNPNF214 } from '../../../src/npnf214Import';

const BUNDLES: Record<string, string> = {
  '/library/patristic/anf01.json': '../../public/library/patristic/anf01.json',
  '/library/patristic/npnf101.json': '../../public/library/patristic/npnf101.json',
  '/library/patristic/npnf209.json': '../../public/library/patristic/npnf209.json',
  '/library/patristic/npnf210.json': '../../public/library/patristic/npnf210.json',
  '/library/patristic/npnf211.json': '../../public/library/patristic/npnf211.json',
  '/library/patristic/npnf212.json': '../../public/library/patristic/npnf212.json',
  '/library/patristic/npnf213.json': '../../public/library/patristic/npnf213.json',
  '/library/patristic/npnf214.json': '../../public/library/patristic/npnf214.json',
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

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
const roman = (s: string) => {
  const d = s.split('').map((c) => ROMAN[c] ?? 0);
  return d.reduce((t, n, i) => t + (n < (d[i + 1] ?? 0) ? -n : n), 0);
};

// The numbers a run actually prints, for checking a sequence against the
// total the source claims rather than only against dangling rows. Returns
// them sorted, so a gap or a repeat is visible.
function numbersIn(rows: string[], kind: string) {
  const re = new RegExp(String.raw`^${kind}\s+([IVXLCDM]+)\b`, 'i');
  return rows.map((t) => t.match(re)).filter((m): m is RegExpMatchArray => !!m).map((m) => roman(m[1]));
}

function gapless(nums: number[]) {
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted.every((n, i) => n === i + 1);
}

async function main() {
  await initDb();
  await seedHighlightersIfEmpty();

  log('\n=== Neighbours from elsewhere in the collection (baseline) ===');
  const anf1 = await installANF01(() => {});
  const npnf1_1 = await installNPNF101(() => {});
  const npnf2_9 = await installNPNF209(() => {});
  const baseANF = await counts(anf1);
  const baseNPNF1 = await counts(npnf1_1);
  const baseNPNF29 = await counts(npnf2_9);
  check('ANF Vol. 1 installed', baseANF.entries > 0, `${baseANF.entries} entries`);
  check('NPNF I Vol. 1 installed', baseNPNF1.entries > 0, `${baseNPNF1.entries} entries`);
  check('NPNF II Vol. 9 installed', baseNPNF29.entries > 0, `${baseNPNF29.entries} entries`);

  const installers: [string, number, (f: (m: string) => void) => Promise<number>][] = [
    ['Vol. 10 Ambrose', 10, installNPNF210],
    ['Vol. 11 Sulpitius Severus, Vincent of Lérins, John Cassian', 11, installNPNF211],
    ['Vol. 12 Leo the Great, Gregory the Great (I)', 12, installNPNF212],
    ['Vol. 13 Gregory the Great (II), Ephraim Syrus, Aphrahat', 13, installNPNF213],
    ['Vol. 14 The Seven Ecumenical Councils', 14, installNPNF214],
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

  log('\n=== Authors kept apart, as the source itself divides them ===');
  {
    // Vol. 11 bills three authors and the source gives each one a div1, so
    // three top-level sections is the answer this volume should reach.
    const t11 = topLevel(tocs[11]);
    check('Vol. 11 gives Sulpitius Severus, Vincent and Cassian a section each',
      t11.length === 3 && t11.some((s) => /Sulpitius Severus/i.test(s))
      && t11.some((s) => /Vincent of L/i.test(s)) && t11.some((s) => /John Cassian/i.test(s)),
      t11.join(' | '));

    // Vol. 13 bills three authors and the source gives only two div1s,
    // Ephraim and Aphrahat sharing the second. Asserting two sections here
    // is asserting that the source's arrangement was preserved rather than
    // re-cut, and that neither author was dropped out of the shared one.
    const t13 = topLevel(tocs[13]);
    check('Vol. 13 keeps Gregory separate and Ephraim with Aphrahat, as the source does',
      t13.length === 2 && t13.some((s) => /Gregory the Great/i.test(s))
      && t13.some((s) => /Ephraim/i.test(s) && /Aphrahat/i.test(s)),
      t13.join(' | '));
    const shared = tocs[13].filter((r) => r.level === 1).map((r) => r.title);
    check('Vol. 13 shared section holds both Ephraim and Aphrahat works',
      shared.some((s) => /^Ephraim Syrus:/.test(s)) && shared.some((s) => /^Aphrahat:/.test(s)),
      shared.filter((s) => /^(Ephraim|Aphrahat)/.test(s)).length + ' prefixed works');
  }

  log('\n=== Gregory the Great across Vols. 12 and 13, split as the source splits him ===');
  {
    // Some Books carry a trailing clause from the source ("Book I. The Month
    // of September, Indiction IX., …") and some do not, and a Book's title
    // appears again as a chapter row one level down, so the rows are taken
    // at the level the Books themselves sit at.
    const registerBooks = (toc: { title: string; level: number }[]) => {
      const rows = toc.filter((r) => /^Book [IVX]+\b/.test(r.title));
      const level = Math.min(...rows.map((r) => r.level));
      return rows.filter((r) => r.level === level).map((r) => roman(r.title.slice(5).split(/[.\s]/)[0]));
    };
    const books12 = registerBooks(tocs[12]);
    const books13 = registerBooks(tocs[13]);
    check('Vol. 12 carries Register Books I-VIII',
      books12.length === 8 && Math.min(...books12) === 1 && Math.max(...books12) === 8,
      books12.sort((a, b) => a - b).join(','));
    check('Vol. 13 carries Register Books IX-XIV, continuing where Vol. 12 stops',
      books13.length === 6 && Math.min(...books13) === 9 && Math.max(...books13) === 14,
      books13.sort((a, b) => a - b).join(','));
    check('Vol. 12 also carries the Book of Pastoral Rule, in four Parts',
      chaptersUnder(tocs[12], 'The Book of Pastoral Rule.').length === 5,
      // Preface + Parts I-IV
      `${chaptersUnder(tocs[12], 'The Book of Pastoral Rule.').length} rows (preface + 4 parts)`);
  }

  log('\n=== Counts against what each source itself claims ===');

  // --- Vol. 10 Ambrose -------------------------------------------------
  for (const [book, n] of [['Book I.', 50], ['Book II.', 30], ['Book III.', 22]] as [string, number][]) {
    const rows = chaptersUnder(tocs[10], book);
    check(`Vol. 10 De Officiis ${book} has ${n} chapters`, rows.length === n, `${rows.length}`);
  }
  check('Vol. 10 On the Mysteries: introduction + 9 chapters',
    chaptersUnder(tocs[10], 'On the Mysteries.').length === 10,
    `${chaptersUnder(tocs[10], 'On the Mysteries.').length}`);
  check('Vol. 10 Concerning Widows: introduction + 15 chapters',
    chaptersUnder(tocs[10], 'Concerning Widows.').length === 16,
    `${chaptersUnder(tocs[10], 'Concerning Widows.').length}`);
  check('Vol. 10 Letters: the 15 documents the editor selected',
    chaptersUnder(tocs[10], 'Selections from the Letters of St. Ambrose.').length === 15,
    `${chaptersUnder(tocs[10], 'Selections from the Letters of St. Ambrose.').length}`);
  // Rule 12's regression guard: this row is the section's own opening
  // paragraphs, which nothing read before Vol. 10 forced the question.
  check("Vol. 10 keeps the editor's Note on the Letters of St. Ambrose",
    tocs[10].some((r) => r.title === 'Note on the Letters of St. Ambrose.'));
  // Rule 10's regression guard.
  check('Vol. 10 does not open with a "Title Pages." section',
    !topLevel(tocs[10]).some((s) => /^Title Pages?\.?$/i.test(s)), topLevel(tocs[10])[0]);

  // --- Vol. 11 ---------------------------------------------------------
  {
    const commonitory = chaptersUnder(tocs[11],
      'The Commonitory of Vincent of Lérins, For the Antiquity and Universality of the Catholic Faith '
      + 'Against the Profane Novelties of All Heresies.');
    const chapters = numbersIn(commonitory, 'Chapter');
    check('Vol. 11 Commonitory: 33 chapters, numbered I-XXXIII with no gaps',
      chapters.length === 33 && gapless(chapters), `${chapters.length} chapters`);
    check('Vol. 11 Commonitory: the three appendices are kept too',
      commonitory.filter((t) => /^Appendix/i.test(t)).length === 3,
      `${commonitory.filter((t) => /^Appendix/i.test(t)).length}`);

    const institutes = chaptersUnder(tocs[11],
      'The Twelve Books on the Institutes of the Cœnobia, and the Remedies for the Eight Principal Faults.');
    const books = numbersIn(institutes, 'Book');
    check('Vol. 11 Institutes: twelve Books, as its own title says',
      books.length === 12 && gapless(books), `${books.length}`);

    // Two of the conferences the translator declined to render hold a single
    // chapter of their own name, which repeats their title one level down,
    // so the run is taken at the shallowest level it appears on.
    const confRows = tocs[11].filter((r) => /^Conference [IVXL]+\b/.test(r.title));
    const confLevel = Math.min(...confRows.map((r) => r.level));
    const conferences = confRows.filter((r) => r.level === confLevel)
      .map((r) => roman(r.title.slice(11).split(/[.\s]/)[0]));
    check('Vol. 11 Conferences: all 24, across the source\'s three Parts',
      conferences.length === 24 && gapless(conferences), `${conferences.length}`);

    const incarnation = chaptersUnder(tocs[11],
      'The Seven Books of John Cassian on the Incarnation of the Lord, Against Nestorius.');
    const inBooks = numbersIn(incarnation, 'Book');
    check('Vol. 11 On the Incarnation: seven Books, as its own title says',
      inBooks.length === 7 && gapless(inBooks), `${inBooks.length}`);
  }

  // --- Vol. 12 Leo -----------------------------------------------------
  {
    // Leo's 173 letters reconcile exactly, and the reconciliation is worth
    // spelling out because "167 rows" on its own would look six short. The
    // source prints three of the ranges as one row each — "A Series of
    // Letters." for LV-LVIII and again for LXII-LXIV, and "The former to
    // Marcian Augustus, and the other to Julian the Bishop." for CXXI-CXXII
    // — so 164 letters have a row of their own and the remaining nine sit
    // inside those three. 164 + 9 = 173, with nothing unaccounted for.
    const letters = chaptersUnder(tocs[12], 'Letters.');
    const nums = numbersIn(letters, 'Letter');
    const numbered = new Set(nums);
    const grouped = [55, 56, 57, 58, 62, 63, 64, 121, 122];
    const unaccounted = [...Array(173).keys()].map((i) => i + 1)
      .filter((i) => !numbered.has(i) && !grouped.includes(i));
    check('Vol. 12 Leo: 167 rows covering all 173 letters, nine of them in three grouped rows',
      letters.length === 167 && numbered.size === 164 && unaccounted.length === 0,
      `${letters.length} rows, ${numbered.size} numbered, unaccounted ${unaccounted.join(',') || 'none'}`);
    check('Vol. 12 Leo: no two letter rows read alike',
      new Set(letters).size === letters.length, `${new Set(letters).size} distinct of ${letters.length}`);

    const sermons = chaptersUnder(tocs[12], 'Sermons.');
    const sNums = numbersIn(sermons, 'Sermon');
    check('Vol. 12 Leo: 48 sermons, a numbered selection out of the 96',
      sermons.length === 48 && sNums.length === 48 && Math.max(...sNums) === 95,
      `${sermons.length} rows, highest ${Math.max(...sNums)}`);
  }

  // --- Vol. 13 Ephraim and Aphrahat ------------------------------------
  {
    const claims: [string, number][] = [
      ['Ephraim Syrus: Nineteen Hymns on the Nativity of Christ in the Flesh.', 19],
      ['Ephraim Syrus: Fifteen Hymns For the Feast of the Epiphany.', 15],
      ['Ephraim Syrus: The Pearl. Seven Hymns on the Faith.', 7],
      ['Ephraim Syrus: Three Homilies.', 3],
    ];
    for (const [work, n] of claims) {
      const rows = chaptersUnder(tocs[13], work);
      check(`Vol. 13 "${work.replace('Ephraim Syrus: ', '')}" holds ${n}, as its title counts them`,
        rows.length === n, `${rows.length}`);
    }
    const nisibene = chaptersUnder(tocs[13], 'Ephraim Syrus: The Nisibene Hymns.');
    check('Vol. 13 Nisibene Hymns: all 47 divisions the source marks up',
      nisibene.length === 47, `${nisibene.length}`);
    const demos = chaptersUnder(tocs[13], 'Aphrahat: Select Demonstrations.');
    check("Vol. 13 Aphrahat: eight Demonstrations plus the Inquirer's letter",
      demos.length === 9, `${demos.length}`);
  }

  // --- Vol. 14 the councils --------------------------------------------
  {
    // The documented canon count of every council and local synod in the
    // volume. This is the check the batch treats as mandatory: a collection
    // silently short by a canon would otherwise look perfectly well-formed.
    const CANONS: [string, number][] = [
      ['The Canons of the 318 Holy Fathers Assembled in the City of Nice, in Bithynia.', 20],
      ['The Canons of the Council of Ancyra.', 25],
      ['The Canons of the Holy and Blessed Fathers Who Assembled at Neocæsarea, Which are Indeed Later '
        + 'in Date Than Those Made at Ancyra, But More Ancient Than the Nicene: However, the Synod of Nice '
        + 'Has Been Placed Before Them on Account of Its Peculiar Dignity.', 15],
      ['The Canons of the Holy Fathers Assembled at Gangra, Which Were Set Forth After the Council of Nice.', 20],
      ['The Canons of the Blessed and Holy Fathers Assembled at Antioch in Syria.', 25],
      ['The Canons of the Synod Held in the City of Laodicea, in Phrygia Pacatiana, in which Many Blessed '
        + 'Fathers from Divers Provinces of Asia Were Gathered Together.', 60],
      ['Canons of the One Hundred and Fifty Fathers who assembled at Constantinople during the Consulate '
        + 'of those Illustrious Men, Flavius Eucherius and Flavius Evagrius on the VII of the Ides of July.', 7],
      ['The Canons of the Two Hundred Holy and Blessed Fathers Who Met at Ephesus.', 8],
      ['The Canons of the Council in Trullo.', 102],
      ['The Canons of the Council of Sardica.', 20],
      ['The Canons of the 217 Blessed Fathers who assembled at Carthage.', 138],
      ['The Canons of the Holy and Ecumenical Seventh Council.', 22],
    ];
    for (const [work, n] of CANONS) {
      const nums = numbersIn(chaptersUnder(tocs[14], work), 'Canon');
      const name = work.split(/[,.]/)[0].slice(0, 46);
      check(`Vol. 14 ${name}: ${n} canons, numbered I-${n} with no gaps`,
        nums.length === n && gapless(nums), `${nums.length} canons`);
    }
    // Chalcedon is the one collection the source itself numbers oddly: it
    // runs I-XXVIII, then XXX and XXXI, skipping the number XXIX, under a
    // heading that calls the set "The XXX Canons". Asserting the shape the
    // source actually prints is the point - a check that demanded I-XXX
    // gapless would fail on a correct import.
    const chalcedon = numbersIn(
      chaptersUnder(tocs[14], 'The XXX Canons of the Holy and Fourth Synods, of Chalcedon.'), 'Canon');
    check('Vol. 14 Chalcedon: 30 canons, the source skipping the number XXIX',
      chalcedon.length === 30 && Math.max(...chalcedon) === 31 && !chalcedon.includes(29),
      `${chalcedon.length} canons, highest ${Math.max(...chalcedon)}`);

    const t14 = topLevel(tocs[14]);
    for (const council of ['First Council of Nice', 'First Council of Constantinople', 'Council of Ephesus',
      'Council of Chalcedon', 'Second Council of Constantinople', 'Third Council of Constantinople',
      'Second Council of Nice']) {
      check(`Vol. 14 has a top-level section for the ${council}`,
        t14.some((s) => s.includes(council)), '');
    }
    // Rule 13's regression guard: the extracts resume under an unchanged
    // heading after each document quoted in full, and two rows of one
    // council that read alike are exactly what this volume produced before.
    check('Vol. 14 repeated work titles are qualified rather than left identical',
      tocs[14].some((r) => /— Extracts from the Acts/.test(r.title)),
      tocs[14].filter((r) => /— Extracts from the Acts/.test(r.title)).length + ' qualified');
    check('Vol. 14 does not open with a "Title Pages." section',
      !t14.some((s) => /^Title Pages?\.?$/i.test(s)), t14[0]);
  }

  log('\n=== Re-running Vol. 12 alone (idempotency / removability) ===');
  const before = Object.fromEntries(await Promise.all(
    [10, 11, 13, 14].map(async (n) => [n, await counts(ids[n])] as const)));
  const again = await installNPNF212(() => {});
  check('re-import is a separate source row, not a mutation of the first', again !== ids[12]);
  await deleteSource(again);
  const after12 = (await listSources()).filter((s) => s.title.includes('Vol. 12'));
  check('deleting the re-import leaves exactly one Vol. 12', after12.length === 1, `${after12.length} rows`);
  for (const n of [10, 11, 13, 14]) {
    check(`Vol. ${n} unaffected`, JSON.stringify(await counts(ids[n])) === JSON.stringify(before[n]));
  }
  check('ANF Vol. 1 unaffected', JSON.stringify(await counts(anf1)) === JSON.stringify(baseANF));
  check('NPNF I Vol. 1 unaffected', JSON.stringify(await counts(npnf1_1)) === JSON.stringify(baseNPNF1));
  check('NPNF II Vol. 9 unaffected', JSON.stringify(await counts(npnf2_9)) === JSON.stringify(baseNPNF29));

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
      [bk.lastInsertId, 'Holophernes Cœnobia Eutyches Nisibene Quinisext all appear here in a non-patristic source.']);
  }
  const probes: [string, number][] = [
    ['Holophernes', 10], ['Cœnobia', 11], ['Eutyches', 12], ['Nisibene', 13], ['Quinisext', 14],
  ];
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
  for (const n of [10, 11, 12, 13, 14]) {
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

    if (entries[1]) {
      await createLink({ kind: 'entry', entryId: e.id }, { kind: 'entry', entryId: entries[1].id });
      const links = await listLinks();
      check(`Vol. ${n}: link created between two entries`, links.length > 0, `${links.length} link(s)`);
      for (const l of links) await deleteLink(l.id);
    }
  }

  log('\n=== Delete cascade, one volume at a time ===');
  const db = await Database.load('sqlite:foundation.db');
  const one = async (sql: string) => ((await db.select(sql)) as { c: number }[])[0].c;
  for (const n of [10, 11, 12, 13, 14]) {
    const victim = ids[n];
    const survivors = [10, 11, 12, 13, 14].filter((m) => m > n);
    const survivorCounts = Object.fromEntries(await Promise.all(
      survivors.map(async (m) => [m, await counts(ids[m])] as const)));
    await deleteSource(victim);
    check(`Vol. ${n} books gone`, (await one(`SELECT COUNT(*) c FROM books WHERE source_id=${victim}`)) === 0);
    check(`Vol. ${n} TOC gone`, (await one(`SELECT COUNT(*) c FROM toc_entries WHERE source_id=${victim}`)) === 0);
    check(`Vol. ${n} no longer listed`, !(await listSources()).some((s) => s.id === victim));
    for (const m of survivors) {
      check(`Vol. ${m} intact after deleting Vol. ${n}`,
        JSON.stringify(await counts(ids[m])) === JSON.stringify(survivorCounts[m]));
    }
    check(`ANF Vol. 1 intact after deleting Vol. ${n}`,
      JSON.stringify(await counts(anf1)) === JSON.stringify(baseANF));
    check(`NPNF I Vol. 1 intact after deleting Vol. ${n}`,
      JSON.stringify(await counts(npnf1_1)) === JSON.stringify(baseNPNF1));
    check(`NPNF II Vol. 9 intact after deleting Vol. ${n}`,
      JSON.stringify(await counts(npnf2_9)) === JSON.stringify(baseNPNF29));
  }
  check('no orphaned entries anywhere', (await one('SELECT COUNT(*) c FROM entries WHERE book_id NOT IN (SELECT id FROM books)')) === 0);
  check('no orphaned notes anywhere', (await one('SELECT COUNT(*) c FROM notes WHERE entry_id IS NOT NULL AND entry_id NOT IN (SELECT id FROM entries)')) === 0);
  check('no orphaned TOC rows anywhere', (await one('SELECT COUNT(*) c FROM toc_entries WHERE source_id NOT IN (SELECT id FROM sources)')) === 0);

  log('\nSources at end: ' + (await listSources()).map((s) => s.title.slice(0, 55)).join(' | '));
  log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
