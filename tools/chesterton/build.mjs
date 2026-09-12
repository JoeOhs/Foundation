// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads the four Project Gutenberg texts that make up G.K.
// Chesterton's Christian apologetics, parses each one's chapter structure,
// strips Gutenberg's boilerplate and the transcribers' own front/back
// matter, and writes chesterton.json — a bundle shaped to feed Foundation's
// compound-work import (one source, four books, a 2-level toc_entries
// hierarchy). Download-and-clean only: does not touch src-tauri/, src/db.ts
// or src/importer.ts, and is not part of the app runtime.
//
// SCOPE — read before adding a title below.
// This source is Chesterton's *apologetics and theology* only. His detective
// fiction (Father Brown), his poetry and his general social criticism are
// deliberately out of scope: they are fine books, but they are not what this
// shelf is for, and folding them in would make the Library row mean nothing.
//
// LICENCE — public domain, and guarded rather than assumed. Every title here
// was published in 1925 or earlier and is public domain in the US; Project
// Gutenberg's own vetting is the trust basis, the same one the Josephus and
// Fox's Book of Martyrs bundles rely on. The build refuses any file that
// doesn't carry Gutenberg's licence boilerplate AND name Chesterton as its
// author — so a mis-typed ebook number fails loudly instead of shipping
// somebody else's book, and a still-copyrighted title can't be slipped in by
// adding a row to TITLES.
//
// Two later titles are deliberately NOT here: St. Thomas Aquinas (1933) and
// The Catholic Church and Conversion (1926). Neither is on Gutenberg as of
// this build, and Aquinas in particular sits close enough to the rolling US
// public-domain cutoff that it must not be eyeballed. If they are added
// later, assertGutenbergPublicDomain() below is the gate that decides it —
// not manual judgement.
//
// Resumable: raw text is cached under raw/, so a re-run skips files already
// downloaded.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const OUTPUT_PATH = path.join(__dirname, 'chesterton.json');
const DEPLOY_PATH = path.join(
  __dirname, '..', '..', 'public', 'library', 'apologetics', 'chesterton.json',
);
const REQUEST_DELAY_MS = 800;
const USER_AGENT =
  'FoundationChestertonBuilder/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

// The four works, in publication order — which is also the order they read
// best, Heretics and Orthodoxy being a matched pair (Orthodoxy was written
// as the answer to critics of Heretics).
//
// Each has its own `parse`, because the four Gutenberg transcriptions mark
// their chapters four different ways and there is no honest common regex:
// Heretics uses a bare "I. Title" line, Orthodoxy "CHAPTER I.--_Title_",
// The Everlasting Man a "CHAPTER I" line with the title beneath, and St.
// Francis an indented "_Chapter I_" / "_Title_" pair. Sniffing across them
// would be guesswork; four small named parsers are honest about it.
const TITLES = [
  { id: 'heretics', title: 'Heretics', year: 1905, gutenbergId: 470, parse: parseHeretics },
  { id: 'orthodoxy', title: 'Orthodoxy', year: 1908, gutenbergId: 16769, parse: parseOrthodoxy },
  {
    id: 'everlasting-man',
    title: 'The Everlasting Man',
    year: 1925,
    gutenbergId: 65688,
    parse: parseEverlastingMan,
  },
  {
    id: 'st-francis',
    title: 'St. Francis of Assisi',
    year: 1923,
    gutenbergId: 63084,
    parse: parseStFrancis,
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, { retries = 2, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr?.message ?? lastErr}`);
}

async function loadRaw(work, refetch) {
  const cachePath = path.join(RAW_DIR, `${work.gutenbergId}.txt`);
  if (!refetch) {
    try {
      const cached = await fs.readFile(cachePath, 'utf8');
      if (cached.length > 1000) return cached;
    } catch {
      /* not cached yet */
    }
  }
  // Gutenberg serves the same text under two path shapes depending on the
  // book's vintage; try the modern one first.
  const urls = [
    `https://www.gutenberg.org/cache/epub/${work.gutenbergId}/pg${work.gutenbergId}.txt`,
    `https://www.gutenberg.org/files/${work.gutenbergId}/${work.gutenbergId}-0.txt`,
  ];
  let text = null;
  let lastErr;
  for (const url of urls) {
    try {
      text = await fetchText(url);
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!text) throw new Error(`Could not download ${work.title}: ${lastErr?.message ?? lastErr}`);
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(cachePath, text, 'utf8');
  await sleep(REQUEST_DELAY_MS);
  return text;
}

// Hard gate on licence and authorship — see the header note. Gutenberg
// states the licence in its own header boilerplate rather than in a metadata
// field; if that wording is gone, the file is not a release this bundle is
// allowed to ship, and the build fails rather than quietly importing it.
//
// This is also the gate that decides any *future* title. Adding a row to
// TITLES is not enough to ship a text: a work still in copyright is not on
// Gutenberg at all, so the download fails, and a file that is there but
// isn't Chesterton's fails the author check below.
function assertGutenbergPublicDomain(work, raw) {
  // Matched against whitespace-normalised text, never the raw file. Every
  // phrase below spans more than one word, and Gutenberg hard-wraps its
  // boilerplate at ~72 columns, so a wrap falling inside a phrase makes a
  // raw-text regex fail on a perfectly good file. Normalising first is what
  // makes this guard about the wording rather than about the line breaks.
  const flat = (chunk) => chunk.replace(/\s+/g, ' ');
  const header = flat(raw.slice(0, 8000));
  const footer = flat(raw.slice(-25000));

  // PG has re-generated its boilerplate over the years and these four files
  // span three decades of releases (1996–2021), so rather than pin one
  // wording this matches the stems every revision has kept — and
  // case-insensitively, since "eBook" became "ebook" in the rewrite.
  const LICENSE_MARKERS = [
    /for the use of anyone anywhere/i,
    /THE FULL PROJECT GUTENBERG LICENSE/i,
    /Project Gutenberg(?:-tm)? License/i,
  ];
  if (!LICENSE_MARKERS.some((re) => re.test(header) || re.test(footer))) {
    throw new Error(
      `PG ${work.gutenbergId} (${work.title}) carries none of Project Gutenberg's licence ` +
      'markers (the "for the use of anyone anywhere" grant, or the full licence section). ' +
      'Refusing to build: only text confirmed to ship under the PG licence may be bundled.',
    );
  }

  // Authorship, not translation, is the risk here: Chesterton wrote in
  // English, so there is no translator to get wrong, but a mistyped ebook
  // number lands on somebody else's book entirely. Gutenberg's header
  // spells him "G. K. Chesterton", older files sometimes "G.K. Chesterton".
  if (!/Author: G\.\s*K\.\s*Chesterton/i.test(header)) {
    throw new Error(
      `PG ${work.gutenbergId} does not declare "Author: G. K. Chesterton" in its Gutenberg ` +
      `header — wrong ebook number for ${work.title}? Refusing to build.`,
    );
  }

  // And that it is the book we asked for, not another Chesterton title.
  const wanted = work.title.replace(/^(The|A)\s+/i, '').replace(/\./g, '\\.?');
  if (!new RegExp(`Title: .*${wanted}`, 'i').test(header)) {
    throw new Error(
      `PG ${work.gutenbergId} header does not name "${work.title}" — wrong file? Refusing to build.`,
    );
  }
}

// Strips Gutenberg's own boilerplate, leaving just the book.
function stripGutenbergWrapper(raw) {
  // The St. Francis transcription sets non-breaking spaces inside
  // abbreviations ("St.\u00a0Francis"); normalised here so the rest of the
  // script only ever sees ordinary spaces.
  let text = raw.replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
  const start = text.match(/\*\*\*\s*START OF TH[EI][^\n]*\*\*\*/i);
  if (start) text = text.slice(text.indexOf(start[0]) + start[0].length);
  // Two end-marker vintages, and St. Francis carries BOTH — the older
  // "End of Project Gutenberg's …" line sits above the modern starred
  // banner. Cutting at whichever appears first is what keeps that line out
  // of the book's closing paragraph.
  const ends = [
    text.match(/\*\*\*\s*END OF TH[EI][^\n]*\*\*\*/i),
    text.match(/^End of (?:the )?Project Gutenberg.*$/im),
  ]
    .filter(Boolean)
    .map((m) => text.indexOf(m[0]));
  if (ends.length > 0) text = text.slice(0, Math.min(...ends));
  return text;
}

// Gutenberg's plain-text transcriptions mark the printed italics with
// underscores. Foundation stores entries.text as plain text, so the markers
// would render literally; the emphasis is dropped rather than carried into a
// markup convention entries.text doesn't have. Deliberately bounded to a
// single line's worth so a stray underscore can't swallow a paragraph.
function stripItalicMarkers(text) {
  return text.replace(/_([^_\n]{1,300})_/g, '$1');
}

function normalizeParagraph(text) {
  return stripItalicMarkers(
    text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' '),
  ).trim();
}

// Splits a chapter's body lines into paragraphs on blank lines. All four
// transcriptions separate paragraphs this way, so unlike the chapter
// headings there is a genuine common rule here.
function paragraphsFrom(lines) {
  const out = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length === 0) return;
    const text = normalizeParagraph(buffer.join('\n'));
    if (text) out.push(text);
    buffer = [];
  };
  for (const line of lines) {
    if (line.trim() === '') flush();
    else buffer.push(line);
  }
  flush();
  return out;
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function romanToInt(s) {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN[s[i]] ?? 0;
    const next = ROMAN[s[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

// Minor words that stay lower-case inside a title (never first or last).
const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of',
  'on', 'or', 'the', 'to', 'with',
]);

function titleCase(s) {
  // The Everlasting Man's and St. Francis's headings are set in full caps;
  // Heretics' and Orthodoxy's already carry their printed casing. Only an
  // all-caps heading is recased, so "Mr. H. G. Wells", "St. Francis" and
  // "Le Jongleur de Dieu" are left exactly as their transcription has them.
  if (!/[A-Z]/.test(s) || /[a-z]/.test(s)) return s;
  const words = s.toLowerCase().split(/\s+/);
  return words
    .map((w, i) => (
      i > 0 && i < words.length - 1 && MINOR_WORDS.has(w)
        ? w
        : w.replace(/^([a-z])/, (_, c) => c.toUpperCase())
    ))
    .join(' ');
}

// Accumulates { label, title, lines } chapters as a parser walks a file.
// `label` is the citation shown in the reading column ("Chapter 3",
// "Part 2, Chapter 1", "Appendix 1", "Prefatory Note"); `title` is the
// chapter's own name, empty for a section that has none.
function chapterCollector() {
  const chapters = [];
  let current = null;
  return {
    open(label, title) {
      current = { label, title: normalizeParagraph(titleCase(title ?? '')), lines: [] };
      chapters.push(current);
    },
    push(line) {
      if (current) current.lines.push(line);
    },
    // A heading with nothing under it is front-matter residue, not content.
    finish() {
      return chapters
        .map((c) => ({ label: c.label, title: c.title, paragraphs: paragraphsFrom(c.lines) }))
        .filter((c) => c.paragraphs.length > 0);
    },
  };
}

// Heretics (PG 470): chapters are a bare "I.  Title" line at column 0. The
// front matter — a publisher's blurb and a biography of Chesterton written
// by the transcribers, neither of them his text — sits above the first such
// line, and the repeated table of contents indents its entries, so starting
// at the first column-0 roman heading drops both.
const HERETICS_RE = /^([IVXL]+)\.\s+(\S.*)$/;
function parseHeretics(text) {
  const chapters = chapterCollector();
  let started = false;
  for (const line of text.split('\n')) {
    const match = line.match(HERETICS_RE);
    if (match) {
      started = true;
      chapters.open(`Chapter ${romanToInt(match[1])}`, match[2]);
      continue;
    }
    if (!started) continue;
    if (/^THE END\s*$/.test(line)) break;
    chapters.push(line);
  }
  return chapters.finish();
}

// Orthodoxy (PG 16769): "CHAPTER I.--_Introduction in Defence of Everything
// Else_", with the full stop after the numeral inconsistently present
// (chapter IV has none). The contents list indents its rows, so a column-0
// anchor is again enough to skip the front matter.
const ORTHODOXY_RE = /^CHAPTER\s+([IVXL]+)\.?-*_?(.*?)_?\s*$/;
function parseOrthodoxy(text) {
  const chapters = chapterCollector();
  for (const line of text.split('\n')) {
    const match = line.match(ORTHODOXY_RE);
    if (match) {
      chapters.open(`Chapter ${romanToInt(match[1])}`, match[2]);
      continue;
    }
    chapters.push(line);
  }
  return chapters.finish();
}

// The Everlasting Man (PG 65688): the only one of the four with a part
// division — two parts of eight and six chapters, wrapped in a prefatory
// note, an introduction, a conclusion and two appendices. "CHAPTER I" sits
// on its own line with the chapter's title on the next non-blank line.
//
// The part is folded into the chapter's LABEL ("Part I, Chapter III") rather
// than given a TOC level of its own. The TOC machinery would carry a third
// level quite happily — Josephus uses one — but this is the only book in the
// source that has parts, and a dropdown whose depth changes between books
// reads as a glitch. Flattening keeps all four titles two levels deep and
// still cites the part, which is what the label is for.
function parseEverlastingMan(text) {
  const lines = text.split('\n');
  const chapters = chapterCollector();
  let part = null;
  // A heading has been seen and its chapter not opened yet: the title, if it
  // has one, is the next non-blank line.
  let pendingLabel = null;
  let skippingContents = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/^PART\s+([IVXL]+)$/.test(line)) {
      part = romanToInt(line.match(/^PART\s+([IVXL]+)$/)[1]);
      // The part's own subtitle ("On the Creature Called Man") follows on
      // the next non-blank line; it labels the part, not a chapter, so it is
      // skipped rather than captured as body text.
      while (i + 1 < lines.length && lines[i + 1].trim() === '') i++;
      i++;
      continue;
    }
    // The transcriber's note at the very end is apparatus, not Chesterton.
    if (/^Transcriber'?s Note/i.test(line)) break;

    // The printed table of contents sits BETWEEN the prefatory note and the
    // introduction rather than above both, so unlike the other three books
    // it can't be skipped by anchoring on the first heading — it would be
    // swallowed into the prefatory note as body text. Its own rows are
    // italicised ("_PART I_") and so don't trip the PART rule above; the
    // block simply runs from "CONTENTS" to the introduction heading.
    if (line === 'CONTENTS') {
      skippingContents = true;
      continue;
    }
    if (skippingContents) {
      if (line !== 'INTRODUCTION') continue;
      skippingContents = false;
    }

    const chapterMatch = line.match(/^CHAPTER\s+([IVXL]+)$/);
    if (chapterMatch) {
      const n = romanToInt(chapterMatch[1]);
      pendingLabel = part ? `Part ${part}, Chapter ${n}` : `Chapter ${n}`;
      continue;
    }
    const appendixMatch = line.match(/^APPENDIX\s+([IVXL]+)$/);
    if (appendixMatch) {
      pendingLabel = `Appendix ${romanToInt(appendixMatch[1])}`;
      continue;
    }
    const frontMatch = line.match(/^(PREFATORY NOTE|INTRODUCTION|CONCLUSION)$/);
    if (frontMatch) {
      pendingLabel = titleCase(frontMatch[1]);
      continue;
    }
    if (pendingLabel !== null) {
      // The blank lines between a heading and whatever follows it.
      if (line === '') continue;
      // Only an ALL-CAPS line is this section's title. The prefatory note
      // has no title at all, so its first sentence sits exactly where the
      // others' titles do — taking it as one would both mis-label the
      // section and delete the sentence from the text.
      const hasTitle = /[A-Z]/.test(line) && !/[a-z]/.test(line);
      chapters.open(pendingLabel, hasTitle ? line : '');
      pendingLabel = null;
      if (hasTitle) continue;
      // Not a title — it's the opening line of the body, so fall through.
    }
    chapters.push(lines[i]);
  }
  return chapters.finish();
}

// St. Francis of Assisi (PG 63084): an indented "_Chapter I_" line with
// "_The Problem of St. Francis_" beneath it. The contents list up top uses
// the un-italicised "CHAPTER I" spelling, so anchoring on the italic form
// skips it without needing a separate front-matter rule.
function parseStFrancis(text) {
  const lines = text.split('\n');
  const chapters = chapterCollector();
  let pendingNumber = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const match = line.match(/^_Chapter\s+([IVXL]+)_$/i);
    if (match) {
      pendingNumber = romanToInt(match[1]);
      continue;
    }
    // The book ends on chapter X; what follows is the publisher's own
    // back matter — a catalogue of other titles in Hodder and Stoughton's
    // People's Library and a printer's colophon. Not Chesterton's text, and
    // with no heading of its own it would otherwise run on as the closing
    // paragraphs of the last chapter.
    if (/^HODDER AND STOUGHTON'S$/.test(line)) break;

    if (pendingNumber !== null) {
      if (line === '') continue;
      chapters.open(`Chapter ${pendingNumber}`, line);
      pendingNumber = null;
      continue;
    }
    chapters.push(lines[i]);
  }
  return chapters.finish();
}

// The parsers walk four hand-different transcriptions, so the shape each one
// produced is asserted rather than trusted — a Gutenberg re-release that
// changes a heading's spelling would otherwise quietly ship a book with half
// its chapters swallowed into the one before.
const EXPECTED_CHAPTERS = {
  heretics: 20,
  orthodoxy: 9,
  // 8 + 6 chapters, plus prefatory note, introduction, conclusion and two
  // appendices — all Chesterton's own writing, so all of it is kept.
  'everlasting-man': 19,
  'st-francis': 10,
};

function assertShape(work, chapters) {
  const expected = EXPECTED_CHAPTERS[work.id];
  if (chapters.length !== expected) {
    throw new Error(
      `${work.title} parsed ${chapters.length} chapters, expected ${expected}. ` +
      'The Gutenberg transcription has probably changed — check its headings before trusting this.',
    );
  }
  for (const chapter of chapters) {
    // A numbered chapter always has a name in print. A self-describing
    // section does not — The Everlasting Man's prefatory note runs straight
    // into its text — so only the numbered ones are held to this.
    if (/Chapter \d+$/.test(chapter.label) && !chapter.title) {
      throw new Error(`${work.title}: "${chapter.label}" parsed with no title.`);
    }
    // Length is checked in words rather than paragraphs: The Everlasting
    // Man's two appendices are each a single unbroken paragraph, so a
    // paragraph-count floor would reject them while still passing a stray
    // heading that had swallowed a page. The floor sits just under that
    // book's shortest real section, its 387-word prefatory note.
    const words = chapter.paragraphs.join(' ').split(/\s+/).length;
    if (words < 250) {
      throw new Error(
        `${work.title}: "${chapter.label}" has only ${words} words — a heading pattern is ` +
        'probably matching mid-text.',
      );
    }
  }
}

async function main() {
  const refetch = process.argv.includes('--refetch');
  const titles = [];
  let totalParagraphs = 0;

  for (const work of TITLES) {
    process.stdout.write(`${work.title} (PG ${work.gutenbergId})… `);
    const raw = await loadRaw(work, refetch);
    assertGutenbergPublicDomain(work, raw);
    const chapters = work.parse(stripGutenbergWrapper(raw));
    assertShape(work, chapters);
    const paragraphs = chapters.reduce((n, c) => n + c.paragraphs.length, 0);
    totalParagraphs += paragraphs;
    titles.push({
      id: work.id,
      title: work.title,
      year: work.year,
      gutenberg_id: work.gutenbergId,
      chapters: chapters.map((c, i) => ({
        number: i + 1,
        label: c.label,
        title: c.title,
        paragraphs: c.paragraphs,
      })),
    });
    console.log(`${chapters.length} chapters, ${paragraphs} paragraphs`);
  }

  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'G.K. Chesterton — Christian Apologetics',
      author: 'G.K. Chesterton (1874–1936)',
      source_site: 'https://www.gutenberg.org/',
      gutenberg_ids: TITLES.map((w) => w.gutenbergId),
      license_note:
        'Public domain — G.K. Chesterton (1874–1936). Four works of Christian apologetics and ' +
        'theology from Project Gutenberg, each published in 1925 or earlier and public domain in ' +
        'the US: Heretics (1905, PG 470), Orthodoxy (1908, PG 16769), St. Francis of Assisi ' +
        '(1923, PG 63084) and The Everlasting Man (1925, PG 65688). His fiction, poetry and ' +
        'general social criticism are deliberately out of scope. Built by tools/chesterton/' +
        'build.mjs, which refuses any file that does not carry Gutenberg\'s licence boilerplate ' +
        'and name Chesterton as its author.',
      total_paragraphs: totalParagraphs,
    },
    titles,
  };

  const json = JSON.stringify(bundle, null, 1);
  await fs.writeFile(OUTPUT_PATH, json, 'utf8');
  await fs.mkdir(path.dirname(DEPLOY_PATH), { recursive: true });
  await fs.writeFile(DEPLOY_PATH, json, 'utf8');
  console.log(`\n${totalParagraphs} paragraphs across ${titles.length} titles`);
  console.log(`wrote ${OUTPUT_PATH}`);
  console.log(`wrote ${DEPLOY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
