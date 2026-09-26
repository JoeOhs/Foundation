// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): parses Heinrich Bullinger's *Decades* in the Parker Society edition
// (trans. H. I., ed. Thomas Harding, Cambridge, 1849–52, "5 v. in 4") into
// public/library/reformation/bullinger.json, the bundle
// src/bullingerDecadesImport.ts installs. Makes no network call: raw/ is
// supplied by hand (see README.md).
//
// The source is OCR: Internet Archive's DjVu XML for four University of
// Toronto scans, which carries each word's box on the page. Unlike the
// Zwingli volume, these blocks routinely run a whole page together —
// running head, heading, body, margin notes and footnotes in one — so the
// page is read line by line, and the printed margin notes are removed by
// position before anything else (see readPage).
//
// Usage:
//   node build.mjs           build the bundle and bullinger-exclusions.txt
//   node build.mjs --audit   also print the Book → Piece outline

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', '..', 'public', 'library', 'reformation', 'bullinger.json');
const EXCLUSIONS = path.join(HERE, 'bullinger-exclusions.txt');
const AUDIT = process.argv.includes('--audit');

const PREFACES = 'Prefaces, Dedications and Biographical Notice';
const DECADES = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH'];
const ORDINALS = ['FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH'];
const DECADE_LINE = new RegExp(`^(${DECADES.join('|')}) DECADE OF SERMONS`);
// "SERMOK", "SERMON," — the OCR's readings of the sermon's ordinal line.
const SERMON_LINE = new RegExp(`^THE (${ORDINALS.join('|')}) SERM\\S{0,3}[.,]?$`);

// Every other boundary, declared rather than inferred, and asserted found in
// order. A line matching `at` either opens a piece in the prefaces book or,
// with `skip`, starts material that is left out until the next marker. The
// decade and sermon lines are recognised generically (above) and checked by
// count instead.
const VOLUMES = [
  { file: 'decadesofhenrybu00bulluoft_djvu.xml', minPages: 450, marks: [
    { at: /^A PREFACE$/, piece: 'A Preface to the Ministry of the Church of England' },
    { at: /^FOUR GENERAL SYNODS OR COUNCILS/, piece: 'Of the Four General Synods or Councils' },
  ] },
  { file: 'decadesofhenrybu03bulluoft_djvu.xml', minPages: 440, marks: [
    { at: /^TO THE MOST RENOWNED$/, piece: 'Dedication of the Third and Fourth Decades to King Edward the Sixth', keep: true },
  ] },
  { file: 'decadesofbulling04bulluoft_djvu.xml', minPages: 420, marks: [] },
  { file: 'decadesofhenrybu05bulluoft_djvu.xml', minPages: 630, marks: [
    { at: /^BIOGRAPHICAL NOTICE$/, piece: 'Biographical Notice of Henry Bullinger (Harding)' },
    { at: /^FIFTY SERMONS$/, skip: 'title page' },
    { at: /^APPENDIX\.?$/, skip: 'appendix contents' },
    { at: /TO THE MOST ILLUSTRIOUS PRINCE/, piece: 'Dedication to Henry Grey, Marquis of Dorset', keep: true },
    { at: /TO THE MOST ILLUSTRIOUS MEN/, piece: 'Dedication to Rodolph Gualter, Josiah Simler and Others', keep: true },
    { at: /^INDEX$/, skip: 'index' },
  ] },
];

// A body line's first-line indent past the lines around it (the scan is
// skewed, so the margin is measured locally). About 95 px on these scans; larger
// offsets are centred lines or specks.
const INDENT_MIN = 40;
const INDENT_MAX = 140;
// Footnotes are a smaller face. Word height over the page's body text, on
// lines of 3+ words in the lower half of the page; most footnotes are also
// caught earlier by their bracketed number ("[4 ...]").
const FOOTNOTE_RATIO = 0.86;
// "[4 ...]", the OCR's readings of its bracket and numeral ("[!", "{!", "[■", "[s "),
// or a numeral lost altogether ("[ Ab evangelicis ...").
const FOOTNOTE_START = /^[[{]\s?([^A-Za-z]|[A-Za-z](\s|$))|^\(\s?\d/;

const dec = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1] ?? 0; };
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const isHeading = (s) => s.length <= 110 && /[A-Z]{3}/.test(s) && (s.match(/[a-z]/g) ?? []).length <= 2;
const titleCase = (s) => s.toLowerCase().replace(/(^\W*|\. )(\w)/g, (_, p, c) => p + c.toUpperCase())
  .replace(/\b(god|christ|jesus|holy ghost|spirit|trinity|lord|jews|church of england)\b/g,
    (w) => w.replace(/\b\w/g, (c) => c.toUpperCase()));

// One page's lines with the margin notes removed. The column is the median
// left and right edge of the page's full lines; a word wholly outside it is
// a margin note (Bullinger's printed sidenotes, the translator's scripture
// references), whether the OCR gave it a block of its own or ran it into a
// body line.
function readPage(pageXml, height) {
  const lines = [...pageXml.matchAll(/<LINE>([\s\S]*?)<\/LINE>/g)].map((line) =>
    [...line[1].matchAll(/<WORD coords="(\d+),(\d+),(\d+),(\d+)[^>]*>([^<]*)<\/WORD>/g)]
      .map((w) => ({ x0: +w[1], bottom: +w[2], x1: +w[3], top: +w[4], t: dec(w[5]) }))
      .filter((w) => w.t.trim()))
    .filter((l) => l.length);
  const full = lines.filter((l) => l.length >= 6);
  const margins = [];
  let kept = lines;
  if (full.length >= 5) {
    const left = median(full.map((l) => l[0].x0));
    const right = median(full.map((l) => l.at(-1).x1));
    kept = lines.map((l) => l.filter((w) => {
      const inside = w.x1 >= left - 15 && w.x0 <= right + 12;
      if (!inside) margins.push(w.t);
      return inside;
    })).filter((l) => l.length);
  }
  const bodyH = median(full.filter((l) => l[0].top < height * 0.7).flatMap((l) => l.map((w) => w.bottom - w.top)));
  return {
    margins,
    lines: kept.map((l) => ({
      x0: l[0].x0,
      top: l[0].top,
      text: norm(l.map((w) => w.t).join(' ')),
      ratio: l.length >= 3 && bodyH ? median(l.map((w) => w.bottom - w.top)) / bodyH : 1,
    })),
  };
}

// Joins a paragraph's lines, closing up words the compositor hyphenated at
// the line end, and strips the OCR's footnote markers ("then®", "flesh®.”").
// ponytail: every line-end hyphen is closed up, so a genuine compound broken
// at its hyphen ("lively-/expressed") loses it; a dictionary check is the upgrade.
function joinLines(lines) {
  return lines.map((l) => l.replace(/^[•;:\-'](?=[a-z])/, ''))
    .reduce((acc, l) => (/[a-z]-$/.test(acc) ? acc.slice(0, -1) + l : `${acc} ${l}`))
    .replace(/(\S)[®*^†‡§¹²³⁴⁵⁶⁷⁸⁹]+(?=[\s.,;:!?”’"']|$)/g, '$1')
    .replace(/\s[*†‡§^•®]+(?=\s|$)/g, '')
    .replace(/\s+([;:,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// A sermon's capitals subject heading as a title: its line-end hyphens
// closed up (joinLines only closes lower-case ones), a scan speck before the
// opening word ("C OF THE HOLY", "IF OF THE LORD'S") and the "THE FOURTH
// DECADE" running head the OCR ran into one of them dropped.
const subjectTitle = (lines) => joinLines(lines)
  .replace(/([A-Z])- ([A-Z])/g, '$1$2')
  .replace(/^.*?(?=\b(OF|THAT|WITHOUT)\b)/, '')
  .replace(/^OF THE \w+ DECADE, /, '')
  .replace(/[?‘]+(?=,)|(?<=[A-Z]) ?\d(?=[, ])/g, '') // footnote markers
  .replace(/ OP THE | SINGING\.\. |&5C|LIKENT\^SS|SALVATION\}|SPRINGETII|MEANLNG|EATLNG|DETERMTNETH/g,
    (m) => TITLE_FIXES[m])
  .replace(/NEITHEB.*?: /, 'NEITHER HAVE ')
  .replace(/[.,]$/, '');
// The OCR's misreadings in the fifty sermon titles, corrected by hand.
const TITLE_FIXES = {
  ' OP THE ': ' OF THE ', ' SINGING.. ': ' SINGING, ',
  '&5C': '&C', 'LIKENT^SS': 'LIKENESS', 'SALVATION}': 'SALVATION', 'SPRINGETII': 'SPRINGETH',
  MEANLNG: 'MEANING', EATLNG: 'EATING', DETERMTNETH: 'DETERMINETH',
};

// A page's top line is a running head when it carries a page number
// (arabic or roman) or the decade's "[SERM." tag.
const isRunningHead = (s) => /[A-Z]{3}/.test(s) && (s.match(/[a-z]/g) ?? []).length <= 3
  && (/(^|\s)[\dIVXLCl]{1,5}[.\]]*(\s|$)|\bSERM|DECADE/.test(s));

function build() {
  const books = [];
  const excluded = [];
  const exclude = (why, text) => excluded.push(`[${why}] ${text.slice(0, 90)}`);
  const bookNamed = (name) => {
    let b = books.find((x) => x.name === name);
    if (!b) books.push((b = { name, pieces: [] }));
    return b;
  };

  let piece = null;       // null = skipping
  let skipWhy = 'front matter';
  let para = null;        // lines of the paragraph being built
  let heading = [];       // pending all-capitals lines
  let decade = -1;
  let sermon = -1;
  let prevEnds = true;    // the last body line ended a sentence

  const flushPara = () => {
    if (para && piece) piece.paragraphs.push(joinLines(para));
    para = null;
  };
  const flushHeading = () => {
    if (heading.length && piece) { flushPara(); piece.paragraphs.push(joinLines(heading)); }
    heading = [];
  };
  const open = (bookName, title) => {
    flushPara();
    piece = { title, paragraphs: [] };
    bookNamed(bookName).pieces.push(piece);
    prevEnds = true;
  };

  for (const vol of VOLUMES) {
    const file = path.join(HERE, 'raw', vol.file);
    if (!fs.existsSync(file)) throw new Error(`Missing ${file} — see README.md.`);
    const xml = fs.readFileSync(file, 'utf8');
    const pages = [...xml.matchAll(/<OBJECT[^>]*height="(\d+)"[\s\S]*?<\/OBJECT>/g)];
    if (pages.length < vol.minPages) throw new Error(`${vol.file}: only ${pages.length} pages — truncated download?`);
    let mark = 0;
    flushPara(); flushHeading();
    piece = null; skipWhy = 'front matter';

    pages.forEach((page, pageIndex) => {
      const { lines, margins } = readPage(page[0], +page[1]);
      if (margins.length && piece) exclude(`margin ${vol.file.slice(0, 16)} p.${pageIndex}`, margins.join(' '));
      let inFootnotes = false;
      // Body lines on this page, with their neighbours' x0 for the indent test.
      const xs = lines.map((l) => l.x0);

      lines.forEach((line, i) => {
        const t = line.text;
        const next = vol.marks[mark];
        if (next && next.at.test(t)) {
          mark += 1;
          heading = [];
          if (next.skip) { flushPara(); piece = null; skipWhy = next.skip; return exclude(next.skip, t); }
          open(PREFACES, next.piece);
          if (next.keep) heading.push(t);
          return;
        }
        const d = t.match(DECADE_LINE);
        if (d) {
          decade += 1;
          if (DECADES[decade] !== d[1]) throw new Error(`Expected the ${DECADES[decade]} decade, found "${t}"`);
          flushPara();
          piece = null; skipWhy = 'decade title';
          heading = [];
          sermon = -1;
          return;
        }
        const s = t.match(SERMON_LINE);
        if (s && decade >= 0) {
          sermon += 1;
          if (ORDINALS[sermon] !== s[1]) {
            throw new Error(`${DECADES[decade]} decade: expected the ${ORDINALS[sermon]} sermon, found "${t}"`);
          }
          const subject = heading.filter((h) => !/WRITTEN BY|BULLINGER|^THE$/.test(h));
          heading = [];
          if (!subject.length) throw new Error(`${DECADES[decade]} decade, ${s[1]} sermon: no subject heading above it`);
          open(`The ${titleCase(DECADES[decade])} Decade`,
            `Sermon ${sermon + 1}. ${titleCase(subjectTitle(subject))}`);
          return;
        }
        // A decade's first sermon: its subject heading sits between the
        // decade title and the sermon line.
        if (!piece && skipWhy === 'decade title' && isHeading(t)) { heading.push(t); return; }
        if (!piece) return exclude(skipWhy, t);
        if (i <= 1 && isRunningHead(t)) return exclude('running head', t);
        if (/^[\dIVXLCl]{1,5}$/.test(t)) return exclude('page number', t);
        if (!inFootnotes) {
          // "Lat.]" closes the editor's Latin glosses; body text never has it.
          inFootnotes = FOOTNOTE_START.test(t) || /^\[[A-Z]{4,}\.?$/.test(t) || /\bLat\.[\]j]/.test(t)
            || (line.ratio < FOOTNOTE_RATIO && line.top > page[1] * 0.5 && !isHeading(t));
        }
        if (inFootnotes) return exclude(`footnote ${vol.file.slice(0, 16)} p.${pageIndex}`, t);

        if (isHeading(t)) { flushPara(); heading.push(t); prevEnds = true; return; }
        flushHeading();
        const margin = median(xs.slice(Math.max(0, i - 4), i + 5));
        const indent = line.x0 - margin;
        const starts = indent >= INDENT_MIN && indent <= INDENT_MAX && prevEnds;
        if (!para || starts) { flushPara(); para = []; }
        para.push(t);
        prevEnds = /[.!?:"'”’)\]]$/.test(t);
      });
    });
    flushPara(); flushHeading();
    if (mark !== vol.marks.length) {
      throw new Error(`${vol.file}: marker ${vol.marks[mark].at} not found`);
    }
  }

  if (decade !== DECADES.length - 1) throw new Error(`Found ${decade + 1} of 5 decades`);
  for (const b of books) {
    if (b.name !== PREFACES && b.pieces.length !== 10) throw new Error(`${b.name}: ${b.pieces.length} sermons, expected 10`);
    for (const p of b.pieces) if (p.paragraphs.length === 0) throw new Error(`${b.name} / ${p.title} is empty`);
  }
  return { books, excluded };
}

const { books, excluded } = build();
const paragraphs = books.reduce((n, b) => n + b.pieces.reduce((m, p) => m + p.paragraphs.length, 0), 0);
const bundle = {
  metadata: {
    author: 'Heinrich Bullinger',
    license_note:
      'Public domain. The Decades of Henry Bullinger, translated by H. I., '
      + 'edited for the Parker Society by Thomas Harding (Cambridge University '
      + 'Press, 1849–52). OCR of Internet Archive items decadesofhenrybu00bulluoft, '
      + 'decadesofhenrybu03bulluoft, decadesofbulling04bulluoft and decadesofhenrybu05bulluoft.',
    piece_count: books.reduce((n, b) => n + b.pieces.length, 0),
  },
  books,
};
fs.writeFileSync(OUT, JSON.stringify(bundle));
fs.writeFileSync(EXCLUSIONS, excluded.join('\n') + '\n');
console.log(`${books.length} books, ${bundle.metadata.piece_count} pieces, ${paragraphs} paragraphs, `
  + `${excluded.length} exclusions → ${path.relative(process.cwd(), OUT)}`);
if (AUDIT) for (const b of books) {
  console.log(b.name);
  for (const p of b.pieces) console.log(`  ${p.title} (${p.paragraphs.length})`);
}
