// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): parses Samuel Macauley Jackson's *Selected Works of Huldreich
// Zwingli* (University of Pennsylvania, Philadelphia, 1901) into
// public/library/reformation/zwingli.json, the bundle src/zwingliImport.ts
// installs. Makes no network call: raw/ is supplied by hand (see README.md).
//
// The source is OCR. No transcription of this volume exists, so the input
// is Internet Archive's DjVu XML for `translationsrepr01pennuoft`, which
// carries each word's box on the page. Type size is what separates the
// footnotes from the reading text — see FOOTNOTE_PITCH.
//
// Usage:
//   node build.mjs           build the bundle
//   node build.mjs --audit   also print the Work → Section outline

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAW = path.join(HERE, 'raw', 'translationsrepr01pennuoft_djvu.xml');
const OUT = path.join(HERE, '..', '..', 'public', 'library', 'reformation', 'zwingli.json');
const EXCLUSIONS = path.join(HERE, 'zwingli-exclusions.txt');
const AUDIT = process.argv.includes('--audit');

// Footnotes are set in smaller type on a tighter line pitch. Measured as
// baseline-to-baseline distance over page-image height (×1000) across every
// paragraph of 3+ lines: footnotes 16–23.3, body 24–25. Pitch is used rather
// than a word-height ratio to the page's median, because Jackson's editorial
// notes fill whole pages in places and drag the median down to their size.
// Over one or two lines pitch is too noisy to trust (21.5 on a body line,
// 24.0 on a footnote), so those fall back to word height against the page's
// body text (see readPages) — and also inherit footnote status from above.
const FOOTNOTE_PITCH = 23.5;
const FOOTNOTE_RATIO = 0.93;

// Every work boundary, declared rather than inferred, and asserted present
// exactly once and in order. `locator` is the start of the printed title as
// the OCR reads it (whitespace-normalised) — "Y." is the OCR's reading of
// "V." and is pinned deliberately, so a re-OCR'd scan stops the build
// instead of silently re-cutting the volume. `sections` are the printed
// headings that open a new section inside the work; every other all-capitals
// line (speaker names in the Disputation, the 67 Articles' topic headings)
// is kept as a paragraph of its own above the text it labels.
const WORKS = [
  { locator: 'PREFACE.', book: 'Preface and Introduction', piece: 'Preface (Jackson)', sections: {
    'INTRODUCTION.': 'Introduction (Jackson)' } },
  { locator: 'I. LETTER OF HULDREICH ZWINGLI TO ERASMUS',
    book: 'I. Visit of the Episcopal Delegation to Zurich, April 1522',
    piece: 'Letter of Zwingli to Erasmus Fabricius', sections: {} },
  { locator: 'II. PETITION OF CERTAIN PREACHERS OF SWITZER',
    book: 'II. Petition of Eleven Priests to be Allowed to Marry, July 1522',
    piece: 'The Petition', sections: {} },
  { locator: 'III. ACTS OF THE CONVENTION HELD IN THE PRAISE',
    book: 'III. Acts of the First Zurich Disputation, January 1523',
    piece: 'The Opening of the Disputation', sections: {
      'ANSWER OF THE VICAR TO THE WORDS OF MASTER ULRICH.': 'Answer of the Vicar to the Words of Master Ulrich',
      'ANSWER OF MASTER ULRICH.': 'Answer of Master Ulrich',
      'THE SIXTY-SEVEN ARTICLES OF ZWINGLI.': 'The Sixty-seven Articles of Zwingli' } },
  { locator: 'IV. ORDINANCE AND NOTICE.',
    book: 'IV. Zurich Marriage Ordinance, 1525', piece: 'The Ordinance', sections: {
      'EXPLANATION OF THIS ORDINANCE.': 'Explanation of this Ordinance',
      'EXCEPTIONS TO THE LAW.': 'Exceptions to the Law',
      'WHAT CAN NULLIFY AND BREAK UP A MARRIAGE.': 'What Can Nullify and Break Up a Marriage' } },
  { locator: 'Y. REFUTATION OF THE TRICKS OF THE BAPTISTS',
    book: 'V. Refutation of the Tricks of the Catabaptists, 1527',
    piece: 'Dedication to All the Ministers of the Gospel', sections: {
      "HULDREICH ZWINGLl'S REFUTATION AGAINST THE TRICKS OF THE CATABAPTISTS.": 'First Part',
      'SECOND PART.': 'Second Part',
      'PART THIRD.': 'Third Part',
      'APPENDIX.': 'Appendix',
      'PERORATION.': 'Peroration' } },
];
// The publisher's series advertisements that follow the last work.
const BACK_MATTER = 'TRANSLATIONS AND REPRINTS';
// The table of contents and the half-title after it, between the
// Introduction and the first work ("OK" is the OCR's "OF").
const CONTENTS = 'TABLE OK CONTENTS';

// Running heads: the work's short title and a page number, both liable to
// misreading ("a 6 ZWINGLI SELECl'IONS."). Only tested on a page's first two
// blocks, since a speck of scan noise sometimes comes first.
const RUNNING_HEAD = new RegExp(
  '^.{0,8}?(\\S+ SEL\\S*|PREFACE|INTRODUCTION|THE EPISCOPAL VISITATION|PERMISSION TO MARRY'
  + '|THE FIRST ZURICH DISPUTATION|MATTERS CONCERNING MARRIAGE|REFUTATION \\S+ BA\\S+ TRICKS)[.,]?[\\dIOl$*^?.! ]*$');
const PAGE_NUMBER = /^\(?[\dIOl ]{1,5}\)?$/;

const dec = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1] ?? 0; };
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const isHeading = (s) => s.length <= 110 && /[A-Z]{3}/.test(s) && (s.match(/[a-z]/g) ?? []).length <= 2;

// The DjVu blocks often run several printed paragraphs together — a whole
// page of the Refutation's alternating "Catabaptists." / "Reply." can arrive
// as one block. The printed paragraph is recovered from its first-line
// indent, measured against the lines around it rather than a fixed margin
// because the scan is skewed (the left edge drifts ~15 px down a page). The
// indent is 45–55 px; much larger offsets are specks the OCR took for a
// letter, so a break also needs the line above to end a sentence.
const INDENT_MIN = 30;
const INDENT_MAX = 80;
function splitAtIndents(lines) {
  const x0s = lines.map((l) => l[0].x0);
  const parts = [[]];
  lines.forEach((line, i) => {
    const margin = median(x0s.slice(Math.max(0, i - 4), i + 5));
    const indent = x0s[i] - margin;
    const prev = lines[i - 1]?.at(-1).t.trim() ?? '';
    if (i > 0 && indent >= INDENT_MIN && indent <= INDENT_MAX && /[.!?:"'”)\]]$/.test(prev)) parts.push([]);
    parts.at(-1).push(line);
  });
  return parts;
}

function readPages() {
  if (!fs.existsSync(RAW)) throw new Error(`Missing ${RAW} — see README.md.`);
  const xml = fs.readFileSync(RAW, 'utf8');
  const pages = [...xml.matchAll(/<OBJECT[^>]*height="(\d+)"[\s\S]*?<\/OBJECT>/g)].map((page) =>
    [...page[0].matchAll(/<PARAGRAPH>([\s\S]*?)<\/PARAGRAPH>/g)].flatMap((para) => {
      const lines = [...para[1].matchAll(/<LINE>([\s\S]*?)<\/LINE>/g)].map((line) =>
        [...line[1].matchAll(/<WORD coords="(\d+),(\d+),\d+,(\d+)[^>]*>([^<]*)<\/WORD>/g)]
          .map((w) => ({ x0: +w[1], bottom: +w[2], h: +w[2] - +w[3], t: dec(w[4]) })))
        .filter((l) => l.length);
      const baselines = lines.map((l) => median(l.map((w) => w.bottom)));
      const measures = {
        heights: lines.flat().map((w) => w.h),
        pitch: lines.length < 3 ? null
          : (median(baselines.slice(1).map((b, i) => b - baselines[i])) / +page[1]) * 1000,
      };
      // Each part carries the whole block's measurements: type size is a
      // property of the block, and a two-line tail would measure noisily.
      return splitAtIndents(lines).map((part) => ({
        ...measures, lines: part.map((l) => norm(l.map((w) => w.t).join(' '))),
      }));
    }).filter((p) => p.lines.length));
  if (pages.length < 270) throw new Error(`Only ${pages.length} pages — truncated download?`);
  // Short paragraphs are measured against the page's confirmed body text
  // (3+ lines at body pitch) where it has any, else against the page median.
  for (const paras of pages) {
    const body = paras.filter((p) => p.pitch >= FOOTNOTE_PITCH);
    const reference = median((body.length ? body : paras).flatMap((p) => p.heights));
    for (const p of paras) p.ratio = median(p.heights) / reference;
  }
  return pages;
}

// Joins a paragraph's lines, closing up words the compositor hyphenated at
// the line end, and strips the OCR's footnote markers and its line-start
// specks ("•of", ";gist").
// ponytail: every line-end hyphen is closed up, so a genuine compound broken
// at its hyphen ("simple-/minded") loses it; a dictionary check is the upgrade.
function joinLines(lines) {
  return lines.map((l) => l.replace(/^[•;:\-'](?=[a-z])/, ''))
    .reduce((acc, l) => (/[a-z]-$/.test(acc) ? acc.slice(0, -1) + l : `${acc} ${l}`))
    .replace(/\s[*†‡§^•]+(?=\s|$)/g, '')
    .replace(/([a-z.,;:])[*^†‡]+(?=\s|$)/g, '$1')
    .replace(/\s+([;:,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/^LXVIL /, 'LXVII. ') // the last Article's numeral, misread
    .trim();
}

function build() {
  const pages = readPages();
  const books = [];
  const excluded = [];
  let work = -1;
  let book = null;
  let piece = null;
  let label = [];
  let done = false;
  let inContents = false;
  let lastPara = null;
  let pageStart = false;

  const exclude = (why, text) => excluded.push(`[${why}] ${text.slice(0, 90)}`);
  const flushLabel = () => {
    if (label.length && piece) piece.paragraphs.push(label.join(' — '));
    label = [];
  };
  const openPiece = (title) => {
    flushLabel();
    piece = { title, paragraphs: [] };
    book.pieces.push(piece);
    lastPara = null;
  };

  const addParagraph = (text) => {
    // A paragraph broken by the page turn (footnotes and running heads in
    // between are already gone): the page's first text follows one that
    // stopped mid-sentence, or anything opens in lower case.
    const prev = lastPara === null ? '' : piece.paragraphs[lastPara];
    const continues = /^[a-z]/.test(text) || (pageStart && !/[.!?:;"'’”)\]]$/.test(prev));
    pageStart = false;
    if (lastPara !== null && !label.length && continues) {
      piece.paragraphs[lastPara] = /[a-z]-$/.test(prev) ? prev.slice(0, -1) + text : `${prev} ${text}`;
      return;
    }
    flushLabel();
    lastPara = piece.paragraphs.push(text) - 1;
  };

  pages.forEach((paras, pageIndex) => {
    pageStart = true;
    let inFootnotes = false;
    paras.forEach((p, i) => {
      const raw = norm(p.lines.join(' '));
      if (done) return exclude('back matter', raw);
      const next = WORKS[work + 1];
      if (next && raw.startsWith(next.locator)) {
        flushLabel();
        inContents = false;
        work += 1;
        book = { name: next.book, pieces: [] };
        books.push(book);
        openPiece(next.piece);
        // The printed title, which for the petitions runs to a paragraph of
        // its own, rides on the first paragraph as its label.
        if (next.locator !== 'PREFACE.') label.push(joinLines(p.lines));
        return;
      }
      if (work >= 0 && raw.startsWith(BACK_MATTER)) { done = true; return exclude('back matter', raw); }
      if (work < 0) return exclude('front matter', raw);
      if (raw.startsWith(CONTENTS)) inContents = true;
      if (inContents) return exclude('contents', raw);
      // Before the running-head test: "INTRODUCTION." opening its page is
      // both, and the section wins.
      const section = WORKS[work].sections[raw];
      if (section) return openPiece(section);
      if (i <= 1 && p.lines.length === 1 && RUNNING_HEAD.test(raw)) return exclude('running head', raw);
      if (p.lines.length === 1 && PAGE_NUMBER.test(raw)) return exclude('page number', raw);
      // Headings are set in small capitals, as small as the footnotes, so
      // they are recognised by case before the footnote test sees them.
      const text = joinLines(p.lines);
      if (p.lines.length === 1 && isHeading(text)) { label.push(text.replace(/^\//, '')); return; }
      // A leading footnote marker ("t" is the OCR's dagger) is also enough.
      // Once the footnotes begin, a short paragraph below them is footnote
      // too; only one measured confidently at body pitch ends the run.
      const small = p.pitch !== null ? p.pitch < FOOTNOTE_PITCH : p.ratio < FOOTNOTE_RATIO;
      const marked = /^([*•†‡§£]|t(?=\s?\[))\s?[["A-Z]|^t [A-Z]/.test(text);
      inFootnotes = small || marked || (inFootnotes && p.pitch === null);
      if (inFootnotes) return exclude(`footnote p.${pageIndex}`, raw);

      addParagraph(text);
    });
  });
  flushLabel();

  if (work !== WORKS.length - 1) {
    throw new Error(`Found ${work + 1} of ${WORKS.length} works — next missing: ${WORKS[work + 1].locator}`);
  }
  WORKS.forEach((w, wi) => {
    const found = new Set(books[wi].pieces.map((p) => p.title));
    for (const title of Object.values(w.sections)) {
      if (!found.has(title)) throw new Error(`${w.book}: section "${title}" not found`);
    }
  });
  for (const b of books) for (const p of b.pieces) {
    if (p.paragraphs.length === 0) throw new Error(`${b.name} / ${p.title} is empty`);
  }
  return { books, excluded };
}

const { books, excluded } = build();
const paragraphs = books.reduce((n, b) => n + b.pieces.reduce((m, p) => m + p.paragraphs.length, 0), 0);
const articles = books[3].pieces.at(-1).paragraphs.filter((t) => /^[IVXL]+\. /.test(t)).length;
// The 67 Articles are the reason most readers will open this volume; a count
// short of 67 means an article was merged into its neighbour or dropped.
if (articles !== 67) throw new Error(`Expected 67 Articles, found ${articles}`);

const bundle = {
  metadata: {
    author: 'Huldrych Zwingli',
    license_note:
      'Public domain. Selected Works of Huldreich Zwingli, ed. Samuel Macauley Jackson, trans. '
      + 'Lawrence A. McLouth, Henry Preble and George W. Gilmore (University of Pennsylvania, '
      + 'Philadelphia, 1901). OCR of Internet Archive item translationsrepr01pennuoft.',
    piece_count: books.reduce((n, b) => n + b.pieces.length, 0),
  },
  books,
};
fs.writeFileSync(OUT, JSON.stringify(bundle));
fs.writeFileSync(EXCLUSIONS, excluded.join('\n') + '\n');
console.log(`${books.length} books, ${bundle.metadata.piece_count} sections, ${paragraphs} paragraphs, `
  + `${articles} articles, ${excluded.length} exclusions → ${path.relative(process.cwd(), OUT)}`);
if (AUDIT) for (const b of books) {
  console.log(b.name);
  for (const p of b.pieces) console.log(`  ${p.title} (${p.paragraphs.length})`);
}
