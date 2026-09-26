// Standalone data-prep script (run with `node laing.mjs`, outside the Tauri
// app): compiles "The Works of John Knox", collected and edited by David
// Laing (Edinburgh: Wodrow Society / Bannatyne Club, 1846–64, six volumes),
// into public/library/reformation/knox-laing.json — one `books` row per
// volume, one piece per work, installed by src/knoxLaingImport.ts through
// pieceBundleImport.ts. Makes no network call: raw/ is supplied by hand (see
// README.md).
//
// Three kinds of source, one per stretch of the edition:
//   Vol. I    CCEL ThML (works1.xml), itself from Project Gutenberg #21938.
//   Vol. II   Project Gutenberg #40886, HTML (laing02.html).
//   Vols. III–VI  OCR: Internet Archive's DjVu XML for the Princeton
//             Theological Seminary scans worksofjohnknox03knox … 06knox
//             (laing03.xml … laing06.xml). No transcription exists.
//
// Laing's own matter is kept where it introduces a work (his prefatory notice
// to each tract, the Vol. VI Preface, the appendix notices); his footnotes,
// the printed side notes, title pages, contents, glossaries, the Vol. VI
// Additional Notes and indexes are excluded and logged. The letters and
// documents Laing collected from Knox's correspondents and opponents (Cecil,
// Calvin, Quintin Kennedy, Tyrie …) are part of the edition and are kept.
//
// Usage:
//   node laing.mjs           build the bundle and laing-exclusions.txt
//   node laing.mjs --audit   also print the Volume → Work outline

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHeading, joinLines, median, readPage } from '../shared/djvu.mjs';
import { decodeEntities, division, exclusions, logExclusion, paragraphsOf, toText } from './thml.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');
const OUT = path.join(HERE, '..', '..', 'public', 'library', 'reformation', 'knox-laing.json');
const EXCLUSIONS = path.join(HERE, 'laing-exclusions.txt');
const AUDIT = process.argv.includes('--audit');

const read = (name) => {
  const file = path.join(RAW, name);
  if (!fs.existsSync(file)) throw new Error(`Missing raw/${name} — see README.md.`);
  return fs.readFileSync(file, 'utf8');
};

// ---------- Vol. I: CCEL ThML ----------

function volumeOne() {
  const xml = read('works1.xml');
  const head = xml.slice(0, xml.indexOf('</ThML.head>'));
  if (!/<DC\.Rights>\s*Public Domain\s*</i.test(head) || !/Works of John Knox, Vol\. 1/.test(head)) {
    throw new Error('works1.xml is not the public-domain Laing Vol. 1 expected — refusing to build.');
  }
  const history = division(xml, 1, 'The History of the Reformation in Scotland');
  const pieces = [
    ['Introductory Notice to the History (Laing)', division(history, 2, 'Introductory Notice to the History')],
    ['History of the Reformation, Book First', division(history, 2, 'Book First')],
    ['History of the Reformation, Book Second', division(history, 2, 'Book Second')],
  ];
  // The appendix numbers are div1s of their own, "No. II …" to "No. XVIII …".
  for (const m of xml.matchAll(/<div1\b[^>]*title="(No\. [^"]*)"/g)) {
    pieces.push([`Appendix ${decodeEntities(m[1]).replace(/^No\. ([IVX]+)\.? /, 'No. $1. ').replace(/\.$/, '')}`, division(xml, 1, m[1])]);
  }
  if (pieces.length !== 20) throw new Error(`Vol. I: expected 3 parts and 17 appendix numbers, found ${pieces.length}.`);
  for (const t of ['Title Page', 'Advertisement', 'Chronological Notes']) logExclusion(`Vol. I ${t}`, toText(division(xml, 1, t)).slice(0, 200));
  return {
    name: 'Volume I — History of the Reformation, Books I–II (1846)',
    pieces: pieces.map(([title, chunk]) => ({ title, paragraphs: paragraphsOf(chunk.replace(/<span class="sidenote"[^>]*>[\s\S]*?<\/span>/gi, (n) => (logExclusion('side note', toText(n)), ' ')), title) })),
  };
}

// ---------- Vol. II: Project Gutenberg HTML ----------

// Each piece starts at a marker in the HTML, found in order; the last runs to
// the Glossary. Declared, not inferred, so a changed file stops the build.
const VOL_TWO = [
  [/THE THIRD BOOKE OF THE PROGRESSE/, 'History of the Reformation, Book Third (with the Confession of Faith)'],
  [/<h2>THE PREFACE<\/h2>\s*<h3>TO THE BUKE OF DISCIPLINE/, 'The First Book of Discipline (1560)'],
  [/<p class="hanging">THE FOURT BOOK OF THE PROGRESSE/, 'History of the Reformation, Book Fourth'],
  [/<h2>THE FIFTH BOOK OF THE REFORMATION/, 'History of the Reformation, Book Fifth (with Laing’s Introductory Notice)'],
  [/<h2>APPENDIX\.<\/h2>\s*<h3>No\. 1\./, 'Appendix No. I. Interpolations and Various Readings in David Buchanan’s Edition of the History (1644)'],
  [/<h2>No\. II\.<\/h2>/, 'Appendix No. II. On Spottiswood’s Edition of the First Book of Discipline'],
  [/<h2>No\. III\.<\/h2>/, 'Appendix No. III. Funerals of Mary of Guise, Queen Regent of Scotland'],
  [/<h2>No\. IV\.<\/h2>/, 'Appendix No. IV. Notices of John Black, a Dominican Friar'],
  [/<h2>No\. V\.<\/h2>/, 'Appendix No. V. Notices of David Riccio'],
  [/<h2>No\. VI\.<\/h2>/, 'Appendix No. VI. The Abbots of Culross and Lindores in 1560'],
  [/<h2>GLOSSARY\.<\/h2>/, null],
];

function volumeTwo() {
  const html = read('laing02.html');
  if (!/The Works of John Knox, Volume 2 \(of 6\)/.test(html)) throw new Error('laing02.html is not Gutenberg #40886.');
  const cuts = [];
  let from = 0;
  for (const [re, title] of VOL_TWO) {
    const m = re.exec(html.slice(from));
    if (!m) throw new Error(`Vol. II: marker ${re} not found in order — refusing to build.`);
    from += m.index;
    cuts.push([from, title]);
    from += m[0].length;
  }
  logExclusion('Vol. II front matter', toText(html.slice(0, cuts[0][0])).slice(-300));
  const pieces = cuts.slice(0, -1).map(([at, title], i) => {
    const chunk = html.slice(at, cuts[i + 1][0])
      .replace(/<span class="pagenum">[\s\S]*?<\/span>/g, '')
      .replace(/<a[^>]*class="fnanchor[^"]*"[^>]*>[\s\S]*?<\/a>/g, '')
      .replace(/<div class="sidenote(10)?">[\s\S]*?<\/div>/g, (n) => (logExclusion('side note', toText(n)), ' '));
    return { title, paragraphs: paragraphsOf(chunk, title) };
  });
  return { name: 'Volume II — History of the Reformation, Books III–V (1848)', pieces };
}

// ---------- Vols. III–VI: OCR ----------

// Each work's first page (its half-title or heading) by scan page index,
// checked against the volume's printed contents. A page with `skip` starts
// matter that is left out; the piece before it ends there.
const OCR_VOLUMES = [
  { file: 'laing03.xml', pages: 572, name: 'Volume III — Writings, 1548–1554 (1854)', works: [
    [12, 'An Epistle to the Congregation of the Castle of St Andrews, with a Brief Summary of Balnaves on Justification by Faith (1548)'],
    [40, 'A Vindication of the Doctrine that the Sacrifice of the Mass is Idolatry (1550)'],
    [82, 'A Summary, according to the Holy Scriptures, of the Sacrament of the Lord’s Supper (1550)'],
    [88, 'A Declaration of the True Nature and Object of Prayer, with a Confession on the Death of Edward VI (1553)'],
    [130, 'An Exposition upon the Sixth Psalm of David, addressed to Mrs Bowes (1554)'],
    [180, 'A Godly Letter of Warning or Admonition to the Faithful in London, Newcastle and Berwick (1554)'],
    [240, 'Certain Questions concerning Obedience to Lawful Magistrates, with Answers by Henry Bullinger (1554)'],
    [250, 'Two Comfortable Epistles to his Afflicted Brethren in England (1554)'],
    [274, 'A Faithful Admonition to the Professors of God’s Truth in England (1554)'],
    [354, 'Epistles to Mrs Elizabeth Bowes and her Daughter Marjory, Letters I–XXVI (1553–1554)'],
    [426, 'Appendix: Henry Balnaves of Halhill — Notices, Letters, and his Treatise on Justification by Faith as revised by Knox (1548)'],
  ] },
  { file: 'laing04.xml', pages: 594, name: 'Volume IV — Writings, 1554–1558 (1855)', works: [
    [12, 'A Narrative of the Proceedings and Troubles of the English Congregation at Frankfurt (1554–1555), with Letters'],
    [80, 'Letter to the Queen Dowager, Regent of Scotland (1556)'],
    [96, 'An Exposition upon Matthew IV, concerning the Temptation of Christ in the Wilderness (1556)'],
    [126, 'Answers to Some Questions concerning Baptism, etc. (1556)'],
    [140, 'Letter of Wholesome Counsel, addressed to his Brethren in Scotland (1556)'],
    [152, 'The Form of Prayers and Ministration of the Sacraments, used in the English Congregation at Geneva (1556)'],
    [226, 'Familiar Epistles, Letters XXVII–XXXVII (1555–1558)'],
    [266, 'Letters to his Brethren, and the Lords Professing the Truth in Scotland (1557)'],
    [298, 'An Apology for the Protestants who are Holden in Prison at Paris, translated from the French, with Additions (1557)'],
    [360, 'The First Blast of the Trumpet against the Monstrous Regiment of Women (1558)'],
    [434, 'Letter to the Queen Dowager, Regent of Scotland, Augmented and Explained by the Author (1558)'],
    [472, 'The Appellation from the Sentence Pronounced by the Bishops and Clergy, addressed to the Nobility and Estates of Scotland (1558)'],
    [532, 'Letter addressed to the Commonalty of Scotland (1558)'],
    [550, 'Summary of the Proposed Second Blast of the Trumpet (1558)'],
    [552, 'Appendix: Anthony Gilby’s Admonition to England and Scotland (1558), and Psalm XCIV in Metre by William Kethe'],
  ] },
  { file: 'laing05.xml', pages: 562, name: 'Volume V — Writings, 1558–1560 (1856)', works: [
    [14, 'A Letter to John Foxe, at Basel (1558)'],
    [20, 'On Predestination, in Answer to the Cavillations by an Anabaptist (1560)'],
    [490, 'An Epistle to the Inhabitants of Newcastle and Berwick (1558)'],
    [516, 'A Brief Exhortation to England for the Speedy Embracing of the Gospel (1559)'],
    [544, 'The Names of the Martyrs in England (1559)'],
  ] },
  { file: 'laing06.xml', pages: 872, name: 'Volume VI — Letters and Later Writings, 1559–1572 (1864)', works: [
    [18, 'Preface: Knox’s Life, Family and Writings (Laing)'],
    [98, 'Letters chiefly relating to the Progress of the Reformation in Scotland, I–LXVI (1559–1562)'],
    [254, 'The Reasoning betwixt the Abbot of Crossraguell and John Knox concerning the Mass, with Kennedy’s Oration and Compendious Ressonyng (1561–1562)'],
    [326, 'Sermon on Isaiah xxvi. 13–21, preached in St Giles’s Church, Edinburgh, 19 August 1565'],
    [380, 'The Book of Common Order, or the Form of Prayers and Ministration of the Sacraments (1564)'],
    [466, 'Additional Prayers, etc., not contained in the Edinburgh Volume of 1564–65'],
    [486, 'The Order of the General Fast (1566), with Letters of the General Assembly'],
    [554, 'The Order of Excommunication and of Public Repentance (1569)'],
    [578, 'An Answer to a Letter written by James Tyrie, a Scottish Jesuit (1572)'],
    [628, 'Letters, etc., during the Later Period of Knox’s Life, LXVII–CX (1563–1572), with the Accounts of his Last Illness and Death'],
    [770, null, 'Additional Notes and Corrections, and indexes'],
  ] },
];

// Laing's footnotes are a smaller face, set in two columns below the text.
const FOOTNOTE_RATIO = 0.88;
const INDENT_MIN = 25;
const INDENT_MAX = 140;
// A running head: page number and short title in capitals ("THAT THE MASS IS
// IDOLATRY. 49", "532 A LETTER TO THE", "[ 539 ]"), or a bare page number.
const isRunningHead = (s) => /^\[?\s*[\dIVXLCl]{1,4}\s*\]?$/.test(s)
  || (/[A-Z]{3}/.test(s) && (s.match(/[a-z]/g) ?? []).length <= 3 && /(^|\s)[\dIVXLCixvl\]]{1,5}[.,]?(\s|$)/.test(s));
// The sheet signature at a page foot: "VOL. III.", "VOL. III. D".
// The OCR mangles the numeral and gathering letter freely ("VOL. 111. P",
// "VOL. VL 2 K", "VOL. Ill, K").
const isSignature = (s) => /^VOL\.?\s*\S{1,4}[.,-]?(\s+\S{1,4}){0,3}$/.test(s) && s.length <= 18;
// A numbered letter's heading in Vols. IV and VI: "XVI. — Sir William Cecill
// to the Lords …", mixed case, so isHeading misses it.
const isLetterHead = (s) => /^[IVXLC]{1,7}\.\s?[—–-]\s?[A-Z]/.test(s);

function ocrVolume(vol) {
  const xml = read(vol.file);
  const pages = [...xml.matchAll(/<OBJECT[^>]*height="(\d+)"[\s\S]*?<\/OBJECT>/g)];
  if (pages.length !== vol.pages) throw new Error(`${vol.file}: ${pages.length} pages, expected ${vol.pages} — not the scan this was mapped against.`);
  const starts = new Map(vol.works.map(([page, title, skip]) => [page, { title, skip }]));
  const pieces = [];
  let piece = null;
  let para = null;
  let prevEnds = true;
  const flush = () => { if (para && piece) piece.paragraphs.push(joinLines(para)); para = null; };

  pages.forEach((page, p) => {
    const start = starts.get(p);
    if (start) {
      flush();
      piece = start.title ? { title: start.title, paragraphs: [] } : null;
      if (piece) pieces.push(piece);
      if (start.skip) logExclusion(`${vol.file} from p.${p}`, start.skip);
      prevEnds = true;
    }
    if (!piece) return;
    const height = +page[1];
    const { lines, margins } = readPage(page[0], height);
    if (margins.length) logExclusion(`side note ${vol.file} p.${p}`, margins.join(' '));
    const xs = lines.map((l) => l.x0);
    let inFootnotes = false;
    lines.forEach((line, i) => {
      const t = line.text;
      if (i <= 1 && isRunningHead(t)) return logExclusion('running head', t);
      if (!inFootnotes) inFootnotes = line.ratio < FOOTNOTE_RATIO && line.top > height * 0.4 && !isHeading(t);
      if (inFootnotes || isSignature(t)) return logExclusion(`footnote ${vol.file} p.${p}`, t);
      if (isHeading(t)) { flush(); piece.paragraphs.push(t); prevEnds = true; return; }
      const indent = line.x0 - median(xs.slice(Math.max(0, i - 4), i + 5));
      if (!para || isLetterHead(t) || (prevEnds && indent >= INDENT_MIN && indent <= INDENT_MAX)) { flush(); para = []; }
      para.push(t);
      prevEnds = /[.!?:"'”’)\]]$/.test(t);
    });
  });
  flush();
  for (const pc of pieces) if (pc.paragraphs.length < 3) throw new Error(`${vol.file} / ${pc.title}: only ${pc.paragraphs.length} paragraphs — a mis-mapped start page?`);
  return { name: vol.name, pieces };
}

// ---------- bundle ----------

const books = [volumeOne(), volumeTwo(), ...OCR_VOLUMES.map(ocrVolume)];
const pieceCount = books.reduce((n, b) => n + b.pieces.length, 0);
const paragraphs = books.reduce((n, b) => n + b.pieces.reduce((m, pc) => m + pc.paragraphs.length, 0), 0);
if (JSON.stringify(books).includes('Project Gutenberg')) throw new Error('Gutenberg boilerplate leaked into the bundle.');
const bundle = {
  metadata: {
    author: 'John Knox',
    license_note:
      'Public domain. The Works of John Knox, collected and edited by David Laing (Edinburgh, 1846–64). '
      + 'Vol. I from CCEL (Project Gutenberg #21938), Vol. II from Project Gutenberg #40886, Vols. III–VI OCR of '
      + 'Internet Archive items worksofjohnknox03knox, 04knox, 05knox and 06knox.',
    piece_count: pieceCount,
  },
  books,
};
fs.writeFileSync(OUT, JSON.stringify(bundle));
fs.writeFileSync(EXCLUSIONS, exclusions.join('\n') + '\n');
console.log(`${books.length} volumes, ${pieceCount} works, ${paragraphs} paragraphs, ${exclusions.length} exclusions → ${path.relative(process.cwd(), OUT)}`);
if (AUDIT) for (const b of books) {
  console.log(b.name);
  for (const pc of b.pieces) console.log(`  ${pc.title} (${pc.paragraphs.length})`);
}
