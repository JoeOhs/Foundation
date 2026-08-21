// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads the four Project Gutenberg texts that make up Josephus's
// complete works in William Whiston's 1737 translation, parses their
// Book / Chapter / Section structure, strips Whiston's translator
// footnotes, and writes josephus.json — a bundle shaped to feed Foundation's
// compound-work import (one source, many books, a 3-level toc_entries
// hierarchy). Download-and-clean only: does not touch src-tauri/, src/db.ts
// or src/importer.ts, and is not part of the app runtime.
//
// TRANSLATION PROVENANCE — read before changing any ID below.
// Every text here must be the WHISTON translation (William Whiston, 1737;
// translator died 1752, text long in the public domain, and Gutenberg
// distributes it freely). Modern translations of Josephus — Loeb, Feldman,
// Mason/Brill and similar — are separately copyrighted and must NEVER be
// substituted in, however much more readable they may be. The script
// verifies `Translator: William Whiston` in each downloaded file's Gutenberg
// header and refuses to build if it is missing.
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
const OUTPUT_PATH = path.join(__dirname, 'josephus.json');
const DEPLOY_PATH = path.join(__dirname, '..', '..', 'public', 'library', 'historical', 'josephus.json');
const REQUEST_DELAY_MS = 800;
const USER_AGENT =
  'FoundationJosephusBuilder/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

// The four works, in the order they should read. `gutenbergId` is the
// canonical Whiston edition on Project Gutenberg; `part` is how the work
// appears as a top-level TOC entry inside the single combined source.
const WORKS = [
  {
    id: 'wars',
    part: 'The Wars of the Jews',
    gutenbergId: 2850,
    // Wars numbers its books I-VII and chapters within them.
    hasBooks: true,
  },
  {
    id: 'antiquities',
    part: 'Antiquities of the Jews',
    gutenbergId: 2848,
    hasBooks: true,
  },
  {
    id: 'life',
    part: 'The Life of Flavius Josephus',
    gutenbergId: 2846,
    // The Life is a single continuous run of numbered sections — no books,
    // no chapters.
    hasBooks: false,
  },
  {
    id: 'apion',
    part: 'Against Apion',
    gutenbergId: 2849,
    hasBooks: true,
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
  if (!text) throw new Error(`Could not download ${work.part}: ${lastErr?.message ?? lastErr}`);
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(cachePath, text, 'utf8');
  await sleep(REQUEST_DELAY_MS);
  return text;
}

// Hard gate on translation provenance — see the header note. A file whose
// Gutenberg header doesn't name Whiston is not the edition this bundle is
// allowed to ship, so the build fails rather than quietly importing it.
function assertWhiston(work, raw) {
  const header = raw.slice(0, 3000);
  if (!/Translator:\s*William Whiston/i.test(header)) {
    throw new Error(
      `${work.part} (PG ${work.gutenbergId}) does not declare "Translator: William Whiston" in its ` +
      'Gutenberg header. Refusing to build: only the public-domain Whiston translation may ship.',
    );
  }
}

// Strips Gutenberg's own boilerplate, leaving just the work.
function stripGutenbergWrapper(raw) {
  let text = raw.replace(/\r\n/g, '\n');
  const start = text.match(/\*\*\*\s*START OF TH[EI][^\n]*\*\*\*/i);
  if (start) text = text.slice(text.indexOf(start[0]) + start[0].length);
  // Two end-marker vintages: the modern starred banner, and the older
  // "End of Project Gutenberg's ..." line still used by these 2001 files.
  const end = text.match(/\*\*\*\s*END OF TH[EI][^\n]*\*\*\*/i)
    ?? text.match(/^End of (?:the )?Project Gutenberg.*$/im);
  if (end) text = text.slice(0, text.indexOf(end[0]));
  return text;
}

const BOOK_RE = /^BOOK\s+([IVXL]+|\d+)\.?\s*(.*)$/;
const CHAPTER_RE = /^CHAPTER\s+(\d+)\.?\s*(.*)$/;
const SECTION_RE = /^(\d+)\.\s+(\S.*)$/;
// Three footnote-block header shapes across the four files:
//   Antiquities  "FOOTNOTES" / "FOOTNOTES:"  (bare, own line)
//   Wars         "WAR BOOK 1 FOOTNOTES"      (qualified) — and the very last
//                block runs the first note onto the same line as the header,
//                so this deliberately does NOT anchor to end-of-line
//   Life/Apion   "Footnotes"                 (mixed case)
const FOOTNOTES_RE = /^[A-Z0-9 ]*FOOTNOTES:?\b/i;
// A footnote body line: "36 (return) [ ... ]" (Antiquities/Wars) or
// "[Footnote 1: ... ]" (Life/Against Apion).
const FOOTNOTE_BODY_RE = /^(?:\d+\s*\(return\)|\[Footnote\b)/i;

// Gutenberg's front matter repeats the whole table of contents as bare
// BOOK/CHAPTER headings before the body proper. The body is where the first
// numbered *section* appears, so rewind from there to the heading that opens
// it and drop everything before.
function dropFrontMatter(lines) {
  const firstSection = lines.findIndex((l) => SECTION_RE.test(l));
  if (firstSection === -1) return lines;
  let start = firstSection;
  for (let i = firstSection - 1; i >= 0 && i >= firstSection - 40; i--) {
    if (BOOK_RE.test(lines[i]) || CHAPTER_RE.test(lines[i])) start = i;
  }
  return lines.slice(start);
}

// Whiston's translator footnotes are excluded from the text entirely — see
// the note in josephusImport.ts for why they aren't captured separately.
// Two shapes have to go:
//   1. Whole FOOTNOTES blocks between chapters (his dissertations).
//   2. Inline reference markers, which the Gutenberg transcription renders
//      as bare digits fused onto the preceding word: "over1 begins",
//      "soul.2 This", "river,3 which". Left in place they corrupt the word.
function stripFootnoteBlocks(lines) {
  const out = [];
  let inFootnotes = false;
  for (const line of lines) {
    if (FOOTNOTES_RE.test(line)) {
      inFootnotes = true;
      continue;
    }
    // A footnote block runs until the next structural heading.
    if (inFootnotes) {
      if (BOOK_RE.test(line) || CHAPTER_RE.test(line)) inFootnotes = false;
      else continue;
    }
    if (FOOTNOTE_BODY_RE.test(line)) continue;
    out.push(line);
  }
  return out;
}

// Only strips a marker that is *fused* to the preceding word with no space
// ("Sea.4 Now"), which in running prose is never anything but a footnote
// reference. A digit standing alone between spaces is left untouched: it may
// legitimately be part of the text ("Genesis 44:20", "the 12 tribes"), and a
// wrong strip silently rewrites Josephus, which is worse than a stray marker.
function stripInlineFootnoteRefs(text) {
  return text
    // bracketed form, used in Life/Against Apion: "twenty-four [1] courses"
    .replace(/\s*\[\d{1,3}\]/g, '')
    // fused form, used in Antiquities/Wars
    .replace(/([A-Za-z.,;:!?'")])\d{1,3}(?=\s|$)/g, '$1');
}

function normalizeWhitespace(text) {
  return text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
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

// Parses one work into { books: [{ name, chapters: [{ title, sections }] }] }.
// A work without real books (The Life) still gets one synthetic book so the
// output shape is uniform.
function parseWork(work, raw) {
  assertWhiston(work, raw);
  let lines = stripGutenbergWrapper(raw).split('\n');
  lines = dropFrontMatter(lines);
  lines = stripFootnoteBlocks(lines);

  const books = [];
  let book = null;
  let chapter = null;
  let buffer = [];
  let sectionNo = null;

  const flushSection = () => {
    if (sectionNo === null) return;
    const text = stripInlineFootnoteRefs(normalizeWhitespace(buffer.join('\n')));
    if (text) chapter.sections.push({ number: sectionNo, text });
    buffer = [];
    sectionNo = null;
  };
  const ensureBook = (name, title) => {
    flushSection();
    book = { name, title: title ?? '', chapters: [] };
    books.push(book);
    chapter = null;
  };
  const ensureChapter = (number, title) => {
    flushSection();
    // Sections appearing before the first BOOK heading are the work's
    // preface — Josephus's own, and real content, so it's kept as its own
    // book rather than folded into Book 1 or dropped.
    if (!book) ensureBook(work.hasBooks ? 'Preface' : work.part, '');
    chapter = { number, title: title ?? '', sections: [] };
    book.chapters.push(chapter);
  };

  for (const line of lines) {
    const bookMatch = work.hasBooks ? line.match(BOOK_RE) : null;
    if (bookMatch) {
      ensureBook(`Book ${romanToInt(bookMatch[1])}`, bookMatch[2]);
      continue;
    }
    const chapterMatch = line.match(CHAPTER_RE);
    if (chapterMatch) {
      ensureChapter(Number(chapterMatch[1]), chapterMatch[2]);
      continue;
    }
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch) {
      flushSection();
      if (!chapter) ensureChapter(1, '');
      sectionNo = Number(sectionMatch[1]);
      buffer.push(sectionMatch[2]);
      continue;
    }
    if (sectionNo !== null) buffer.push(line);
  }
  flushSection();

  // A heading with no sections under it is front-matter residue, not content.
  for (const b of books) b.chapters = b.chapters.filter((c) => c.sections.length > 0);
  return books.filter((b) => b.chapters.length > 0);
}

// Chapter titles arrive wrapped across several lines; rejoin them and drop
// the footnote markers Gutenberg leaves in headings too.
function tidyTitle(title) {
  return stripInlineFootnoteRefs(normalizeWhitespace(title)).replace(/\s*\.\s*$/, '');
}

async function main() {
  const refetch = process.argv.includes('--refetch');
  const parts = [];
  let totalSections = 0;

  for (const work of WORKS) {
    process.stdout.write(`${work.part} (PG ${work.gutenbergId})… `);
    const raw = await loadRaw(work, refetch);
    const books = parseWork(work, raw);
    const sections = books.reduce(
      (n, b) => n + b.chapters.reduce((m, c) => m + c.sections.length, 0),
      0,
    );
    totalSections += sections;
    parts.push({
      id: work.id,
      title: work.part,
      gutenberg_id: work.gutenbergId,
      books: books.map((b) => ({
        name: b.name,
        title: tidyTitle(b.title),
        chapters: b.chapters.map((c) => ({
          number: c.number,
          title: tidyTitle(c.title),
          sections: c.sections,
        })),
      })),
    });
    console.log(`${books.length} book(s), ${sections} sections`);
  }

  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'The Complete Works of Flavius Josephus',
      translator: 'William Whiston (1667–1752), translation first published 1737',
      source_site: 'https://www.gutenberg.org/',
      gutenberg_ids: WORKS.map((w) => w.gutenbergId),
      license_note:
        'Public domain — Flavius Josephus (c. 37–100 AD), translated by William Whiston (1737; ' +
        'translator died 1752). Text from Project Gutenberg, which distributes it freely. ' +
        "Whiston's translator footnotes and dissertations are deliberately excluded from this " +
        'bundle; only Josephus\'s own text is included.',
      total_sections: totalSections,
    },
    parts,
  };

  const json = JSON.stringify(bundle, null, 1);
  await fs.writeFile(OUTPUT_PATH, json, 'utf8');
  await fs.mkdir(path.dirname(DEPLOY_PATH), { recursive: true });
  await fs.writeFile(DEPLOY_PATH, json, 'utf8');
  console.log(`\n${totalSections} sections across ${parts.length} parts`);
  console.log(`wrote ${OUTPUT_PATH}`);
  console.log(`wrote ${DEPLOY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
