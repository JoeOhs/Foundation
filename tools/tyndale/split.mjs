// Margin splitter for the Parker Society Tyndale (run with `node split.mjs`,
// outside the Tauri app). It finds the body column in the Internet Archive
// hOCR, then re-reads the margin from the page image with Tesseract, because
// the hOCR lost most of the marginal notes' words (see README.md). It writes
// a report; it builds no bundle and touches no database.
//
// WHY PER WORD. Unlike the Luther Vol. III scan, Tesseract merged each
// marginal note into the body line beside it here: a line's bbox runs from
// the body's left edge clean across into the margin. Luther's line-level
// isMarginLine() therefore finds nothing, and the split has to be made on
// word boxes against the body column's edges.
//
// RE-OCR. For every leaf whose full-resolution image is in the volume's
// image folder (n<leaf>.jpg), the margin strip is OCR'd on its own and each
// note is repaired and checked. Notes the checks can't vouch for are
// flagged; the flagged list is what gets read by hand. Leaves without an
// image are split but not re-read, so a sample can be measured without
// fetching every page.
//
// NO NETWORK. The OCR files, the page images and Tesseract's eng.traineddata
// are all supplied locally under raw/ (gitignored). See README.md.
//
// Usage:
//   node split.mjs [--vol 2]                  write the volume's report
//   node split.mjs [--vol 2] 195 210 ...      print the notes for those leaves only

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorker, PSM } from 'tesseract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');

// Vol. II has no hOCR on Internet Archive, only DjVu XML. Its word boxes are
// in the served page image's own pixels (checked on leaves 120 and 300:
// ~70 matched words each within 1 px), though the DjVu page box is larger
// than the image (2118 × 3362 against 1992 × 3328).
const VOLUMES = {
  1: { name: 'Vol. I', ocr: 'vol1.hocr', parse: (raw) => parseHocr(raw), img: 'img', report: 'split-report.txt' },
  2: { name: 'Vol. II', ocr: 'vol2.djvu.xml', parse: (raw) => parseDjvu(raw), img: 'img2', report: 'split-report-vol2.txt' },
};
const volArg = process.argv.indexOf('--vol');
const VOL = VOLUMES[volArg >= 0 ? process.argv[volArg + 1] : 1];
if (!VOL) {
  console.error(`Unknown volume. Known: ${Object.keys(VOLUMES).join(', ')}`);
  process.exit(1);
}
const OCR_PATH = path.join(RAW_DIR, VOL.ocr);
const IMG_DIR = path.join(RAW_DIR, VOL.img);
const REPORT_PATH = path.join(__dirname, VOL.report);

const LINE_RE =
  /<span class="ocr_line"[^>]*? title="bbox (\d+) (\d+) (\d+) (\d+);[^"]*"[^>]*>([\s\S]*?)<\/span>\s*(?=<span class="ocr_line"|<\/p>)/g;
const WORD_RE =
  /<span class="ocrx_word"[^>]*? title="bbox (\d+) (\d+) (\d+) (\d+);[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const flat = (html) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

function parseHocr(raw) {
  const pages = [];
  for (const chunk of raw.split(/(?=<div class="ocr_page")/)) {
    const box = /^<div class="ocr_page"[^>]*title="bbox 0 0 (\d+) (\d+)/.exec(chunk);
    if (!box) continue;
    const lines = [];
    LINE_RE.lastIndex = 0;
    let m;
    while ((m = LINE_RE.exec(chunk)) !== null) {
      const words = [];
      WORD_RE.lastIndex = 0;
      let w;
      while ((w = WORD_RE.exec(m[5])) !== null) {
        const text = flat(w[5]);
        if (text) words.push({ x0: +w[1], y0: +w[2], x1: +w[3], y1: +w[4], text });
      }
      if (words.length) lines.push({ y0: +m[2], y1: +m[4], words });
    }
    pages.push({ leaf: pages.length, width: +box[1], lines });
  }
  return pages;
}

// DjVu XML: one <OBJECT> per leaf, words as coords="left,bottom,right,top".
function parseDjvu(raw) {
  return raw.split('<OBJECT ').slice(1).map((chunk, leaf) => {
    const lines = [...chunk.matchAll(/<LINE>([\s\S]*?)<\/LINE>/g)]
      .map((l) => [...l[1].matchAll(/<WORD coords="(\d+),(\d+),(\d+),(\d+)[^"]*"[^>]*>([^<]*)<\/WORD>/g)]
        .map((w) => ({ x0: +w[1], y1: +w[2], x1: +w[3], y0: +w[4], text: decode(w[5]).trim() }))
        .filter((w) => w.text))
      .filter((words) => words.length)
      .map((words) => ({ y0: Math.min(...words.map((w) => w.y0)), y1: Math.max(...words.map((w) => w.y1)), words }));
    return { leaf, width: +(/width="(\d+)"/.exec(chunk)?.[1] ?? 0), lines };
  });
}

// The most common value. This edition is justified, so
// the body's right edge is where most lines end and its left edge where most
// lines start (indents and short lines are the minority). A median would be
// dragged by the margin words this script is trying to separate.
// Fixed bins split a cluster that straddles a bin boundary, so this counts a
// sliding ±`tol` window and returns the densest one's median.
function mode(values, tol = 8) {
  const v = [...values].sort((a, b) => a - b);
  let best = null;
  for (let i = 0, j = 0; i < v.length; i++) {
    while (v[i] - v[j] > 2 * tol) j++;
    if (!best || i - j + 1 > best.n) best = { n: i - j + 1, lo: j, hi: i };
  }
  return best ? { at: v[(best.lo + best.hi) >> 1], n: best.n } : null;
}

// Slack past the body edge before a word counts as marginal. The gutter on
// this scan is ~25 px (body ends ≈2023, notes start ≈2047), so this has to
// stay well under that; justified lines overshoot the edge by a few px.
const SLACK = 12;

function splitPage(page) {
  // A line's last *body* word is unknown until the split is made (the
  // gutter is narrower than any page-fraction cut-off), so the edges are
  // taken over every word: justified line ends pile up at one x, while
  // mid-line word edges and margin words spread out.
  const words = page.lines.flatMap((l) => l.words);
  const left = mode(words.map((w) => w.x0));
  const right = mode(words.map((w) => w.x1));
  // Too few lines agreeing means no justified body column: a title page,
  // plate, or blank leaf. So does a column under half the page wide: on the
  // contents page (Vol. I leaf 12) the dotted leaders produced an 84 px one.
  // Report it rather than guessing.
  if (!left || !right || right.n < 8 || right.at - left.at < page.width * 0.5) return { leaf: page.leaf, layout: null };

  // Tesseract clips word boxes at the column boundary, so a left-margin
  // word ends exactly where the body starts (x1 == left) and a body word's
  // box often runs on across the gutter to where the right margin starts.
  const body = [], margin = [];
  let leftWords = 0, rightWords = 0;
  for (const l of page.lines) {
    const b = [];
    for (const w of l.words) {
      if (w.x0 >= right.at + SLACK) margin.push(w), rightWords++;
      else if (w.x1 <= left.at + 4) margin.push(w), leftWords++;
      else b.push(w);
    }
    if (b.length) body.push(b.map((w) => w.text).join(' '));
  }
  // The text block's vertical extent, from lines long enough to be body
  // text: this keeps the running head, page number and signature mark
  // ("[TYNDALE.]") out of the margin crop.
  const long = page.lines.filter((l) => l.words.length >= 6);
  const layout = {
    left: left.at,
    right: right.at,
    width: page.width,
    top: Math.min(...long.map((l) => l.y0)) - 30,
    bottom: Math.max(...long.map((l) => l.y1)) + 30,
    // The outer margin alternates with the leaf. Read from where the margin
    // words actually are, never from page parity: one missing leaf would
    // invert parity for the rest of the volume.
    side: rightWords + leftWords === 0 ? null : rightWords >= leftWords ? 'right' : 'left',
  };
  return { leaf: page.leaf, layout, body, notes: groupNotes(margin) };
}

// Margin words → notes. Words are first rebuilt into margin lines by their
// vertical position, then lines are joined into a note while the next line
// starts within ~1.6 body leadings of the previous one. Luther found spacing
// unreliable for this; this prototype uses it only to make the report
// readable, and the hand check is what decides whether it is good enough.
function groupNotes(words) {
  const lines = [];
  for (const w of [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.y0 - last.y0) < 25) last.words.push(w);
    else lines.push({ y0: w.y0, words: [w] });
  }
  const notes = [];
  for (const l of lines) {
    const text = l.words.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(' ');
    const last = notes[notes.length - 1];
    if (last && l.y0 - last.yEnd < 130) last.text += ' ' + text, (last.yEnd = l.y0);
    else notes.push({ y0: l.y0, yEnd: l.y0, text });
  }
  return notes.map(({ y0, text }) => ({ y0, text }));
}

// ---------------------------------------------------------------------------
// Re-OCR of the margin

// The margin strip, in the hOCR's own coordinates (the full-resolution page
// image is the same 2574 × 4134 the hOCR was made from), from `inset` px
// outside the body edge out to the leaf's edge.
//
// No single inset is safe. The gutter runs from ~25 px down to ~15 px, and
// the body edge found from the hOCR can sit a few px past the ink: 6 px
// still cut the first letter off every note line on leaf 244, while 3 px
// catches slivers of the body's punctuation on leaf 196 ("1 Cor." read as
// "liCor"). So each margin is read at both INSETS and each note keeps the
// reading the checks find fewer problems in.
const INSETS = [3, 10];
function marginRect({ left, right, width, top, bottom, side }, inset) {
  const [x0, x1] = side === 'right' ? [right + inset, width - 20] : [20, left - inset];
  return { left: x0, top, width: x1 - x0, height: bottom - top };
}

// Tesseract lines → notes. A note ends at its attribution mark (every topic
// gloss in this edition ends "W. T." or "Ant. ed."), and a Scripture
// citation is a note on its own. Failing either, a vertical gap of more than
// ~1.6 margin lines starts a new note: inside a note the small type runs at
// about two lines per body line, and notes are set against the body line
// they annotate, so the gap between notes is at least a full body leading.
function groupOcrLines(lines) {
  const pitch = median(lines.slice(1).map((l, i) => l.y0 - lines[i].y0).filter((d) => d > 0)) || 44;
  const notes = [];
  let prev = null;
  for (const l of lines) {
    const cur = notes[notes.length - 1];
    // A bare mark belongs to the gloss above it however far below it sits:
    // the mark is set flush under the gloss's last line, and Tesseract's
    // box for small capitals often starts low.
    const orphanMark = cur && !cur.closed && !isCitation(cur.lines[0].text) && isBareMark(l.text);
    if (!orphanMark && (!cur || cur.closed || isCitation(l.text) || l.y0 - prev.y0 > pitch * 1.6)) {
      notes.push({ y0: l.y0, lines: [l], closed: false });
    } else {
      cur.lines.push(l);
    }
    notes[notes.length - 1].closed = isCitation(l.text) || markOf(l.text).mark !== null;
    prev = l;
  }
  return notes;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[s.length >> 1];
}

// The attribution mark is set in small capitals, which Tesseract reads worst
// of anything on the page: "W. T." has come back as "WwW. bs", "We Es",
// "Were.", "WT". There are only two marks, so a short tail is repaired to
// whichever it can only be. A line counts as a bare mark when it is at most
// 7 visible characters and starts with W (or V, Tesseract's other reading
// of the small-cap W), unless it is two or more real words: "When God" is
// the first line of a gloss on leaf 244. A mark can also close the last
// line of the gloss ("trine. W.T.").
function isBareMark(text) {
  const t = text.trim();
  if (/^Ant\b.{0,6}$/i.test(t)) return true;
  if (!/^[WV]/.test(t) || t.replace(/\s/g, '').length > 7) return false;
  const words = t.split(/\s+/);
  return words.length < 2 || !words.every(isCommon);
}

function markOf(text) {
  const t = text.trim();
  if (/^Ant\b.{0,6}$/i.test(t)) return { gloss: '', mark: 'Ant. ed.' };
  if (isBareMark(t)) return { gloss: '', mark: 'W. T.' };
  let m = /^(.*?[.,])\s*(Ant\.?\s*ed\.?)$/i.exec(t);
  if (m) return { gloss: m[1], mark: 'Ant. ed.' };
  // After the gloss's closing stop, a short tail starting W ("W.T.", "W. 2").
  m = /^(.*?[.,])\s*([WV]\S{0,2}\s?\S{0,2})$/.exec(t);
  if (m) return { gloss: m[1], mark: 'W. T.' };
  return { gloss: t, mark: null };
}

// "Rom. ii.", "1 Cor. iii.", "John i.", "Matt. v. & x." — this edition cites
// by book and roman chapter (a short book name takes no stop), sometimes
// with an arabic verse. The book must be an abbreviation of a real one:
// "We. I." (a misread mark) and "er. xliv" ("Jer." with its J cropped) have
// the shape but name nothing.
const CHAPTER = '[ivxlcIVXLC1lmnu]{1,8}[.,]?';
const CITATION = new RegExp(
  `^(?:([123I])\\s?)?([A-Z][a-z]{1,6})(?:[.,]\\s*|\\s+)${CHAPTER}(?:\\s*&\\s*${CHAPTER})*(?:\\s*\\d{1,3}[.,]?)?$`,
);
const BOOKS = (
  'genesis exodus leviticus numbers deuteronomy joshua judges ruth samuel kings chronicles ezra nehemiah ' +
  'esther job psalms proverbs ecclesiastes canticles isaiah jeremiah lamentations ezekiel daniel hosea joel ' +
  'amos obadiah jonah micah nahum habakkuk zephaniah haggai zechariah malachi matthew mark luke john acts ' +
  'romans corinthians galatians ephesians philippians colossians thessalonians timothy titus philemon ' +
  'hebrews james peter jude revelation apocalypse esdras tobit judith wisdom ecclesiasticus baruch maccabees'
).split(' ');
// An abbreviation is the book's first letters ("Isai.", "Matt.", "Joh.").
const namesBook = (abbr) => BOOKS.some((b) => b.startsWith(abbr.toLowerCase()));
function isCitation(text) {
  const m = CITATION.exec(text.trim());
  return !!m && namesBook(m[2]);
}

const ROMAN = /^(?=[ivxlc])c?(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;

// Each check that fails adds a flag; a flagged note is read by hand.
// `score` counts the suspect words, to choose between two readings.
function checkNote(note) {
  const flags = [];
  let score = 0;
  const lines = note.lines.map((l) => l.text.trim());
  if (lines.length === 1 && isCitation(lines[0])) {
    const book = CITATION.exec(lines[0]);
    const chapters = lines[0].slice(book.index + book[0].indexOf(book[2]) + book[2].length).match(/[A-Za-z0-9]+/g) ?? [];
    for (const c of chapters.filter((c) => !/^\d+$/.test(c))) {
      if (!ROMAN.test(c.toLowerCase())) flags.push(`chapter "${c}" is not a roman numeral`), score++;
    }
    return { kind: 'citation', text: lines[0], flags, score };
  }
  // "Ant. ed." can break across the last two lines ("ness. Ant." / "ed.").
  if (lines.length > 1 && /^ed\.?$/i.test(lines[lines.length - 1]) && /Ant\.?$/.test(lines[lines.length - 2])) {
    lines.splice(-2, 2, `${lines[lines.length - 2]} ed.`);
  }
  const tail = markOf(lines[lines.length - 1]);
  const body = tail.mark ? [...lines.slice(0, -1), tail.gloss].filter(Boolean) : lines;
  // Join hyphenated line breaks only where the joined word is one the
  // volume uses ("founda-" + "tion"); otherwise keep the hyphen.
  let text = '';
  for (const l of body) {
    const m = /(\S+)-$/.exec(text);
    const joined = m && (m[1] + l.split(/\s+/)[0]).toLowerCase().replace(/[^a-z']/g, '');
    if (m && isWord(joined)) text = text.slice(0, -1) + l;
    else {
      if (m) flags.push(`hyphen does not join: ${m[1]}-${l.split(/\s+/)[0]}`), score++;
      text += (text ? ' ' : '') + l;
    }
  }
  // Words the print itself sets without a space ("Godrequireth",
  // "throughJesus") are split where they segment into common words. This
  // is a repair, not a flag, so it is listed separately in the report.
  const repairs = [];
  text = text.replace(/[A-Za-z’']{4,}/g, (w) => {
    if (isWord(w)) return w;
    const split = segment(w);
    if (split) repairs.push(`${w} → ${split}`);
    return split ?? w;
  });
  // A missing mark is not flagged: some treatises' glosses carry none.
  // Two-letter words are checked too: "py" for "plainly" passed when only
  // words of three letters or more were.
  const unknown = (text.match(/[A-Za-z’']{2,}/g) ?? []).filter((w) => !isWord(w));
  if (unknown.length) flags.push(`not in body text: ${unknown.join(', ')}`), (score += unknown.length);
  const lookalikes = (text.match(/[A-Za-z’']{3,}/g) ?? []).map(lookalike).filter(Boolean);
  if (lookalikes.length) flags.push(`may be a misread: ${lookalikes.join(', ')}`), (score += lookalikes.length);
  // A lone lowercase letter other than "a" is a word that lost its glyphs
  // ("ment o scripture" for "ment of scripture").
  const stray = text.match(/(?<![A-Za-z’'])[b-z](?![A-Za-z’'])/g);
  if (stray) flags.push(`stray letter: ${stray.join(', ')}`), (score += stray.length);
  // Glosses use letters, digits and ordinary punctuation only; anything else
  // ("*", "©", "™", "|") is a speck or a misread glyph.
  const symbols = text.match(/[^A-Za-z0-9\s.,;:?!'’‘“”"()&-]/g);
  if (symbols) flags.push(`odd symbol: ${symbols.join(' ')}`), (score += symbols.length);
  // Confidence is judged on the gloss only: the attribution mark was
  // already repaired by rule, and its small capitals always score low.
  const glossWords = new Set(text.split(/\s+/));
  const weak = note.lines.flatMap((l) => l.words).filter((w) => w.confidence < 60 && glossWords.has(w.text));
  if (weak.length) flags.push(`low confidence: ${weak.map((w) => w.text).join(', ')}`), (score += weak.length);
  return { kind: 'gloss', text: tail.mark ? `${text} ${tail.mark}` : text, flags, score, repairs };
}

// How often each word occurs in the volume's body text: the reference for
// judging what the margin OCR produced. Filled once in main(), before any
// margin is read.
let vocabulary = new Map();

function bodyVocabulary(results) {
  const v = new Map();
  for (const r of results)
    for (const line of r.body ?? [])
      for (const w of line.toLowerCase().match(/[a-z']{2,}/g) ?? []) v.set(w, (v.get(w) ?? 0) + 1);
  return v;
}

const countOf = (w) => vocabulary.get(w.toLowerCase().replace(/’/g, "'").replace(/[^a-z']/g, '')) ?? 0;
const isWord = (w) => countOf(w) > 0;
// The body text's own OCR has junk in it ("te" occurs 8 times), so where a
// decision rests on a word being real, it must also be common.
const isCommon = (w) => countOf(w) >= 20;

// Splits a run-together word into two or three common words, preferring the
// fewest pieces: "restis" → "rest is", "Spirittojudge" → "Spirit to judge".
// Pieces of two letters must be one of the short words the glosses use, so
// junk can't be used to make a split.
const SHORT = new Set('is to of in an as at be by he it me my no on or so up us we ye do go'.split(' '));
function segment(word) {
  const piece = (p) => (p.length === 2 ? SHORT.has(p.toLowerCase()) : p.length > 2 && isCommon(p));
  for (let i = 2; i < word.length - 1; i++) {
    if (piece(word.slice(0, i)) && piece(word.slice(i))) return `${word.slice(0, i)} ${word.slice(i)}`;
  }
  for (let i = 2; i < word.length - 3; i++) {
    for (let j = i + 2; j < word.length - 1; j++) {
      const [a, b, c] = [word.slice(0, i), word.slice(i, j), word.slice(j)];
      if (piece(a) && piece(b) && piece(c)) return `${a} ${b} ${c}`;
    }
  }
  return null;
}

// A real word can still be a misread: "Jaw" occurs 3 times in the body, but
// swapping the J for the l Tesseract confuses it with gives "law", which
// occurs 769 times. Flagged when one such swap gives a word at least 50
// times as common. Only this scan's usual confusions are tried.
const CONFUSIONS = [['j', 'l'], ['i', 'l'], ['l', 'i'], ['c', 'e'], ['e', 'c'], ['h', 'b'], ['b', 'h'], ['rn', 'm'], ['u', 'n'], ['n', 'u'], ['f', 't'], ['t', 'f']];
function lookalike(word) {
  const w = word.toLowerCase();
  const n = countOf(w);
  if (!n) return null;
  for (const [from, to] of CONFUSIONS) {
    for (let i = w.indexOf(from); i >= 0; i = w.indexOf(from, i + 1)) {
      const alt = w.slice(0, i) + to + w.slice(i + from.length);
      if (countOf(alt) >= 50 * n) return `${word} (${alt}?)`;
    }
  }
  return null;
}

// Returns the leaf's notes, or null when its page image hasn't been supplied.
async function reread(worker, r) {
  const img = path.join(IMG_DIR, `n${r.leaf}.jpg`);
  try {
    await fs.access(img);
  } catch {
    return null;
  }
  const readings = [];
  for (const inset of INSETS) readings.push(await readMargin(worker, img, r.layout, inset));
  return pickReadings(...readings);
}

// Pairs the notes of two readings by height (a note starts within 40 px in
// both) and keeps the one with fewer suspect words; the wider crop wins a
// tie, since it can't contain body slivers. A note only one reading found
// is kept as it is.
function pickReadings(tight, wide) {
  const used = new Set();
  const out = tight.map((n) => {
    const twin = wide.find((m) => !used.has(m) && Math.abs(m.y0 - n.y0) < 40);
    if (!twin) return n;
    used.add(twin);
    return n.score < twin.score ? n : twin;
  });
  return [...out, ...wide.filter((m) => !used.has(m))].sort((x, y) => x.y0 - y.y0);
}

async function readMargin(worker, img, layout, inset) {
  const { data } = await worker.recognize(img, { rectangle: marginRect(layout, inset) }, { blocks: true });
  const lines = (data.blocks ?? [])
    .flatMap((b) => b.paragraphs.flatMap((p) => p.lines))
    .map((l) => {
      // Drop punctuation slivers of the body's line ends caught at the
      // crop's inner edge (see INSETS).
      const words = layout.side === 'right'
        ? l.words.filter((w, i) => i > 0 || /[A-Za-z0-9]/.test(w.text))
        : l.words.filter((w, i) => i < l.words.length - 1 || /[A-Za-z0-9]/.test(w.text));
      return { y0: l.bbox.y0, text: words.map((w) => w.text).join(' '), words };
    })
    .filter((l) => /[A-Za-z]/.test(l.text))
    .sort((a, b) => a.y0 - b.y0);
  // Specks of scan noise read as a lone letter ("A", "i", "k") are dropped:
  // no note in this edition is shorter than a two-letter word.
  return groupOcrLines(lines)
    .filter((n) => n.lines.map((l) => l.text).join('').replace(/[^A-Za-z]/g, '').length >= 2)
    .map((n) => ({ y0: n.y0, ...checkNote(n) }));
}

async function main() {
  let raw;
  try {
    raw = await fs.readFile(OCR_PATH, 'utf8');
  } catch (err) {
    console.error(`Cannot read ${OCR_PATH}: ${err.message}\nSee README.md for how to fetch it.`);
    process.exit(1);
  }
  const results = VOL.parse(raw).map(splitPage);
  vocabulary = bodyVocabulary(results);

  // Leaves named on the command line are printed, and only they are re-read.
  const only = process.argv.slice(2).filter((a, i, all) => all[i - 1] !== '--vol').map(Number).filter(Number.isInteger);
  const chosen = only.length ? only.map((n) => results[n]).filter(Boolean) : results;

  const worker = await createWorker('eng', 1, { langPath: RAW_DIR, cachePath: RAW_DIR, gzip: false });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
  try {
    for (const r of chosen) if (r.layout?.side) r.ocr = await reread(worker, r);
  } finally {
    await worker.terminate();
  }

  if (only.length) {
    for (const r of chosen) {
      console.log(`\n===== leaf ${r.leaf} ${r.layout ? `body ${r.layout.left}–${r.layout.right}` : '(no body column)'}`);
      if (!r.layout) continue;
      r.notes.forEach((n) => console.log(`  [IA   y=${n.y0}] ${n.text}`));
      for (const n of r.ocr ?? []) {
        console.log(`  [OCR  y=${n.y0}] ${n.text}`);
        n.flags.forEach((f) => console.log(`      ! ${f}`));
        (n.repairs ?? []).forEach((f) => console.log(`      ~ joined: ${f}`));
      }
    }
    return;
  }

  const laid = results.filter((r) => r.layout);
  const notes = laid.reduce((n, r) => n + r.notes.length, 0);
  const ocrNotes = results.flatMap((r) => (r.ocr ?? []).map((n) => ({ leaf: r.leaf, ...n })));
  const flagged = ocrNotes.filter((n) => n.flags.length);
  const out = [
    `Tyndale ${VOL.name} margin split — ${results.length} leaves, ${laid.length} with a body column`,
    `margin notes located in IA OCR: ${notes}`,
    `re-OCR'd: ${results.filter((r) => r.ocr).length} leaves, ${ocrNotes.length} notes, ${flagged.length} flagged for hand reading`,
    '',
    ...ocrNotes.map((n) =>
      [
        `${String(n.leaf).padStart(4)}  ${n.flags.length ? '!' : ' '} ${n.text}`,
        ...n.flags.map((f) => `          ! ${f}`),
        ...(n.repairs ?? []).map((f) => `          ~ joined: ${f}`),
      ].join('\n'),
    ),
    '',
    'leaf  left  right  notes',
    ...results.map((r) =>
      r.layout
        ? `${String(r.leaf).padStart(4)}  ${String(r.layout.left).padStart(4)}  ${String(r.layout.right).padStart(5)}  ${String(r.notes.length).padStart(5)}`
        : `${String(r.leaf).padStart(4)}  (no body column)`,
    ),
  ];
  await fs.writeFile(REPORT_PATH, out.join('\n') + '\n');
  console.log(out.slice(0, 3).join('\n'));
}

main();
