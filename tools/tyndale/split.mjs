// Margin-splitter prototype for the Parker Society Tyndale (run with
// `node split.mjs`, outside the Tauri app). This is the "next step" in
// ROADMAP.md's Tyndale entry: measure whether the marginal glosses can be
// recovered from the Internet Archive hOCR before scoping a build. It writes
// a report; it builds no bundle and touches no database.
//
// WHY PER WORD. Unlike the Luther Vol. III scan, Tesseract merged each
// marginal note into the body line beside it here: a line's bbox runs from
// the body's left edge clean across into the margin. Luther's line-level
// isMarginLine() therefore finds nothing, and the split has to be made on
// word boxes against the body column's edges.
//
// Usage:
//   node split.mjs                  report on every page of raw/vol1.hocr
//   node split.mjs 195 210          print body/margin for those leaves

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOCR_PATH = path.join(__dirname, 'raw', 'vol1.hocr');
const REPORT_PATH = path.join(__dirname, 'split-report.txt');

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
      if (words.length) lines.push({ y0: +m[2], words });
    }
    pages.push({ leaf: pages.length, width: +box[1], lines });
  }
  return pages;
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
  // plate, or blank leaf. Report it rather than guessing.
  if (!left || !right || right.n < 8) return { leaf: page.leaf, layout: null };

  // Tesseract clips word boxes at the column boundary, so a left-margin
  // word ends exactly where the body starts (x1 == left) and a body word's
  // box often runs on across the gutter to where the right margin starts.
  const body = [], margin = [];
  for (const l of page.lines) {
    const b = [];
    for (const w of l.words) {
      if (w.x0 >= right.at + SLACK || w.x1 <= left.at + 4) margin.push(w);
      else b.push(w);
    }
    if (b.length) body.push(b.map((w) => w.text).join(' '));
  }
  return { leaf: page.leaf, layout: { left: left.at, right: right.at }, body, notes: groupNotes(margin) };
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

async function main() {
  let raw;
  try {
    raw = await fs.readFile(HOCR_PATH, 'utf8');
  } catch (err) {
    console.error(`Cannot read ${HOCR_PATH}: ${err.message}\nSee README.md for how to fetch it.`);
    process.exit(1);
  }
  const results = parseHocr(raw).map(splitPage);

  const [from, to] = process.argv.slice(2).map(Number);
  if (Number.isInteger(from)) {
    for (const r of results.slice(from, (to ?? from) + 1)) {
      console.log(`\n===== leaf ${r.leaf} ${r.layout ? `body ${r.layout.left}–${r.layout.right}` : '(no body column)'}`);
      if (!r.layout) continue;
      r.notes.forEach((n) => console.log(`  [margin y=${n.y0}] ${n.text}`));
    }
    return;
  }

  const laid = results.filter((r) => r.layout);
  const notes = laid.reduce((n, r) => n + r.notes.length, 0);
  const out = [
    `Tyndale Vol. I margin split — ${results.length} leaves, ${laid.length} with a body column`,
    `margin notes found: ${notes}`,
    '',
    'leaf  left  right  notes',
    ...results.map((r) =>
      r.layout
        ? `${String(r.leaf).padStart(4)}  ${String(r.layout.left).padStart(4)}  ${String(r.layout.right).padStart(5)}  ${String(r.notes.length).padStart(5)}`
        : `${String(r.leaf).padStart(4)}  (no body column)`,
    ),
  ];
  await fs.writeFile(REPORT_PATH, out.join('\n') + '\n');
  console.log(out.slice(0, 2).join('\n'));
}

main();
