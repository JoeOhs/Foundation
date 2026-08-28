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
  // Matched against whitespace-normalised text, never the raw file. Every
  // phrase below spans more than one word, and Gutenberg hard-wraps its
  // boilerplate at ~72 columns, so a wrap falling inside a phrase makes a
  // raw-text regex fail on a perfectly good file. Normalising first is what
  // makes this guard about the wording rather than about the line breaks.
  const flat = (chunk) => chunk.replace(/\s+/g, ' ');
  const header = flat(raw.slice(0, 8000));
  const footer = flat(raw.slice(-25000));

  // PG has re-generated its boilerplate over the years, and this ebook's
  // vintage (2007) predates the current wording, so the file's header
  // depends on when the copy was produced:
  //   older  "This eBook is for the use of anyone anywhere at no cost and
  //           with almost no restrictions whatsoever."
  //   current"This ebook is for the use of anyone anywhere in the United
  //           States and most other parts of the world at no cost..."
  // The archive.org mirror carries the older form, gutenberg.org the
  // current one. Rather than pin either, this matches the stem both share
  // and have kept across every revision — and case-insensitively, since
  // "eBook" became "ebook" in the rewrite.
  const LICENSE_MARKERS = [
    /for the use of anyone anywhere/i,
    /THE FULL PROJECT GUTENBERG LICENSE/i,
    /Project Gutenberg(?:-tm)? License/i,
  ];
  const found = LICENSE_MARKERS.filter((re) => re.test(header) || re.test(footer));
  if (found.length === 0) {
    throw new Error(
      `PG ${GUTENBERG_ID} carries none of Project Gutenberg's licence markers ` +
      '(the "for the use of anyone anywhere" grant, or the full licence section). ' +
      'Refusing to build: only text confirmed to ship under the PG licence may be bundled.',
    );
  }

  // "Fox's" in this edition's own title, not "Foxe's" — so the surname is
  // matched with the final "e" optional rather than spelled one way.
  if (!/Fox'?e?'?s Book of Martyrs/i.test(header) && !/Book of Martyrs/i.test(header)) {
    throw new Error(`PG ${GUTENBERG_ID} header does not name the Book of Martyrs — wrong file?`);
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
const ROMAN_NUMERALS = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function intToRoman(n) {
  let out = '';
  let rest = n;
  for (const [value, glyph] of ROMAN_NUMERALS) {
    while (rest >= value) { out += glyph; rest -= value; }
  }
  return out;
}

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
// Headings wrap across up to three lines, so the cap is on the rejoined
// length, and it is measured rather than guessed. Across the real text there
// are 196 wholly-italicised standalone blocks: median 38 characters, 90th
// percentile 79, longest 163 (Wishart's, below). Nothing at all falls
// between 164 and 400, so any threshold in that gap is equally safe; 300
// takes the middle of it. The first cap tried here was 160, which silently
// dropped the two longest — Wishart at 163 and the Gunpowder Plot at 161 —
// taking chapters XII and XIV's only sub-entries with them. A cap that
// merely looks generous is not good enough: it has to sit in a gap the text
// actually has.
const MAX_HEADING_CHARS = 300;
function asSubEntryHeading(block) {
  const flat = normalizeWhitespace(block);
  if (flat.length > MAX_HEADING_CHARS) return null;
  if (!flat.startsWith('_')) return null;
  // A wholly-italicised block has exactly one opening and one closing
  // marker; more than that is a paragraph of running text that happens to
  // begin and end with emphasis.
  if ((flat.match(/_/g) ?? []).length !== 2) return null;
  // The closing marker is NOT reliably the last character. The text places
  // a heading's trailing punctuation on either side of it, inconsistently:
  //   "_II. James the Great._"                     period inside
  //   "_IV. Matthew_,"  "_IX. Peter_,"             comma outside
  //   "_The Eighth Persecution, under Valerian, A. D. 257_,"   comma outside
  // Requiring the block to END with an underscore silently drops every
  // heading of the second shape, so the tail after the closing marker is
  // allowed to be punctuation — and only punctuation, since a word there
  // means this is running prose, not a heading.
  const close = flat.lastIndexOf('_');
  const tail = flat.slice(close + 1);
  if (!/^[.,;:—-]*$/.test(tail)) return null;

  const inner = flat.slice(1, close).trim();
  if (!inner) return null;
  // Deliberately no "does this read like a sentence?" heuristic. Every real
  // convention is sentence-shaped by that measure — "_I. St. Stephen_" and
  // "_The First Persecution under Nero, A. D. 67._" both carry a period
  // followed by a capital — so such a test rejects the very headings this
  // exists to find. Nor is there any lexical test for a numbering scheme:
  // the text uses at least three conventions, and Chapter III's is a bare
  // descriptive title with no numbering at all
  // ("_Persecutions under the Arian Heretics._"), so keying on a roman
  // numeral or an ordinal word would miss it. The structural shape above —
  // a short, wholly-italicised block standing alone as its own paragraph —
  // is the whole signal; `--audit` prints every heading detected so the
  // list can be read at once.
  //
  // Trailing punctuation is trimmed off the *label* whichever side of the
  // marker it sat on. That is a deliberate call, not an accident: a comma
  // in "_IV. Matthew_," belongs grammatically to the sentence that follows
  // ("Whose occupation was..."), but the label is used as a TOC row and as
  // the position_ref citation, where a dangling comma is just noise. The
  // paragraph text itself is left exactly as the source has it — nothing is
  // absorbed into or removed from entries.text to compensate.
  return inner.replace(/\s*[.,;:]+\s*$/, '');
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
    if (m) headers.push({ line: i, printed: m[1], number: romanToInt(m[1]) });
  });
  if (headers.length === 0) throw new Error('No "CHAPTER N." headers found — the text or the parser has changed.');

  // The body is found by locating its opening "CHAPTER I." — NOT by walking
  // back over an ascending run of numerals, because the numerals cannot be
  // trusted. The body headers carry two transcription typos, each
  // duplicating an earlier numeral:
  //
  //   position 13 is printed "CHAPTER XII."  (CONTENTS correctly says XIII)
  //   position 19 is printed "CHAPTER IX."   (CONTENTS correctly says XIX)
  //
  // Both are confirmed against the CONTENTS list and against the chapters'
  // own titles ("PERSECUTIONS IN ENGLAND DURING THE REIGN OF QUEEN MARY",
  // "PERSECUTIONS OF THE BAPTIST MISSIONARIES IN INDIA..."). An
  // ascending-run scan stops dead at the first of them.
  //
  // CONTENTS repeats every chapter header before the body, so there are two
  // "CHAPTER I." lines and the body's is the later one. Of the candidates,
  // the one leaving exactly EXPECTED_CHAPTERS headers to the end is
  // preferred, which self-corrects if a typo ever produces a third.
  const openings = headers.filter((h) => h.number === 1);
  if (openings.length === 0) throw new Error('No "CHAPTER I." header found — cannot locate the body.');
  const exact = openings.filter((h) => headers.length - headers.indexOf(h) === EXPECTED_CHAPTERS);
  const opening = exact.length > 0 ? exact[exact.length - 1] : openings[openings.length - 1];
  const body = headers.slice(headers.indexOf(opening));

  // Chapter numbers come from POSITION, never from the printed numeral.
  // entries.chapter is the pane's loading unit and must be unique: taking
  // the numerals at face value would number two chapters 12 and two 9,
  // silently merging two pairs of chapters into one loading unit apiece and
  // colliding their TOC rows. The displayed numeral is derived from the
  // position too, so the table of contents reads XIII and XIX instead of
  // repeating XII and IX — that corrects a navigation label only; no
  // chapter text is altered.
  return body.map((h, i) => {
    const from = h.line + 1;
    const to = i + 1 < body.length ? body[i + 1].line : lines.length;
    return {
      number: i + 1,
      roman: intToRoman(i + 1),
      printedRoman: h.printed,
      lines: lines.slice(from, to),
    };
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
    // What the body actually printed. Kept even when it equals `roman`, so
    // the bundle records the source's own numbering rather than only the
    // corrected one — the two disagree at positions 13 and 19.
    printedRoman: chapter.printedRoman,
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
    // A missing ALL-CAPS title is NOT a failure. Chapter VII genuinely has
    // none: its body opens straight onto the italic heading "_An Account of
    // the Persecutions in Bohemia under the Papacy._", which carries the
    // same words the CONTENTS page prints in capitals. It is reported so
    // the omission stays visible, and the chapter simply reads "Chapter VII"
    // in the table of contents with that heading as its first child.
    const named = c.units.filter((u) => u.heading !== null).length;
    const shouldBeChildless = EXPECTED_CHILDLESS.includes(c.number);
    if (shouldBeChildless && named > 0) {
      problems.push(`Chapter ${c.roman} was expected to have no named sub-entries but parsed ${named}`);
    }
    if (!shouldBeChildless && named === 0) {
      problems.push(`Chapter ${c.roman} parsed no named sub-entries — heading detection may have failed`);
    }
  }
  const misnumbered = chapters.filter((c) => c.printedRoman !== c.roman);
  if (misnumbered.length > 0) {
    console.warn(
      '  ! body chapter headers misnumbered in the source (corrected by position): ' +
      misnumbered.map((c) => `printed ${c.printedRoman} at position ${c.number} -> ${c.roman}`).join('; '),
    );
  }
  const untitled = chapters.filter((c) => !c.title).map((c) => c.roman);
  if (untitled.length > 0) {
    console.warn(`  ! no ALL-CAPS body title: ${untitled.join(', ')} (see validate() — not a failure)`);
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
      // Anomalies found in the source and handled rather than hidden — see
      // splitChapters() and validate(). Recorded here so a reader of the
      // bundle sees them without reading the builder.
      source_anomalies: [
        ...chapters
          .filter((c) => c.printedRoman !== c.roman)
          .map((c) => `body header at position ${c.number} is printed "CHAPTER ${c.printedRoman}." ` +
            `(CONTENTS correctly says ${c.roman}); numbering taken from position, text unaltered`),
        ...chapters
          .filter((c) => !c.title)
          .map((c) => `chapter ${c.roman} has no ALL-CAPS body title; its opening italic heading ` +
            'carries the same words the CONTENTS page prints in capitals'),
      ],
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
