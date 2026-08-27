// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads Project Gutenberg #22400 — "Fox's Book of Martyrs", the
// 19th-century compilation of John Foxe's work published by The John C.
// Winston Co. — parses its Chapter / named-sub-entry / paragraph structure
// and writes foxe.json, a bundle shaped to feed Foundation's freeform,
// position_ref-anchored import (one source, one book, a 2-level
// toc_entries hierarchy). Download-and-clean only: does not touch
// src-tauri/, src/db.ts or src/importer.ts, and is not part of the app
// runtime.
//
// EDITION PROVENANCE — read before changing the ID below.
// PG 22400 is NOT a transcription of Foxe's 1563/1570 "Actes and
// Monuments". It is a compilation and abridgement *built on* Foxe's work by
// an unnamed 19th-century editor, who extended it to cover persecution
// history down to 1830 — Foxe himself died in 1587. Its own preface says so
// outright ("This work is strictly what its title page imports, a
// COMPILATION..."). That distinction travels into the bundle's
// license_note, the Library blurb and the docs, and must not be flattened
// into "Foxe's Book of Martyrs, 1563".
//
// LICENCE: public domain — pre-1928 US publication. Project Gutenberg's own
// licence covers the digitisation and imposes no further restriction. The
// build hard-fails if the downloaded file no longer carries Gutenberg's
// standard licence boilerplate, the same discipline tools/jfb/build.mjs and
// tools/smiths-dictionary/build.mjs apply to their OSIS DistributionLicense
// fields, adapted to Gutenberg's convention.
//
// Resumable: raw text is cached under raw/, so a re-run skips the download.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download
//   node build.mjs --audit      also print every bracketed editorial aside
//                               and every detected sub-entry heading, for
//                               the manual read-through the project's
//                               standing discipline asks for

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const RAW_PATH = path.join(RAW_DIR, 'pg22400.txt');
const OUTPUT_PATH = path.join(__dirname, 'foxe.json');
const DEPLOY_PATH = path.join(__dirname, '..', '..', 'public', 'library', 'historical', 'foxe.json');

const GUTENBERG_ID = 22400;
// Primary, then the archive.org mirror. Both are tried in order; when the
// mirror is used as a *fallback* the build says so loudly, because the two
// have only ever been verified byte-identical by hand.
const SOURCE_URLS = [
  `https://www.gutenberg.org/cache/epub/${GUTENBERG_ID}/pg${GUTENBERG_ID}.txt`,
  `https://archive.org/download/foxsbookofmartyr${GUTENBERG_ID}gut/pg${GUTENBERG_ID}.txt`,
];
const USER_AGENT =
  'FoundationFoxeBuilder/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

// The printed book has exactly 23 numbered chapters. This is asserted rather
// than discovered: if a future re-fetch parses to any other count, the
// parser has drifted from the text and the build must stop instead of
// shipping a half-read book.
const EXPECTED_CHAPTERS = 23;
// Chapters IX, XI and XV are a single continuous narrative with no named
// sub-entries. Recorded here so the build can distinguish "correctly has no
// children" from "sub-entry detection silently failed".
const EXPECTED_CHILDLESS = [9, 11, 15];

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

async function loadRaw(refetch) {
  if (!refetch) {
    try {
      const cached = await fs.readFile(RAW_PATH, 'utf8');
      if (cached.length > 1000) return cached;
    } catch {
      /* not cached yet */
    }
  }
  let text = null;
  let lastErr;
  for (const [i, url] of SOURCE_URLS.entries()) {
    try {
      text = await fetchText(url);
      if (i > 0) {
        console.warn(
          `\n  ! Primary Gutenberg URL unreachable; built from the mirror ${url}.\n` +
          '    The two have only been verified identical by hand — re-verify before\n' +
          '    trusting a bundle built this way.\n',
        );
      }
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!text) throw new Error(`Could not download PG ${GUTENBERG_ID}: ${lastErr?.message ?? lastErr}`);
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(RAW_PATH, text, 'utf8');
  return text;
}

// Hard gate on licence — see the header note. Gutenberg states the licence
// in its own header boilerplate rather than in a metadata field; if that
// wording is gone, the file is not the release this bundle is allowed to
// ship and the build fails rather than quietly importing it.
function assertGutenbergLicense(raw) {
  const header = raw.slice(0, 6000);
  const licensed =
    /This eBook is for the use of anyone anywhere/i.test(header) ||
    /is for the use of anyone anywhere in the United States and most other parts of the world at no cost/i.test(header);
  if (!licensed) {
    throw new Error(
      `PG ${GUTENBERG_ID} no longer carries Project Gutenberg's standard licence boilerplate ` +
      '("This eBook is for the use of anyone anywhere..."). Refusing to build: only text confirmed ' +
      'to ship under the PG licence may be bundled.',
    );
  }
  if (!/Foxe/i.test(header) && !/Martyrs/i.test(header)) {
    throw new Error(`PG ${GUTENBERG_ID} header does not name Foxe or the Book of Martyrs — wrong file?`);
  }
}

// Strips Gutenberg's own boilerplate, leaving just the work.
function stripGutenbergWrapper(raw) {
  let text = raw.replace(/\r\n/g, '\n');
  const start = text.match(/\*\*\*\s*START OF TH[EI][^\n]*\*\*\*/i);
  if (start) text = text.slice(text.indexOf(start[0]) + start[0].length);
  const end = text.match(/\*\*\*\s*END OF TH[EI][^\n]*\*\*\*/i)
    ?? text.match(/^End of (?:the )?Project Gutenberg.*$/im);
  if (end) text = text.slice(0, text.indexOf(end[0]));
  return text;
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function romanToInt(s) {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN[s[i]] ?? 0;
    const next = ROMAN[s[i + 1]] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

// Chapter-level headers in the body are consistent throughout: a bare
// "CHAPTER I." line, followed by an ALL-CAPS title. This is the only
// structural split point the text can be trusted on.
const CHAPTER_RE = /^\s*CHAPTER\s+([IVXL]+)\.?\s*$/;

// entries.text is plain text everywhere in this app and no pane renders
// markup, so Gutenberg's `_underscore_` italics are unwrapped rather than
// carried through — the same call the Talmud import made with Sefaria's <b>
// markup. Only *paired* markers on one line are unwrapped; a stray
// underscore is left alone rather than guessed at.
function unwrapItalics(text) {
  return text.replace(/_([^_\n]+)_/g, '$1');
}

function normalizeWhitespace(text) {
  return text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
}

// A blank-line-separated block, with its wrapped lines rejoined.
function toParagraphs(lines) {
  const blocks = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length) blocks.push(buffer.join('\n'));
    buffer = [];
  };
  for (const line of lines) {
    if (line.trim() === '') flush();
    else buffer.push(line);
  }
  flush();
  return blocks;
}

// A named sub-entry marker, per the brief's structural note: the CONTENTS
// page is NOT a parsing spec, and the two conventions it implies —
// Chapter II's `_The First Persecution under Nero, A. D. 67._` and Chapter
// I's `_I. St. Stephen_` — are the same underlying thing. So this detects
// the *shape* (a short, wholly-italicised block standing alone as its own
// paragraph) rather than either fixed heading syntax.
const MAX_HEADING_CHARS = 160;
function asSubEntryHeading(block) {
  const flat = normalizeWhitespace(block);
  if (!flat.startsWith('_') || !flat.endsWith('_')) return null;
  if (flat.length > MAX_HEADING_CHARS) return null;
  // A wholly-italicised block has exactly one opening and one closing
  // marker; more than that is a paragraph of running text that happens to
  // begin and end with emphasis.
  if ((flat.match(/_/g) ?? []).length !== 2) return null;
  const inner = flat.slice(1, -1).trim();
  if (!inner) return null;
  // Deliberately no "does this read like a sentence?" heuristic. Both real
  // conventions are sentence-shaped by that measure — "_I. St. Stephen_"
  // and "_The First Persecution under Nero, A. D. 67._" both carry a period
  // followed by a capital — so such a test rejects the very headings this
  // exists to find. The shape checks above are the signal; `--audit` prints
  // every heading detected so the whole list can be read at once.
  return inner.replace(/\s*\.\s*$/, '');
}

// The 19th-century compiler's own bracketed asides, signed `--_Ed._`. These
// are his voice inside the text, NOT a proofreading artifact and NOT a
// footnote to strip — they stay in entries.text. Collected here only so the
// build can report every instance for the manual audit the project's
// standing discipline asks for, rather than handling the one instance
// already spotted and assuming the rest match it.
const EDITORIAL_ASIDE_RE = /\[[^\][]*?--\s*_?Ed\._?\s*\]/g;
const ANY_BRACKETED_RE = /\[[^\][]{20,}\]/g;

// Splits the de-boilerplated text into the 23 body chapters.
//
// The front matter (title page, preface) and the CONTENTS section are not
// imported — same precedent as skipping OSIS headers and CCEL "Title Page"
// containers. CONTENTS also repeats every "CHAPTER N." heading before the
// body proper, so the body is identified as the *last* run of chapter
// headers that counts I, II, III... from one without gaps.
function splitChapters(text) {
  const lines = text.split('\n');
  const headers = [];
  lines.forEach((line, i) => {
    const m = line.match(CHAPTER_RE);
    if (m) headers.push({ line: i, number: romanToInt(m[1]), roman: m[1] });
  });
  if (headers.length === 0) throw new Error('No "CHAPTER N." headers found — the text or the parser has changed.');

  // Walk backwards to the start of the final ascending-from-1 run.
  let end = headers.length - 1;
  let start = end;
  while (start > 0 && headers[start - 1].number === headers[start].number - 1) start--;
  if (headers[start].number !== 1) {
    throw new Error(`Body chapter run starts at ${headers[start].number}, not 1 — parser drifted.`);
  }
  const body = headers.slice(start, end + 1);

  return body.map((h, i) => {
    const from = h.line + 1;
    const to = i + 1 < body.length ? body[i + 1].line : lines.length;
    return { number: h.number, roman: h.roman, lines: lines.slice(from, to) };
  });
}

// Pulls the ALL-CAPS title line(s) that follow a "CHAPTER N." header off the
// front of its body.
function takeChapterTitle(chapterLines) {
  const blocks = toParagraphs(chapterLines);
  if (blocks.length === 0) return { title: '', blocks };
  const first = normalizeWhitespace(blocks[0]);
  const letters = first.replace(/[^A-Za-z]/g, '');
  const isAllCaps = letters.length > 0 && letters === letters.toUpperCase();
  if (isAllCaps && first.length <= 300) {
    return {
      title: unwrapItalics(first).replace(/\s*\.\s*$/, ''),
      blocks: blocks.slice(1),
    };
  }
  return { title: '', blocks };
}

// One chapter -> { number, roman, title, units }. A `unit` is a named
// sub-entry and its paragraphs; a chapter's text before its first named
// sub-entry (or a whole chapter that has none, like IX/XI/XV) lands in a
// leading unit with heading === null.
function parseChapter(chapter, audit) {
  const { title, blocks } = takeChapterTitle(chapter.lines);
  const units = [];
  let current = { heading: null, paragraphs: [] };

  for (const block of blocks) {
    const heading = asSubEntryHeading(block);
    if (heading) {
      if (current.paragraphs.length > 0 || current.heading !== null) units.push(current);
      current = { heading: unwrapItalics(heading), paragraphs: [] };
      if (audit) audit.headings.push(`Ch ${chapter.roman}: ${unwrapItalics(heading)}`);
      continue;
    }
    const text = unwrapItalics(normalizeWhitespace(block));
    if (!text) continue;
    if (audit) {
      for (const m of text.match(EDITORIAL_ASIDE_RE) ?? []) audit.asides.push(`Ch ${chapter.roman}: ${m}`);
      for (const m of text.match(ANY_BRACKETED_RE) ?? []) audit.brackets.push(`Ch ${chapter.roman}: ${m}`);
    }
    current.paragraphs.push(text);
  }
  if (current.paragraphs.length > 0 || current.heading !== null) units.push(current);

  return {
    number: chapter.number,
    roman: chapter.roman,
    title,
    units: units.filter((u) => u.paragraphs.length > 0),
  };
}

// Structural self-check. The parser cannot be eyeballed on every one of the
// book's thousands of paragraphs, so the shape it produced is asserted
// against what the printed book is known to contain. A mismatch is a build
// failure, not a warning: a half-read book that installs cleanly is worse
// than one that refuses to build.
function validate(chapters) {
  const problems = [];
  if (chapters.length !== EXPECTED_CHAPTERS) {
    problems.push(`parsed ${chapters.length} chapters, expected ${EXPECTED_CHAPTERS}`);
  }
  for (const c of chapters) {
    const paragraphs = c.units.reduce((n, u) => n + u.paragraphs.length, 0);
    if (paragraphs === 0) problems.push(`Chapter ${c.roman} has no paragraphs`);
    if (!c.title) problems.push(`Chapter ${c.roman} has no ALL-CAPS title line`);
    const named = c.units.filter((u) => u.heading !== null).length;
    const shouldBeChildless = EXPECTED_CHILDLESS.includes(c.number);
    if (shouldBeChildless && named > 0) {
      problems.push(`Chapter ${c.roman} was expected to have no named sub-entries but parsed ${named}`);
    }
    if (!shouldBeChildless && named === 0) {
      problems.push(`Chapter ${c.roman} parsed no named sub-entries — heading detection may have failed`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      'Structural validation failed — the parser has drifted from the text:\n  - ' +
      problems.join('\n  - ') +
      '\nInspect tools/foxe/raw/pg22400.txt before changing these expectations.',
    );
  }
}

async function main() {
  const refetch = process.argv.includes('--refetch');
  const wantAudit = process.argv.includes('--audit');
  const audit = wantAudit ? { headings: [], asides: [], brackets: [] } : null;

  process.stdout.write(`Fox's Book of Martyrs (PG ${GUTENBERG_ID})… `);
  const raw = await loadRaw(refetch);
  assertGutenbergLicense(raw);

  const chapters = splitChapters(stripGutenbergWrapper(raw)).map((c) => parseChapter(c, audit));
  validate(chapters);

  const totalParagraphs = chapters.reduce(
    (n, c) => n + c.units.reduce((m, u) => m + u.paragraphs.length, 0), 0,
  );
  const totalNamed = chapters.reduce((n, c) => n + c.units.filter((u) => u.heading).length, 0);
  console.log(`${chapters.length} chapters, ${totalNamed} named sub-entries, ${totalParagraphs} paragraphs`);

  if (audit) {
    console.log(`\n--- detected sub-entry headings (${audit.headings.length}) ---`);
    for (const h of audit.headings) console.log(`  ${h}`);
    console.log(`\n--- editorial asides signed --Ed. (${audit.asides.length}) — KEPT in entries.text ---`);
    for (const a of audit.asides) console.log(`  ${a}`);
    const unsigned = audit.brackets.filter((b) => !/--\s*_?Ed\._?\s*\]/.test(b));
    console.log(`\n--- other long bracketed passages (${unsigned.length}) — read these before assuming a blanket rule ---`);
    for (const b of unsigned) console.log(`  ${b}`);
    console.log('');
  }

  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: "Fox's Book of Martyrs",
      subtitle:
        'Or A History of the Lives, Sufferings, and Triumphant Deaths of the Primitive Protestant Martyrs',
      credited_author: 'John Foxe',
      publisher: 'The John C. Winston Co.',
      source_site: 'https://www.gutenberg.org/',
      gutenberg_id: GUTENBERG_ID,
      gutenberg_released: '2007-08-25',
      produced_by: 'the Online Distributed Proofreading Team (pgdp.net)',
      edition_note:
        'This is a 19th-century compilation and abridgement built on John Foxe\'s work — its own ' +
        'preface calls it "strictly what its title page imports, a COMPILATION" — extended by its ' +
        'unnamed editor to cover persecution history down to 1830. It is NOT a transcription of ' +
        'Foxe\'s 1563/1570 "Actes and Monuments"; Foxe died in 1587.',
      license_note:
        'Public domain — pre-1928 United States publication (The John C. Winston Co.), credited to ' +
        'John Foxe (1516/17–1587). Text from Project Gutenberg (ebook #22400, released 25 August ' +
        '2007), produced by the Online Distributed Proofreading Team; Gutenberg\'s own licence ' +
        'covers the digitisation and imposes no further restriction. Note the edition: this is a ' +
        '19th-century compilation and abridgement of Foxe\'s work, extended by its editor to 1830, ' +
        'not Foxe\'s original 1563/1570 "Actes and Monuments".',
      chapter_count: chapters.length,
      named_entry_count: totalNamed,
      paragraph_count: totalParagraphs,
    },
    chapters,
  };

  const json = JSON.stringify(bundle, null, 1);
  await fs.writeFile(OUTPUT_PATH, json, 'utf8');
  await fs.mkdir(path.dirname(DEPLOY_PATH), { recursive: true });
  await fs.writeFile(DEPLOY_PATH, json, 'utf8');
  console.log(`wrote ${OUTPUT_PATH}`);
  console.log(`wrote ${DEPLOY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
