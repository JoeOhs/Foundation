// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): compiles Vol. I of the Parker Society "Works of William Tyndale"
// (Doctrinal Treatises, ed. Henry Walter, Cambridge, 1848) into
// public/library/reformation/tyndale-vol1.json, a piece bundle installed by
// src/tyndaleImport.ts through pieceBundleImport.ts.
//
// SOURCES. The University of Toronto scan on the Internet Archive. Its hOCR
// (raw/vol1.hocr) is used only to find each page's text column; the body
// text is that column read afresh by Tesseract (see "Body OCR" below), and
// the marginal notes come from vol1.notes.txt, transcribed and proofread
// against the scans, never from OCR.
// Each note is placed on the paragraph whose line it sits beside, on
// entries.heading, as Luther's and Foxe's sidenotes are.
//
// KEPT AND LEFT OUT. Tyndale's text, and Walter's introductory notices
// (his own matter, introducing each work, the way Laing's notices are kept
// for Knox) as pieces of their own labelled "(Walter)". His Biographical
// Notice is kept as a piece too. Left out and logged to
// tyndale-exclusions.txt: the Advertisement, title pages, contents, running
// heads, sheet signatures, and Walter's footnotes.
//
// NO NETWORK. raw/ is supplied by hand; see README.md.
//
// Usage:
//   node build.mjs              build the bundle and the exclusions log
//   node build.mjs --headings   list every heading-like line, by leaf

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mode, parseHocr, splitPage } from './split.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw');

// ---------------------------------------------------------------------------
// Page reading

const isJunk = (t) => (t.match(/[A-Za-z]/g) ?? []).length < Math.max(2, t.replace(/\s/g, '').length * 0.5);
const SIGNATURE = /^(\[?\s*TYNDALE\.?\s*\]?|\d{1,2}\s*[—–-]\s*\d|[0-9]{1,3}|[ivxlcb]{1,6}\.?)$/i;
const PAGE_NUMBER_AT_END = /^\s*[\dIloO]{1,3}\s|\s[\dIloO]{1,3}\s*$|^[ivxlc]+\s|\s[ivxlc]+\.?\s*$/i;

// Footnotes are set at the foot of the page under a gap, every note opening
// with a marker. The block is the first such gap from the top whose next
// line opens with a marker; all that follows is apparatus. (Luther Vol. III
// separates its notes the same way; see tools/luther/vol3-normalise.mjs.)
//
// The marker carries most of the weight, because size cannot: Tesseract's
// line sizes wobble (short note lines can measure larger than the text,
// leaf 91), and on leaves like 231 the notes fill most of the page.
// Walter's marker is a bracket and one character, the numeral misread as
// anything ("[l", "[¢", "[>", "[I"), or "t1 ", "C1 " where the bracket went;
// in the Biographical Notice it is a bare "1 ". His introductory notices
// open with a bracket and a word ("[THE first …") and never match.
// A speck read as one character can precede the marker ("I [l It", leaf 309).
const MARK = /^\s*(\S\s)?[[(]\s*\S\s/;
const FOOT_START = /^\s*(\S\s)?([[(]\s*\S\s|[tfCLP][1-9!]\s?|[1-9]\s+[A-Z])/;
// A first marker misread past recognition ("[1 Foxe" as "P Foxe") is
// vouched for by a clear "[2" further down the same block.
const LATER_MARK = /^\s*[[(]\s*[2-9]\s/;
const fullLines = (ls) => ls.filter((l) => l.text.split(' ').length >= 6).length;
function splitFootnotes(lines) {
  if (lines.length < 3) return [lines, []];
  // The text's line spacing, from the upper part of the page: lower down,
  // closer-set footnotes can outnumber the text and pass for the spacing,
  // making an ordinary line break look like the gap above a note (leaf 88).
  const top = lines.slice(0, Math.max(4, Math.ceil(lines.length * 0.5)));
  const leading = mode(top.slice(1).map((l, i) => l.y0 - top[i].y0).filter((d) => d > 0), 6)?.at ?? 80;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].y0 - lines[i - 1].y0 < leading * 1.15) continue;
    const after = lines.slice(i), before = lines.slice(0, i);
    // Notes always sit under text, never directly under a title block: the
    // Pathway opens "[I do marvel" with a bracketed drop capital (leaf 88).
    if (fullLines(before) < 1) continue;
    // The text's size is taken from full lines only, so a large title above
    // the gap does not make the text below it look small (leaf 88).
    const sa = mode(after.map((l) => l.size), 2).at;
    const sb = mode(before.filter((l) => l.text.split(' ').length >= 6).map((l) => l.size), 2).at;
    // A clear marker after the gap is enough by itself.
    if (MARK.test(after[0].text) && after[0].indent > 50) return [before, after, false];
    const marked = FOOT_START.test(after[0].text) ||
      // Exactly one stray character: "For", "and", "THE" or "Ix" (the drop
      // capital of "In") above a "[2" note are text (leaves 148, 120, 560, 610).
      (/^\s*\S\s/.test(after[0].text) && after.slice(1, 8).some((l) => LATER_MARK.test(l.text)));
    // A long note can spill over from the page before (leaves 94, 150, 214):
    // the block then opens unmarked, set smaller all the way down to a fresh,
    // bracketed, indented marker (margin debris like "t68" can pass looser
    // tests, leaf 191). Tyndale's own small-type subheads ("Of Order.", leaf
    // 335) fail this, since the text under them is not small. A Walter notice
    // starting mid-page opens "[INTRODUCTORY NOTICE." and is refused, and a
    // spill needs real text above it, never a lone title (leaf 473).
    const firstMark = after.findIndex((l) => l.indent > 50 && MARK.test(l.text));
    // "Small" means under 90% of the text: a text line can measure 92%.
    // Or the spilled note runs on to the foot and closes there with Walter's
    // "]" (leaf 121, Roye's rhymes quoted from leaf 120's note); short verse
    // lines make Tesseract's sizes noisier, so most, not all, must be small.
    const closesAtFoot = firstMark < 0 && /\]\s*$/.test(after.at(-1).text) &&
      after.filter((l) => l.size < sb * 0.9).length >= after.length * 0.8;
    const spill = !marked && ((firstMark > 0 && after.slice(0, firstMark).every((l) => l.size < sb * 0.9)) || closesAtFoot) &&
      !/^\s*\[?\s*[A-Z]{4,}/.test(after[0].text) && fullLines(before) >= 2;
    if (!marked && !spill) continue;
    // Neither the block nor its first line is larger than the text: a title
    // such as "THE PROLOGUE" (leaf 610) can sit above a "[3" note.
    if (sa <= sb && after[0].size <= sb) return [before, after, spill];
  }
  // Last resort: a short note at the very foot whose gap falls just under the
  // threshold (leaves 436, 447, 612). The final one to four lines are taken
  // when, read together, they open with a marker and close with Walter's "]".
  for (let k = 1; k <= 4 && k < lines.length; k++) {
    const tail = lines.slice(-k);
    if (FOOT_START.test(tail[0].text) && /[\]}J]\s*$/.test(tail.at(-1).text) && tail[0].indent > 50) {
      return [lines.slice(0, -k), tail, false];
    }
  }
  return [lines, []];
}

// ---------------------------------------------------------------------------
// Body OCR
//
// The body text is NOT taken from Internet Archive's OCR either. Where a
// margin note sits beside a line, that OCR read the note into the line, so
// its fragments land mid-sentence ("speak evil of it, and do but all the
// shame", leaf 244). Instead each page's text column alone is cropped from
// the page image and read by Tesseract; IA's OCR is used only to find the
// column. The crop runs to 4 px past the column's right edge: wider, and
// the first letters of the margin notes come in as slivers ("obe-:").
// Results are cached in raw/body/, one file per leaf, by `--ocr`.

const BODY_DIR = path.join(RAW, 'body');
function readBodyOcr(leaf) {
  try {
    return JSON.parse(fs.readFileSync(path.join(BODY_DIR, `n${leaf}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// Six Tesseract workers share the queue: about 5 s a page each, so the
// volume takes minutes rather than an hour.
async function ocrBodies(hocr, fallback) {
  const { createWorker, PSM } = await import('tesseract.js');
  fs.mkdirSync(BODY_DIR, { recursive: true });
  const queue = hocr.filter((p) => !readBodyOcr(p.leaf));
  let done = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    const worker = await createWorker('eng', 1, { langPath: RAW, cachePath: RAW, gzip: false });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    try {
      for (let page; (page = queue.shift()); ) await ocrOne(worker, page);
    } finally {
      await worker.terminate();
    }
  }));
  console.log(`body OCR: ${done} pages read`);

  async function ocrOne(worker, page) {
    const layout = splitPage(page).layout ?? (page.lines.length && fallback(page.leaf));
    const img = path.join(RAW, 'img', `n${page.leaf}.jpg`);
    if (!layout || !fs.existsSync(img)) return;
    const rectangle = { left: layout.left - 4, top: 120, width: layout.right - layout.left + 8, height: page.height - 200 };
    const { data } = await worker.recognize(img, { rectangle }, { blocks: true });
    const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines)).map((l) => {
      // A line's type size: the median height of its words, comparable
      // within a page, which is all the footnote and heading tests need.
      const hs = l.words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
      return { y0: l.bbox.y0, x0: l.bbox.x0, x1: l.bbox.x1, size: hs[hs.length >> 1] ?? 0, text: l.text.replace(/\s+/g, ' ').trim() };
    });
    fs.writeFileSync(path.join(BODY_DIR, `n${page.leaf}.json`), JSON.stringify(lines));
    if (++done % 50 === 0) console.log(`  read ${done} pages`);
  }
}

// A short page, the end of a work, has too few full lines for the splitter
// to find its column (leaves 87, 121, 425, 472, 478). It takes the column
// of the page two leaves back, the same side of the spread; without this
// its text would be lost.
function readPage(page, fallback) {
  const r = splitPage(page);
  const layout = r.layout ?? (page.lines.length && fallback?.(page.leaf));
  if (!layout) return null;
  const { left, right } = layout;
  const cached = readBodyOcr(page.leaf);
  if (!cached) throw new Error(`No body OCR for leaf ${page.leaf} — run \`node build.mjs --ocr\` first.`);
  let lines = cached
    .map((l) => ({ y0: l.y0, size: l.size, indent: l.x0 - left, rightGap: right - l.x1, text: l.text.trim() }))
    .filter((l) => l.text && !isJunk(l.text));
  const dropped = [];
  // Fragments of the margin in tiny type that reach into the column ("Jer.",
  // leaf 244) would otherwise break the gap above a footnote. Capitals-only
  // lines are kept: "OF" and "INTO" in a title block are set this small.
  const mainEarly = mode(lines.filter((l) => l.text.split(' ').length >= 6).map((l) => l.size), 2)?.at ?? 0;
  lines = lines.filter((l) => {
    const speck = l.size < mainEarly * 0.75 && l.text.split(' ').length <= 3 && !/^[A-Z ,.]+$/.test(l.text);
    if (speck) dropped.push(['margin fragment', l.text]);
    return !speck;
  });
  // Running head: the first line, if it carries a page number, is set
  // smaller than the text, or is mostly capitals with a digit in
  // it ("[x BIOGRAPHICAL NOTICE [1533—4.", where the numeral was misread).
  // A subhead at the top of a page has no digit. A work's first page has no
  // running head.
  const main = mode(lines.filter((l) => l.text.split(' ').length >= 6).map((l) => l.size), 2)?.at ?? 0;
  const capsShare = (t) => { const a = t.replace(/[^A-Za-z]/g, ''); return a.length ? (a.match(/[A-Z]/g) ?? []).length / a.length : 0; };
  const headLike = (t) => PAGE_NUMBER_AT_END.test(t) || (capsShare(t) > 0.6 && /\d/.test(t));
  if (lines.length && (headLike(lines[0].text) || lines[0].size < main * 0.85) && lines[0].text.length < 70) {
    dropped.push(['running head', lines.shift().text]);
  }
  while (lines.length && SIGNATURE.test(lines.at(-1).text)) dropped.push(['signature', lines.pop().text]);
  const [text, foot, spill] = splitFootnotes(lines);
  for (const l of foot) dropped.push([spill ? "footnote (spilled over)" : "footnote", l.text]);
  // A heading is centred, short, and either set in another size or mostly
  // capitals. Centring alone is not enough: Tyndale's closing paragraphs are
  // sometimes set as a centred, tapering block (leaf 207).
  for (const l of text) {
    const centred = l.indent > 150 && Math.abs(l.indent - l.rightGap) < 160;
    const letters = l.text.replace(/[^A-Za-z]/g, '');
    const caps = letters.length && (letters.match(/[A-Z]/g) ?? []).length / letters.length > 0.6;
    l.caps = !!caps;
    // Tesseract's line size is the median height of its words and wobbles
    // by a quarter either way, so size alone only marks a heading when the
    // line is short and set far larger, as a title is.
    const words = l.text.split(' ').length;
    l.heading = (centred && words <= 10 && (caps || Math.abs(l.size - main) > main * 0.15)) ||
      (words <= 6 && l.size > main * 1.5);
  }
  return { leaf: page.leaf, main, lines: text, dropped };
}

// ---------------------------------------------------------------------------
// The works

// Each piece starts at a leaf and a height on it, found from the volume's
// printed contents and its headings (`node build.mjs --headings`). Many
// prologues begin part-way down a page, so a leaf alone is not enough.
// `check` must appear in the piece's opening lines, so a drifted start
// stops the build instead of silently cutting a work in the wrong place.
// A piece with no title starts matter that is left out.
const G_WALTER = 'Biographical Notice (Walter)';
const G_TREATISES = 'Doctrinal Treatises';
const G_OT = 'Addresses to the Readers and Prologues to the Old Testament';
const G_NT = 'Prologues upon the Gospels and Epistles';
const NOTICE = (work) => `${work}: Introductory Notice (Walter)`;
const PIECES = [
  [14, 0, null, null, 'ADVERTISEMENT'],
  [18, 530, G_WALTER, 'Biographical Notice of William Tyndale (Walter)', 'BIOGRAPHICAL'],
  [84, 500, G_TREATISES, NOTICE('A Pathway into the Holy Scripture'), 'INTRODUCTORY'],
  [88, 520, G_TREATISES, 'A Pathway into the Holy Scripture (1525–32)', 'PATHWAY'],
  [112, 500, G_TREATISES, NOTICE('The Parable of the Wicked Mammon'), 'NOTICE'],
  [118, 440, G_TREATISES, 'The Parable of the Wicked Mammon: To the Reader', 'HITCHINS'],
  [126, 470, G_TREATISES, 'The Parable of the Wicked Mammon (1527)', 'PARABLE'],
  [210, 420, G_TREATISES, NOTICE('The Obedience of a Christian Man'), 'INTRODUCTORY'],
  [212, 450, G_TREATISES, 'The Obedience of a Christian Man: To the Reader', 'HITCHINS'],
  [244, 560, G_TREATISES, 'The Obedience of a Christian Man (1528)', 'Prologue'],
  [427, 720, G_TREATISES, NOTICE('A Brief Declaration of the Sacraments'), 'INTRODUCTORY'],
  [428, 0, G_TREATISES, 'A Brief Declaration of the Sacraments (1536)', 'TREATISE'],
  [469, 1390, G_OT, NOTICE('The Addresses to the Readers'), 'INTRODUCTORY'],
  [470, 590, G_OT, 'Epistle to the Reader, after the New Testament of 1526', 'EPISTLE'],
  [473, 560, G_OT, 'Preface to the Five Books of Moses (1530)', 'FIVE BOOKS'],
  [479, 0, G_OT, 'Prologue to the Book of Genesis (1530)', 'MOSES'],
  [486, 1470, G_OT, 'A Table Expounding Certain Words of Genesis', 'TABLE'],
  [492, 550, G_OT, 'A Prologue into the Second Book of Moses, called Exodus', 'PROLOGUE'],
  [500, 535, G_OT, 'A Table Expounding Certain Words of Exodus', 'TABLE'],
  [502, 540, G_OT, 'A Prologue into the Third Book of Moses, called Leviticus', 'PROLOGUE'],
  [510, 570, G_OT, 'A Prologue into the Fourth Book of Moses, called Numbers', 'PROLOGUE'],
  [522, 565, G_OT, 'A Prologue into the Fifth Book of Moses, called Deuteronomy', 'PROLOGUE'],
  [526, 620, G_OT, 'A Table Expounding Certain Words of Deuteronomy', 'TABLE'],
  [528, 430, G_OT, NOTICE('The Prologue to the Prophet Jonas'), 'JONAS'],
  [530, 540, G_OT, 'The Prologue to the Prophet Jonas (1531)', 'PROLOGUE'],
  [548, 670, G_NT, NOTICE('The Prologues upon the Gospels and Epistles'), 'PROLOGUES'],
  [549, 640, G_NT, 'Prologue upon the Gospel of St Matthew (1525)', 'MATTHEW'],
  [561, 545, G_NT, 'Prologue upon the Gospel of St Mark', 'MARK'],
  [562, 505, G_NT, 'Prologue upon the Gospel of St Luke', 'LUKE'],
  [563, 525, G_NT, 'Prologue upon the Gospel of St John', 'JOHN'],
  [564, 440, G_NT, NOTICE('The Prologue upon the Epistle to the Romans'), 'PROLOGUE'],
  [565, 535, G_NT, 'Prologue upon the Epistle of St Paul to the Romans (1526)', 'PROLOGUE'],
  [592, 440, G_NT, 'Prologue upon the First Epistle to the Corinthians', 'PROLOGUE'],
  [593, 1350, G_NT, 'Prologue upon the Second Epistle to the Corinthians', 'PROLOGUE'],
  [594, 510, G_NT, 'Prologue upon the Epistle to the Galatians', 'PROLOGUE'],
  [595, 510, G_NT, 'Prologue upon the Epistle to the Ephesians', 'PROLOGUE'],
  [595, 2650, G_NT, 'Prologue upon the Epistle to the Philippians', 'PROLOGUE'],
  [596, 1450, G_NT, 'Prologue upon the Epistle to the Colossians', 'PROLOGUE'],
  [597, 545, G_NT, 'Prologue upon the First Epistle to the Thessalonians', 'PROLOGUE'],
  [598, 495, G_NT, 'Prologue upon the Second Epistle to the Thessalonians', 'PROLOGUE'],
  [598, 2915, G_NT, 'Prologue upon the First Epistle to Timothy', 'PROLOGUE'],
  [600, 530, G_NT, 'Prologue upon the Second Epistle to Timothy', 'PROLOGUE'],
  [600, 2285, G_NT, 'Prologue upon the Epistle to Titus', 'PROLOGUE'],
  [601, 1585, G_NT, 'Prologue upon the Epistle to Philemon', 'PROLOGUE'],
  [602, 555, G_NT, 'Prologue upon the Epistle to the Hebrews', 'PROLOGUE'],
  [606, 530, G_NT, 'Prologue upon the Epistle of St James', 'JAMES'],
  [608, 485, G_NT, 'Prologue upon the First Epistle of St Peter', 'PETER'],
  [609, 1340, G_NT, 'Prologue upon the Second Epistle of St Peter', 'PETER'],
  [610, 2590, G_NT, 'Prologue upon the Three Epistles of St John', 'JOHN'],
  [612, 490, G_NT, 'Prologue upon the Epistle of St Jude', 'JUDE'],
  [612, 1890, G_NT, 'An Exposition upon Certain Words and Phrases of the New Testament', 'EXPOSITION'],
];

// ---------------------------------------------------------------------------
// Marginal notes, from the proofread transcription

function readNotes() {
  const src = fs.readFileSync(path.join(HERE, 'vol1.notes.txt'), 'utf8');
  const notes = [];
  for (const block of src.matchAll(/^== leaf (\d+) \|.*\| (draft|checked)\n((?:@.*\n)*)/gm)) {
    if (block[2] !== 'checked') throw new Error(`vol1.notes.txt: leaf ${block[1]} is not proofread yet — refusing to build.`);
    for (const n of block[3].matchAll(/^@(\d+) (.*)$/gm)) notes.push({ leaf: +block[1], y: +n[1], text: n[2] });
  }
  // A note that runs over a page break is one note: "… ought to" + "...judge".
  const joined = [];
  for (const n of notes) {
    const prev = joined.at(-1);
    if (prev?.text.endsWith('...') && n.text.startsWith('...')) prev.text = prev.text.slice(0, -3) + n.text.slice(3);
    else joined.push({ ...n });
  }
  return joined;
}

// ---------------------------------------------------------------------------
// Paragraphs

// Words the body uses, to decide line-end hyphens: "founda-" + "tion" closes
// up because "foundation" is in the text; "belly-" + "cheer" keeps its hyphen.
function vocabularyOf(pages) {
  const v = new Set();
  for (const p of pages) for (const l of p?.lines ?? []) for (const w of l.text.toLowerCase().match(/[a-z]+/g) ?? []) v.add(w);
  return v;
}

function joinLine(acc, line, vocab) {
  const m = /([A-Za-z]+)-$/.exec(acc);
  if (m) {
    const next = /^[A-Za-z]+/.exec(line)?.[0] ?? '';
    return vocab.has((m[1] + next).toLowerCase()) ? acc.slice(0, -1) + line : acc + line;
  }
  return acc ? `${acc} ${line}` : line;
}

// Walter's footnote markers, superscripts the OCR reads into the line:
// "longer1.", "harberous 2, apt", "Pharisees*". Removed only where a digit
// or mark is glued to the end of a word or stands alone after a lowercase
// word; Tyndale cites chapters in roman numerals, so arabic digits there
// are almost always markers.
// ponytail: a genuine arabic numeral after a lowercase word ("for 3
// days") would be lost too; none were seen, and the exclusions log counts them.
let markersRemoved = 0;
function stripMarkers(text) {
  return text
    .replace(/([a-z][’'),.;:!?]?)[0-9*†‡§]{1,2}(?=[\s’'),.;:!?]|$)/g, (_, w) => (markersRemoved++, w))
    .replace(/(\b[a-z]{2,}[,;:]?) [0-9*](?=[\s,.;:])/g, (_, w) => (markersRemoved++, w));
}

function buildPieces(pages, notes) {
  const vocab = vocabularyOf(pages);
  const pieces = [];
  const excluded = [];
  let cur = null, para = null;
  const starts = [...PIECES];
  const endPara = () => {
    if (para && cur) cur.paragraphs.push(para);
    para = null;
  };
  for (const p of pages) {
    if (!p) continue;
    for (const [why, text] of p.dropped) excluded.push(`leaf ${p.leaf} ${why}: ${text}`);
    for (const l of p.lines) {
      while (starts.length && (starts[0][0] < p.leaf || (starts[0][0] === p.leaf && starts[0][1] <= l.y0))) {
        endPara();
        const [leaf, , group, title, check] = starts.shift();
        cur = { leaf, group, title, check, paragraphs: [], opened: false };
        if (title) pieces.push(cur);
      }
      if (!cur) continue;
      const where = { leaf: p.leaf, y: l.y0, text: l.text };
      if (!cur.title) { excluded.push(`leaf ${p.leaf} left out: ${l.text}`); continue; }
      // The title block at a piece's head is its title, already carried as
      // the piece's name; it is checked, then left out.
      if (!cur.opened && (l.heading || l.caps)) {
        cur.head = (cur.head ?? '') + ' ' + l.text;
        excluded.push(`leaf ${p.leaf} title of "${cur.title}": ${l.text}`);
        continue;
      }
      cur.opened = true;
      if (l.heading) {
        endPara();
        cur.paragraphs.push({ text: l.text, lines: [where] });
        continue;
      }
      const prevShort = para?.lastRightGap > 250;
      if (!para || l.indent > 50 || prevShort) {
        endPara();
        para = { text: '', lines: [] };
      }
      para.text = joinLine(para.text, l.text, vocab);
      para.lines.push(where);
      para.lastRightGap = l.rightGap;
    }
  }
  endPara();
  for (const piece of pieces) {
    const opening = (piece.head ?? '') + ' ' + piece.paragraphs.slice(0, 2).map((x) => x.text).join(' ');
    if (!opening.toUpperCase().includes(piece.check.toUpperCase())) {
      throw new Error(`"${piece.title}" (leaf ${piece.leaf}) does not open with "${piece.check}" — its declared start has drifted. Opening: ${opening.slice(0, 160)}`);
    }
  }
  repairLeakedNotes(pieces, vocab, excluded);
  attachNotes(pieces, notes);
  return { pieces, excluded };
}

// Last line of defence against Walter's footnotes. When a page's note block
// is missed, its notes surface as paragraphs opening with a marker, and the
// next page's continuation of Tyndale's paragraph gets glued on after them
// ("[! So C.’s edition, …] right, and that the true fear …"). Tyndale's
// paragraphs never open with a bracket and one character (a piece's first
// paragraph can: the Pathway's drop capital "[I do marvel"), so such a
// paragraph has its bracketed notes removed, and whatever is left is joined
// back onto the paragraph before. One with no closing bracket is dropped
// only when short, and otherwise kept and reported.
const LEAK = /^\s*(\S\s)?[[(]\s*\S\s/;
let leaksKept = [];
function repairLeakedNotes(pieces, vocab, excluded) {
  for (const piece of pieces) {
    const out = [];
    piece.paragraphs.forEach((para, i) => {
      if (i === 0 || !LEAK.test(para.text)) return out.push(para);
      // Notes are stripped only from the lines on the leaf where they stand.
      // A misread or missing "]" must never let the cut run on into the next
      // page's text, which is how leaves 298 and 407 were once swallowed.
      const leaf = para.lines[0].leaf;
      const here = para.lines.filter((l) => l.leaf === leaf);
      const later = para.lines.filter((l) => l.leaf !== leaf);
      let t = here.reduce((acc, l) => joinLine(acc, l.text, vocab), '');
      while (t && LEAK.test(t)) {
        const close = t.indexOf(']');
        const note = close < 0 ? t : t.slice(0, close + 1);
        excluded.push(`leaf ${leaf} footnote (leaked into text): ${note}`);
        t = close < 0 ? '' : t.slice(close + 1).trim();
      }
      const rest = later.reduce((acc, l) => joinLine(acc, l.text, vocab), t);
      if (!rest) return;
      if (LEAK.test(rest)) leaksKept.push(`${piece.title}: ${rest.slice(0, 80)}`);
      const keptLines = t ? para.lines : later;
      const prev = out.at(-1);
      // What survives continues the paragraph the notes interrupted.
      if (prev && !prev.heading) {
        prev.text = joinLine(prev.text, rest, vocab);
        prev.lines.push(...keptLines);
      } else out.push({ ...para, text: rest, lines: keptLines });
    });
    piece.paragraphs = out;
  }
}

// A short note can land inside a paragraph, between two of its lines ("…on
// the outward shining of [3 Thy due.]"). It is a bracket, one non-letter
// marker and a space, closed within 300 characters. Walter's own insertions
// in the text are bracketed words ("[not]", "[Jude, 8.]") and never match.
const INLINE_NOTE = /\s*~?[[(]\s*[0-9!*^}†‡§¢>=+'’]\s[^[\]]{1,300}\]/g;
let inlineNotes = [];
function stripInlineNotes(text) {
  return text.replace(INLINE_NOTE, (m) => (inlineNotes.push(m.trim()), ''));
}

// A note sits beside the body line at its height. It goes on the paragraph
// that line belongs to: the last line on its leaf that starts no lower than
// the note (with a little slack, since a note can start a hair above its
// line). A note above the page's first line belongs to the paragraph that
// carries over onto the page.
function attachNotes(pieces, notes) {
  const index = [];
  for (const piece of pieces) for (const para of piece.paragraphs) for (const ln of para.lines) index.push({ ...ln, para });
  const unplaced = [];
  for (const n of notes) {
    const onLeaf = index.filter((x) => x.leaf === n.leaf);
    if (!onLeaf.length) { unplaced.push(n); continue; }
    const hit = onLeaf.filter((x) => x.y <= n.y + 40).at(-1) ?? onLeaf[0];
    (hit.para.notes ??= []).push(n.text);
  }
  if (unplaced.length) throw new Error(`${unplaced.length} notes sit on leaves with no body text: ${unplaced.map((n) => n.leaf).join(', ')}`);
}

// ---------------------------------------------------------------------------

// Leaves 14–613 hold the text: before them are the covers, title and
// contents; after them the end papers.
const FIRST_LEAF = 14, LAST_LEAF = 613;
const hocr = parseHocr(fs.readFileSync(path.join(RAW, 'vol1.hocr'), 'utf8'))
  .filter((p) => p.leaf >= FIRST_LEAF && p.leaf <= LAST_LEAF);
const byLeaf = new Map(hocr.map((p) => [p.leaf, p]));
const fallback = (leaf) => {
  // Only the five short pages that end a work; any other page without a
  // column is a title page or a blank (leaves 110–111) and is left out.
  if (![87, 121, 425, 472, 478].includes(leaf)) return null;
  const twin = byLeaf.get(leaf - 2) && splitPage(byLeaf.get(leaf - 2)).layout;
  return twin && { left: twin.left, right: twin.right };
};

if (process.argv.includes('--ocr')) {
  await ocrBodies(hocr, fallback);
  process.exit(0);
}

const pages = hocr.map((p) => readPage(p, fallback));

if (process.argv.includes('--headings')) {
  for (const p of pages) {
    if (!p) continue;
    for (const l of p.lines) if (l.heading) console.log(`${String(p.leaf).padStart(4)} ${String(l.y0).padStart(5)} sz${l.size} | ${l.text}`);
  }
  process.exit(0);
}

const notes = readNotes();
const { pieces, excluded } = buildPieces(pages, notes);

const books = [];
for (const piece of pieces) {
  let book = books.at(-1);
  if (book?.name !== piece.group) books.push((book = { name: piece.group, pieces: [] }));
  book.pieces.push({
    title: piece.title,
    paragraphs: piece.paragraphs.map((para) => {
      const text = stripMarkers(stripInlineNotes(para.text));
      // Several notes beside one paragraph read in order down the margin.
      return para.notes ? { text, heading: para.notes.join(' · ') } : text;
    }),
  });
}

const placed = pieces.reduce((n, p) => n + p.paragraphs.reduce((m, x) => m + (x.notes?.length ?? 0), 0), 0);
const bundle = {
  metadata: {
    author: 'William Tyndale',
    license_note:
      'The Works of William Tyndale, Vol. I: Doctrinal Treatises, ed. Henry Walter (Parker Society, Cambridge, 1848). ' +
      'Public domain. Body text from Internet Archive OCR of the University of Toronto scan (doctrinaltreatis00tynduoft); ' +
      'marginal notes transcribed and proofread against that scan.',
    piece_count: pieces.length,
  },
  books,
};
const OUT = path.join(HERE, '..', '..', 'public', 'library', 'reformation', 'tyndale-vol1.json');
fs.writeFileSync(OUT, JSON.stringify(bundle));
fs.writeFileSync(path.join(HERE, 'tyndale-exclusions.txt'),
  [`Footnote markers removed from the text: ${markersRemoved}`, '', ...excluded, ...inlineNotes.map((n) => `footnote (inside a paragraph): ${n}`)].join('\n') + '\n');
if (leaksKept.length) console.log(`Kept, though they open like a footnote (check by hand):\n  ${leaksKept.join('\n  ')}`);
console.log(`${pieces.length} pieces in ${books.length} groups; ${pieces.reduce((n, p) => n + p.paragraphs.length, 0)} paragraphs; ` +
  `${placed} of ${notes.length} notes placed; ${excluded.length} lines excluded; ${markersRemoved} markers removed.`);

// Coverage audit: lines kept per leaf, so a page cut away whole shows up.
if (process.argv.includes('--coverage')) {
  const kept = new Map();
  for (const piece of pieces) for (const para of piece.paragraphs) for (const l of para.lines) kept.set(l.leaf, (kept.get(l.leaf) ?? 0) + 1);
  for (const p of pages) if (p) {
    const n = kept.get(p.leaf) ?? 0;
    if (n < 12) console.log(`leaf ${p.leaf}: ${n} lines kept, ${p.lines.length} read, ${p.dropped.length} dropped`);
  }
}
