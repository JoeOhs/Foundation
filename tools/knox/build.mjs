// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): compiles John Knox's writings from two CCEL ThML files into
// public/library/reformation/knox.json, the "book → piece → paragraph" bundle
// that src/knoxImport.ts installs through pieceBundleImport.ts.
//
// SOURCES (raw/, gitignored; `--fetch` downloads them, otherwise the build
// makes no network call):
//   history_reformation.xml  https://ccel.org/ccel/knox/history_reformation.xml
//     "The History of the Reformation of Religion in Scotland ... with which
//     are included Knox's Confession and the Book of Discipline", revised and
//     edited by Cuthbert Lennox (London: Andrew Melrose, 1905), via Project
//     Gutenberg. Books I–IV (Book V is not Knox's), the Scots Confession
//     (1560) and the First Book of Discipline (1560), spelling modernised.
//   blast.xml  https://ccel.org/ccel/knox/blast.xml
//     "The First Blast of the Trumpet" (Geneva, 1558), ed. Edward Arber
//     (English Scholar's Library No. 2, London, 1878), original spelling, with
//     Knox's 1559 letters defending it to Cecil and Elizabeth.
//
// NOT USED, and why:
//   works1.xml  Laing's "Works of John Knox", Vol. 1 — built separately, with
//     the rest of Laing's edition, by laing.mjs.
//   prayer.xml  "Treatise on Prayer" — CCEL's copy is extracted from a modern
//     "Selected Writings" (Still Waters Revival Books) with a modern Editor's
//     Note; its DC.Rights covers Knox, not that edition. Not cleared.
//
// EXCLUDED and logged to knox-exclusions.txt: Lennox's and Arber's
// introductions, bibliography and footnotes, the printed side/margin notes,
// the Act of Secret Council, glossary and indexes. Only Knox's own writing
// (and the documents he wrote with the Six Johns) ships.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childTitles, decodeEntities, division, exclusions, logExclusion, paragraphsOf, toText } from './thml.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(HERE, 'raw');
const OUT = join(HERE, '..', '..', 'public', 'library', 'reformation', 'knox.json');
const EXCLUSIONS = join(HERE, 'knox-exclusions.txt');
const FETCH = process.argv.includes('--fetch');
const AUDIT = process.argv.includes('--audit');

async function loadXml(name) {
  const path = join(RAW_DIR, `${name}.xml`);
  if (FETCH || !existsSync(path)) {
    if (!FETCH) throw new Error(`raw/${name}.xml missing — run with --fetch.`);
    const url = `https://ccel.org/ccel/knox/${name}.xml`;
    console.log(`  downloading ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
    await mkdir(RAW_DIR, { recursive: true });
    await writeFile(path, await res.text(), 'utf8');
  }
  return readFile(path, 'utf8');
}

// Refuse to build from a file that no longer declares itself public domain or
// is not the edition this script was written against.
function assertEdition(xml, name, editionPattern) {
  const head = xml.slice(0, xml.indexOf('</ThML.head>'));
  const rights = /<DC\.Rights>([^<]*)<\/DC\.Rights>/i.exec(head);
  if (!rights || !/^\s*public domain\s*$/i.test(rights[1])) {
    throw new Error(`${name}.xml does not declare DC.Rights "Public Domain" — refusing to build.`);
  }
  if (!/Knox,\s*John\s*\(1514-1572\)/.test(head)) throw new Error(`${name}.xml does not name John Knox as author.`);
  if (!editionPattern.test(xml)) throw new Error(`${name}.xml is not the edition expected (${editionPattern}).`);
}

// CCEL's division titles carry two misspellings the printed headings don't.
const TITLE_FIXES = { Possossions: 'Possessions', Universtities: 'Universities' };

function piece(title, chunk) {
  const clean = decodeEntities(title).replace(/Possossions|Universtities/g, (w) => TITLE_FIXES[w]).replace(/\.$/, '');
  return { title: clean, paragraphs: paragraphsOf(chunk, clean) };
}

function buildHistory(xml) {
  const HISTORY_BOOKS = ['Book First', 'Book Second', 'Book Third', 'Book Fourth'];
  const reformation = division(xml, 1, 'The Reformation of Religion in Scotland');
  const history = {
    name: 'The History of the Reformation in Scotland',
    pieces: HISTORY_BOOKS.map((t) => piece(t, division(reformation, 2, t))),
  };

  const appendix = division(xml, 1, 'Appendix');
  const confessionDiv = division(appendix, 2, "Knox's Confession");
  const confession = {
    name: 'The Scots Confession (1560)',
    pieces: childTitles(confessionDiv, 3).map((t) => piece(t, division(confessionDiv, 3, t))),
  };
  if (confession.pieces.length !== 26) throw new Error(`Expected the Preface and 25 chapters of the Confession, found ${confession.pieces.length}.`);

  const disciplineDiv = division(appendix, 2, 'The Book of Discipline');
  const discipline = {
    name: 'The First Book of Discipline (1560)',
    pieces: childTitles(disciplineDiv, 3).map((t) => piece(t, division(disciplineDiv, 3, t))),
  };
  if (discipline.pieces.length !== 17) throw new Error(`Expected 16 heads and the Conclusion of the Book of Discipline, found ${discipline.pieces.length}.`);

  for (const t of ['Title Page', 'Introductory Note', 'Act of Secret Council, xxvii January Anno &amp;c., 1560.', 'Glossary', 'Index']) {
    logExclusion('editorial matter (Lennox)', `${t}: ${toText(division(xml, 1, t)).slice(0, 200)}…`);
  }
  return [history, confession, discipline];
}

function buildBlast(xml) {
  const body = division(xml, 1, 'The First Blast of the Trumpet Against the Monstrous Regiment of Women.');
  const PIECES = [
    ['Preface', 'Preface'],
    ['The First Blast to Awake Women Degenerate', 'The First Blast to Awake Women Degenerate'],
    ['John Knoxe to the Reader.', 'John Knoxe to the Reader'],
    ['Appendix.', 'Defence of the First Blast: Letters to Cecil and Queen Elizabeth (1559)'],
  ];
  for (const t of ['Bibliography.', 'Introduction.', 'Extracts from Mr. David Laing’s Preface.']) {
    logExclusion('editorial matter (Arber)', `${t}: ${toText(division(xml, 2, t)).slice(0, 200)}…`);
  }
  return {
    name: 'The First Blast of the Trumpet (1558)',
    pieces: PIECES.map(([div, title]) => piece(title, division(body, 2, div))),
  };
}

async function main() {
  const historyXml = await loadXml('history_reformation');
  assertEdition(historyXml, 'history_reformation', /EDITED BY[\s\S]{0,80}CUTHBERT LENNOX/);
  const blastXml = await loadXml('blast');
  assertEdition(blastXml, 'blast', /Edited by[\s\S]{0,80}EDWARD ARBER/);

  const books = [...buildHistory(historyXml), buildBlast(blastXml)];
  const pieceCount = books.reduce((n, b) => n + b.pieces.length, 0);
  const paraCount = books.reduce((n, b) => n + b.pieces.reduce((k, p) => k + p.paragraphs.length, 0), 0);

  // Tripwire: nothing of the editors' own prose should survive.
  const all = JSON.stringify(books);
  for (const needle of ['Cuthbert Lennox', 'Arber', 'Transcriber']) {
    if (all.includes(needle)) throw new Error(`"${needle}" survives in the bundle — editorial matter leaked.`);
  }

  const bundle = {
    metadata: {
      author: 'John Knox',
      license_note:
        'Public domain. The History of the Reformation of Religion in Scotland, with Knox’s Confession and the '
        + 'Book of Discipline, ed. Cuthbert Lennox (London, 1905); The First Blast of the Trumpet, ed. Edward Arber '
        + '(London, 1878). Both via CCEL.',
      piece_count: pieceCount,
    },
    books,
  };
  await writeFile(OUT, JSON.stringify(bundle), 'utf8');
  await writeFile(EXCLUSIONS, exclusions.join('\n') + '\n', 'utf8');
  console.log(`  wrote ${books.length} books, ${pieceCount} pieces, ${paraCount} paragraphs; ${exclusions.length} exclusions logged`);
  if (AUDIT) for (const b of books) for (const p of b.pieces) console.log(`  ${b.name} → ${p.title} (${p.paragraphs.length})`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
