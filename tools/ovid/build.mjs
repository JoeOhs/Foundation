// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads the two Project Gutenberg texts that together carry Henry
// T. Riley's 1851 prose translation of Ovid's Metamorphoses, parses their
// Book / Fable structure, captures Riley's per-Fable EXPLANATION sections and
// his numbered footnotes, strips the reprints' page/line locator numbers, and
// writes ovid.json — a bundle shaped to feed Foundation's compound-work
// import (one source, 15 books, a 2-level Book → Fable toc_entries
// hierarchy). Download-and-clean only: does not touch src-tauri/, src/db.ts
// or src/importer.ts, and is not part of the app runtime.
//
// TRANSLATION PROVENANCE — read before changing any ID below.
// Both texts must be the RILEY translation (Henry T. Riley, 1851, Bohn's
// Classical Library; translator died 1878). The two Gutenberg transcriptions
// are of the Bell (1893) and McKay (1899) reprints, both long out of
// copyright. Modern translations of the Metamorphoses — Melville, Lombardo,
// Martin, Raeburn and similar — are separately copyrighted and must NEVER be
// substituted in. The script verifies Riley's name in each downloaded file's
// Gutenberg header and refuses to build if it is missing. Unlike the Talmud
// there is no licence exception to guard here; this is an unambiguous
// public-domain import, and the guard exists only to stop the wrong edition
// being swapped in by accident.
//
// PARSER STATUS — READ THIS BEFORE TRUSTING A BUILD.
// The structural patterns below (book, fable, explanation, footnote and
// locator shapes) were written against the printed edition's known layout,
// not against a byte-for-byte reading of these two transcriptions. Run
// `node build.mjs --inspect` first: it downloads and prints every candidate
// structural line it can see, so the patterns can be checked against what
// the files actually contain before any bundle is shipped. `validate()`
// hard-fails on a shape that doesn't match the printed book (15 books, every
// book with fables, every fable with prose), so a drifted parser stops the
// build rather than emitting a bundle that installs cleanly and is quietly
// missing half of Ovid.
//
// Resumable: raw text is cached under raw/, so a re-run skips files already
// downloaded.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download
//   node build.mjs --inspect    print candidate structural lines and stop
//   node build.mjs --audit      also print footnote mapping, per fable

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const OUTPUT_PATH = path.join(__dirname, 'ovid.json');
const DEPLOY_PATH = path.join(__dirname, '..', '..', 'public', 'library', 'historical', 'ovid.json');
const REQUEST_DELAY_MS = 800;
const USER_AGENT =
  'FoundationOvidBuilder/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

// The two Gutenberg texts, in reading order. Together they are one work —
// they fold into a single source with 15 books, the way Josephus's four
// texts fold into one. `expectedBooks` is the run of book numbers each file
// is supposed to contain, and is asserted after parsing: a file that yields
// a different run is either the wrong edition or a parser that has drifted.
const VOLUMES = [
  { id: 'i-vii', gutenbergId: 21765, reprint: 'George Bell & Sons, London, 1893', expectedBooks: [1, 2, 3, 4, 5, 6, 7] },
  { id: 'viii-xv', gutenbergId: 26073, reprint: 'David McKay, Philadelphia, 1899', expectedBooks: [8, 9, 10, 11, 12, 13, 14, 15] },
];

const ROMAN_NUMERALS = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII',
  'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
];

// Riley's books are headed with the ordinal spelled out ("BOOK THE
// THIRTEENTH."), not with a numeral, so the ordinal words are the lookup.
const ORDINAL_WORDS = [
  '', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH',
  'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH', 'THIRTEENTH', 'FOURTEENTH', 'FIFTEENTH',
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

async function loadRaw(volume, refetch) {
  const cachePath = path.join(RAW_DIR, `${volume.gutenbergId}.txt`);
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
    `https://www.gutenberg.org/cache/epub/${volume.gutenbergId}/pg${volume.gutenbergId}.txt`,
    `https://www.gutenberg.org/files/${volume.gutenbergId}/${volume.gutenbergId}-8.txt`,
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
  if (!text) throw new Error(`Could not download PG ${volume.gutenbergId}: ${lastErr?.message ?? lastErr}`);
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(cachePath, text, 'utf8');
  await sleep(REQUEST_DELAY_MS);
  return text;
}

// Hard gate on translation provenance — see the header note. A file whose
// Gutenberg header doesn't name Riley is not the edition this bundle is
// allowed to ship, so the build fails rather than quietly importing it.
function assertRiley(volume, raw) {
  const header = normalizeWhitespace(raw.slice(0, 4000));
  if (!/Henry\s+T\.?\s+Riley/i.test(header)) {
    throw new Error(
      `PG ${volume.gutenbergId} does not name Henry T. Riley as translator in its Gutenberg ` +
      'header. Refusing to build: modern translations of the Metamorphoses are separately ' +
      'copyrighted and must never be substituted for Riley\'s.',
    );
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

// "BOOK THE THIRTEENTH." — the ordinal is spelled out. A numeral form is
// accepted too so a differently-set reprint doesn't silently yield no books.
const BOOK_RE = new RegExp(`^\\s*BOOK\\s+(?:THE\\s+(${ORDINAL_WORDS.slice(1).join('|')})|([IVX]+))\\.?\\s*$`, 'i');
// "FABLE VII." — always a numeral, sometimes with a title running on.
const FABLE_RE = /^\s*FABLE\s+([IVXL]+)\.?\s*(.*)$/i;
// "EXPLANATION." on its own line opens Riley's commentary on the fable above.
const EXPLANATION_RE = /^\s*EXPLANATION\.?\s*$/i;
// The endnote block that closes each book.
const FOOTNOTE_BLOCK_RE = /^\s*FOOTNOTES?:?\s*$/i;
// One endnote. Two shapes are accepted because the two transcriptions are of
// different reprints: Gutenberg's bracketed form, and a bare numbered form.
// Either way the note opens by naming the Latin line it hangs on, "Ver. 5."
const FOOTNOTE_BODY_RE = /^\s*(?:\[Footnote\s+(\d{1,4})\s*:\s*|(\d{1,4})\s*[.)]\s+)(.*)$/;
// The Latin line reference a note keys itself to, at the head of its text.
const VER_RE = /^\s*Ver\.\s*(\d{1,4})/i;
// The reprints' page/line locators, interleaved mid-sentence:
// "...the whole universe,2 I. 6-26 which men...". Roman book numeral, a dot,
// then a line or line-range. These are typesetting artifacts, not Ovid's or
// Riley's words, and are stripped from the reading text entirely — but their
// numbers are harvested first, because they are the only thing in the file
// that says which Latin lines a given Fable covers.
const LOCATOR_RE = /\s*\b([IVX]{1,5})\.\s*(\d{1,4})(?:\s*[-–]\s*(\d{1,4}))?\b/g;
// Riley's inline footnote markers: a bracketed number, "[12]", or the bare
// digits the older transcription fuses onto the preceding word ("universe,2").
const INLINE_MARKER_RE = /\s*\[(\d{1,4})\]/g;
const FUSED_MARKER_RE = /([A-Za-z.,;:!?'")])\d{1,3}(?=\s|$)/g;

// Front matter excluded by name, and logged rather than silently dropped —
// this project's standing audit-trail rule. Both reprints' publisher
// introductions and the "Synoptical View" (a book-by-book plot synopsis) are
// editorial framing, not Fable content, and the generated toc_entries
// supersede the synopsis anyway. Same precedent as Whiston's Josephus front
// matter and JFB's introductions.
const FRONT_MATTER_MARKERS = [
  /^\s*SYNOPTICAL\s+VIEW/i,
  /^\s*(?:PUBLISHERS?'?S?\s+)?(?:INTRODUCTION|PREFACE|ADVERTISEMENT)\b/i,
  /^\s*THE\s+LIFE\s+OF\s+OVID/i,
];

function normalizeWhitespace(text) {
  return text.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
}

// Fable counts run past fifteen in the longer books, so the display numeral
// is generated rather than looked up in ROMAN_NUMERALS (which only covers the
// fifteen books). A fable falling off the end of that table would otherwise
// read "Fable 16" in the dropdown while every other row read "Fable XV".
function intToRoman(n) {
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  let rest = n;
  for (const [value, numeral] of table) {
    while (rest >= value) { out += numeral; rest -= value; }
  }
  return out;
}

function romanToInt(s) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i].toUpperCase()] ?? 0;
    const next = map[s[i + 1]?.toUpperCase()] ?? 0;
    total += cur < next ? -cur : cur;
  }
  return total;
}

// Harvests every locator's line numbers from a chunk, then removes them. The
// harvest has to happen before the strip: the locators are the only record of
// which Latin lines a Fable covers, and that mapping is what files each
// footnote under its owning Fable rather than dumping a whole book's notes in
// one place.
function harvestAndStripLocators(text, lineNumbers) {
  const stripped = text.replace(LOCATOR_RE, (_m, _roman, from, to) => {
    lineNumbers.push(Number(from));
    if (to) lineNumbers.push(Number(to));
    return ' ';
  });
  return stripped;
}

// Only strips a marker that is *fused* to the preceding word with no space
// ("universe,2 which"), which in running prose is never anything but a
// footnote reference, or one already bracketed. A digit standing alone
// between spaces is left untouched: it may legitimately belong to the text,
// and a wrong strip silently rewrites Riley.
function stripInlineMarkers(text, markers) {
  return text
    .replace(INLINE_MARKER_RE, (_m, n) => { markers.push(Number(n)); return ''; })
    .replace(FUSED_MARKER_RE, '$1');
}

// Splits a run of raw lines into paragraphs on blank lines, cleaning each.
function toParagraphs(lines, lineNumbers, markers) {
  const paragraphs = [];
  let buffer = [];
  const flush = () => {
    if (buffer.length === 0) return;
    let text = normalizeWhitespace(buffer.join('\n'));
    text = harvestAndStripLocators(text, lineNumbers);
    text = stripInlineMarkers(text, markers);
    text = normalizeWhitespace(text);
    if (text) paragraphs.push(text);
    buffer = [];
  };
  for (const line of lines) {
    if (line.trim() === '') flush();
    else buffer.push(line);
  }
  flush();
  return paragraphs;
}

// Drops everything before the first BOOK heading, reporting what was dropped
// so front-matter exclusion stays an audited decision rather than a silent
// one.
function splitOffFrontMatter(lines, volume, log) {
  const firstBook = lines.findIndex((l) => BOOK_RE.test(l));
  if (firstBook === -1) {
    throw new Error(`PG ${volume.gutenbergId}: no "BOOK THE ..." heading found — parser has drifted.`);
  }
  const front = lines.slice(0, firstBook);
  for (const marker of FRONT_MATTER_MARKERS) {
    const hit = front.find((l) => marker.test(l));
    if (hit) log.push(`PG ${volume.gutenbergId}: excluded front matter — "${hit.trim()}"`);
  }
  log.push(
    `PG ${volume.gutenbergId}: excluded ${front.length} lines of front matter ` +
    `(publisher's introduction, Synoptical View, title pages) before "${lines[firstBook].trim()}".`,
  );
  return lines.slice(firstBook);
}

// Parses one volume into books → fables, plus each book's endnote list.
function parseVolume(volume, raw, log, anomalies) {
  assertRiley(volume, raw);
  let lines = stripGutenbergWrapper(raw).split('\n');
  lines = splitOffFrontMatter(lines, volume, log);

  const books = [];
  let book = null;
  let fable = null;
  let buffer = [];
  // Where the current run of lines belongs: the fable's prose, Riley's
  // explanation of it, or the book's endnote block.
  let mode = 'prose';

  const flush = () => {
    if (!fable || buffer.length === 0) { buffer = []; return; }
    const target = mode === 'explanation' ? fable.explanation : fable.paragraphs;
    target.push(...toParagraphs(buffer, fable.lineNumbers, fable.markers));
    buffer = [];
  };

  // Book and fable numbers come from POSITION, never from the printed
  // numeral. This is the lesson Fox's Book of Martyrs taught on first contact
  // with its real Gutenberg text (see 02aaa00): that book prints two
  // duplicate chapter numerals, and taking them at face value would have
  // merged two pairs of chapters — entries.chapter is the pane's loading
  // unit, so a duplicate number silently fuses two units and collides their
  // TOC rows. The same fault is available here, and the same defence applies.
  // The printed numeral is still read, but only to be checked against the
  // position and reported when they disagree.
  const startBook = (printedNumber, rawHeading) => {
    flush();
    // `expectedBooks` is this volume's own run (I–VII or VIII–XV), so
    // position within the volume gives the book its number.
    const number = volume.expectedBooks[books.length];
    if (number === undefined) {
      throw new Error(
        `PG ${volume.gutenbergId}: found more book headings than the ${volume.expectedBooks.length} ` +
        `this volume should contain (at "${rawHeading.trim()}").`,
      );
    }
    if (printedNumber !== number) {
      anomalies.push(
        `PG ${volume.gutenbergId}: book at position ${books.length + 1} of this volume is printed ` +
        `"${rawHeading.trim()}" (numeral ${printedNumber}) but sits where Book ${number} belongs. ` +
        'Numbered from position; the printed numeral is not used.',
      );
    }
    book = { number, roman: ROMAN_NUMERALS[number], fables: [], notes: [] };
    books.push(book);
    fable = null;
    mode = 'prose';
  };

  const startFable = (printedNumber, title, rawHeading) => {
    flush();
    if (!book) throw new Error(`PG ${volume.gutenbergId}: FABLE ${printedNumber} before any BOOK heading.`);
    // Position within the book, for the same reason as above: the fable
    // number becomes entries.chapter and half of the "I.7" citation, so a
    // repeated printed numeral would merge two fables and give two entries
    // the same reference.
    const number = book.fables.length + 1;
    if (printedNumber !== number) {
      anomalies.push(
        `PG ${volume.gutenbergId}: fable at position ${number} of Book ${book.roman} is printed ` +
        `"${rawHeading.trim()}" (numeral ${printedNumber}). Numbered from position; the printed ` +
        'numeral is not used.',
      );
    }
    fable = {
      number,
      roman: intToRoman(number),
      title: normalizeWhitespace(title ?? '').replace(/\s*\.\s*$/, ''),
      paragraphs: [],
      explanation: [],
      notes: [],
      lineNumbers: [],
      markers: [],
    };
    book.fables.push(fable);
    mode = 'prose';
  };

  // The endnote block runs to the end of the book. Each note is collected
  // with the Latin line it names, which is what maps it back to a fable.
  const collectNotes = (blockLines) => {
    const notes = [];
    let current = null;
    for (const line of blockLines) {
      const match = line.match(FOOTNOTE_BODY_RE);
      if (match) {
        if (current) notes.push(current);
        const number = Number(match[1] ?? match[2]);
        current = { number, ver: null, lines: [match[3]] };
      } else if (current) {
        current.lines.push(line);
      }
    }
    if (current) notes.push(current);
    return notes.map((n) => {
      let text = normalizeWhitespace(n.lines.join('\n')).replace(/\s*\]\s*$/, '');
      const ver = text.match(VER_RE);
      return { number: n.number, ver: ver ? Number(ver[1]) : null, text };
    });
  };

  let noteBuffer = null;
  for (const line of lines) {
    if (noteBuffer !== null) {
      // A note block ends at the next book heading; everything else in
      // between is note text (they wrap freely across lines).
      const bookMatch = line.match(BOOK_RE);
      if (!bookMatch) { noteBuffer.push(line); continue; }
      book.notes.push(...collectNotes(noteBuffer));
      noteBuffer = null;
    }
    const bookMatch = line.match(BOOK_RE);
    if (bookMatch) {
      const printed = bookMatch[1]
        ? ORDINAL_WORDS.indexOf(bookMatch[1].toUpperCase())
        : romanToInt(bookMatch[2]);
      if (printed > 0) { startBook(printed, line); continue; }
    }
    const fableMatch = line.match(FABLE_RE);
    if (fableMatch) { startFable(romanToInt(fableMatch[1]), fableMatch[2], line); continue; }
    if (EXPLANATION_RE.test(line)) { flush(); mode = 'explanation'; continue; }
    if (FOOTNOTE_BLOCK_RE.test(line)) { flush(); noteBuffer = []; continue; }
    buffer.push(line);
  }
  flush();
  if (noteBuffer !== null && book) book.notes.push(...collectNotes(noteBuffer));

  // Drop a heading that turned out to carry no prose — front-matter residue,
  // not content.
  for (const b of books) b.fables = b.fables.filter((f) => f.paragraphs.length > 0);
  return books.filter((b) => b.fables.length > 0);
}

// Files each of a book's endnotes under the fable whose Latin line-range
// contains the note's "Ver. N". The ranges come from the page-margin
// locators harvested while cleaning the prose, so this is derived from the
// text rather than assumed. A note whose Ver. can't be placed — no number, or
// no fable range covering it — is NOT guessed at: it goes to the book's last
// fable under an explicitly unmapped label, so it is visible and findable
// rather than silently filed against the wrong fable.
function mapNotesToFables(book, log) {
  for (const fable of book.fables) {
    fable.lineFrom = fable.lineNumbers.length ? Math.min(...fable.lineNumbers) : null;
    fable.lineTo = fable.lineNumbers.length ? Math.max(...fable.lineNumbers) : null;
  }
  const unmapped = [];
  for (const note of book.notes) {
    const owner = note.ver === null ? null : book.fables.find(
      (f) => f.lineFrom !== null && note.ver >= f.lineFrom && note.ver <= f.lineTo,
    );
    if (owner) owner.notes.push(note);
    else unmapped.push(note);
  }
  if (unmapped.length > 0) {
    const last = book.fables[book.fables.length - 1];
    last.unmappedNotes = unmapped;
    log.push(
      `Book ${book.roman}: ${unmapped.length} of ${book.notes.length} footnotes could not be ` +
      `mapped to a fable by line range; filed under Fable ${last.roman} and labelled ` +
      `"Notes — Book ${book.roman} (unmapped)".`,
    );
  }
  return unmapped.length;
}

// Prints every candidate structural line without building anything, so the
// patterns above can be checked against what the files actually contain
// before a bundle is trusted. See the PARSER STATUS note at the top.
function inspect(volume, raw) {
  const lines = stripGutenbergWrapper(raw).split('\n');
  console.log(`\n=== PG ${volume.gutenbergId} — ${lines.length} lines ===`);
  const counts = { book: 0, fable: 0, explanation: 0, footnoteBlock: 0, note: 0, locator: 0 };
  lines.forEach((line, i) => {
    if (BOOK_RE.test(line)) { counts.book++; console.log(`  ${i} BOOK      ${line.trim()}`); }
    else if (FABLE_RE.test(line)) { counts.fable++; console.log(`  ${i} FABLE     ${line.trim()}`); }
    else if (EXPLANATION_RE.test(line)) counts.explanation++;
    else if (FOOTNOTE_BLOCK_RE.test(line)) { counts.footnoteBlock++; console.log(`  ${i} FOOTNOTES ${line.trim()}`); }
    else if (FOOTNOTE_BODY_RE.test(line)) counts.note++;
    LOCATOR_RE.lastIndex = 0;
    if (LOCATOR_RE.test(line)) counts.locator++;
  });
  console.log(`  counts: ${JSON.stringify(counts)}`);
  // ALL-CAPS lines that matched nothing are the likeliest sign of a heading
  // convention these patterns don't know about.
  const unmatched = lines.filter(
    (l) => /^[A-Z][A-Z .,'\-—]{4,60}$/.test(l.trim())
      && !BOOK_RE.test(l) && !FABLE_RE.test(l) && !EXPLANATION_RE.test(l) && !FOOTNOTE_BLOCK_RE.test(l),
  );
  console.log(`  ${unmatched.length} unmatched ALL-CAPS lines (first 30):`);
  for (const l of unmatched.slice(0, 30)) console.log(`    ${l.trim()}`);
}

// Refuses to ship a half-read work. The printed book is known to contain
// fifteen books, each with fables, each fable with prose — anything else is
// a parser that has drifted, and stopping the build is better than a bundle
// that installs cleanly and is quietly missing half of Ovid.
function validate(books) {
  const problems = [];
  if (books.length !== 15) problems.push(`expected 15 books, parsed ${books.length}`);
  const numbers = books.map((b) => b.number).join(',');
  const expected = Array.from({ length: 15 }, (_, i) => i + 1).join(',');
  if (numbers !== expected) problems.push(`book numbers are ${numbers}, expected ${expected}`);
  for (const book of books) {
    if (book.fables.length === 0) problems.push(`Book ${book.roman} has no fables`);
    for (const fable of book.fables) {
      if (fable.paragraphs.length === 0) {
        problems.push(`Book ${book.roman} Fable ${fable.roman} has no prose`);
      }
    }
  }
  if (problems.length > 0) {
    throw new Error(`Parse validation failed:\n  - ${problems.join('\n  - ')}`);
  }
}

async function main() {
  const refetch = process.argv.includes('--refetch');
  const inspectOnly = process.argv.includes('--inspect');
  const audit = process.argv.includes('--audit');
  const log = [];
  // Faults in the printed source itself, recorded rather than hidden —
  // same treatment Fox's Book of Martyrs gives its two misnumbered chapters.
  const anomalies = [];
  let books = [];

  for (const volume of VOLUMES) {
    process.stdout.write(`Books ${volume.id.toUpperCase()} (PG ${volume.gutenbergId})… `);
    const raw = await loadRaw(volume, refetch);
    if (inspectOnly) { console.log(''); inspect(volume, raw); continue; }
    const parsed = parseVolume(volume, raw, log, anomalies);
    const got = parsed.map((b) => b.number);
    if (got.join(',') !== volume.expectedBooks.join(',')) {
      throw new Error(
        `PG ${volume.gutenbergId} yielded books [${got}], expected [${volume.expectedBooks}]. ` +
        'Either the wrong edition was downloaded or the parser has drifted; refusing to build.',
      );
    }
    books.push(...parsed);
    console.log(`${parsed.length} books, ${parsed.reduce((n, b) => n + b.fables.length, 0)} fables`);
  }

  if (inspectOnly) {
    console.log('\n--inspect only: nothing written. Check the patterns in build.mjs against the above.');
    return;
  }

  let unmappedTotal = 0;
  for (const book of books) unmappedTotal += mapNotesToFables(book, log);
  validate(books);

  const totalFables = books.reduce((n, b) => n + b.fables.length, 0);
  const totalParagraphs = books.reduce(
    (n, b) => n + b.fables.reduce((m, f) => m + f.paragraphs.length, 0), 0,
  );
  const totalNotes = books.reduce((n, b) => n + b.notes.length, 0);

  if (audit) {
    for (const book of books) {
      for (const fable of book.fables) {
        console.log(
          `  ${book.roman}.${fable.number}  lines ${fable.lineFrom ?? '?'}-${fable.lineTo ?? '?'}  ` +
          `${fable.paragraphs.length}¶  ${fable.explanation.length} expl  ${fable.notes.length} notes` +
          (fable.unmappedNotes ? `  +${fable.unmappedNotes.length} unmapped` : ''),
        );
      }
    }
  }

  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'The Metamorphoses of Ovid',
      translator: 'Henry T. Riley (1816–1878), prose translation first published 1851 in Bohn\'s Classical Library',
      source_site: 'https://www.gutenberg.org/',
      gutenberg_ids: VOLUMES.map((v) => v.gutenbergId),
      reprints: VOLUMES.map((v) => v.reprint),
      license_note:
        'Public domain — Publius Ovidius Naso (43 BC – AD 17/18), translated into English prose by ' +
        'Henry T. Riley (1851, Bohn\'s Classical Library; translator died 1878). Text from Project ' +
        'Gutenberg ebooks 21765 (Books I–VII, from the George Bell & Sons reprint of 1893) and 26073 ' +
        '(Books VIII–XV, from the David McKay reprint of 1899), which distributes them freely. ' +
        'Riley\'s per-Fable "Explanation" sections and his numbered footnotes are included, each at ' +
        'the foot of the fable it belongs to. The reprints\' page and line locator numbers, which the ' +
        'transcription interleaves mid-sentence, are stripped as typesetting artifacts; both ' +
        'publishers\' introductions and the Synoptical View are excluded as editorial front matter.',
      total_books: books.length,
      total_fables: totalFables,
      total_paragraphs: totalParagraphs,
      total_footnotes: totalNotes,
      unmapped_footnotes: unmappedTotal,
      exclusions: log,
      source_anomalies: anomalies,
    },
    books: books.map((b) => ({
      number: b.number,
      roman: b.roman,
      name: `Book ${b.roman}`,
      fables: b.fables.map((f) => ({
        number: f.number,
        roman: f.roman,
        title: f.title,
        line_from: f.lineFrom,
        line_to: f.lineTo,
        paragraphs: f.paragraphs,
        explanation: f.explanation,
        notes: f.notes.map((n) => ({ number: n.number, ver: n.ver, text: n.text })),
        unmapped_notes: (f.unmappedNotes ?? []).map((n) => ({ number: n.number, ver: n.ver, text: n.text })),
      })),
    })),
  };

  const json = JSON.stringify(bundle, null, 1);
  await fs.writeFile(OUTPUT_PATH, json, 'utf8');
  await fs.mkdir(path.dirname(DEPLOY_PATH), { recursive: true });
  await fs.writeFile(DEPLOY_PATH, json, 'utf8');
  console.log(`\n${totalFables} fables, ${totalParagraphs} paragraphs, ${totalNotes} footnotes across ${books.length} books`);
  for (const line of log) console.log(`  note: ${line}`);
  for (const line of anomalies) console.log(`  ANOMALY: ${line}`);
  console.log(`wrote ${OUTPUT_PATH}`);
  console.log(`wrote ${DEPLOY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
