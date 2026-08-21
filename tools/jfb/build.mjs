// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads Jamieson, Fausset and Brown's Commentary Critical and
// Explanatory on the Whole Bible (1871) as OSIS XML, extracts its
// verse-anchored comment blocks, and writes jfb.json — a bundle shaped to
// feed Foundation's verse-keyed import (one source, one `books` row per
// Bible book, one entry per comment block).
//
// PROVENANCE — read before changing any URL below.
// Source: the CrossWire Bible Society's `jfb` repository
//   https://gitlab.com/crosswire-bible-society/jfb
// whose module config declares `DistributionLicense=Public Domain` and
// `TextSource=https://ccel.org/ccel/j/jamieson/jfb/cache/jfb.txt`. All three
// authors (Robert Jamieson 1802–1880, A. R. Fausset 1821–1910, David Brown
// 1803–1897) died well over a century ago. The build refuses to proceed
// unless the .conf still declares itself public domain, mirroring the same
// check in josephus/build.mjs and smiths-dictionary/build.mjs.
//
// WHAT IS EXCLUDED, AND WHY.
// JFB ships a large body of front matter that is not verse-anchored:
// Jamieson's introduction to the Pentateuch and Historical Books, Fausset's
// introductions to the Poetical and Prophetical Books, David Brown's two
// chronological tables (the Parables and the Miracles of Christ), the
// per-book introductions, and the OSIS header itself. None of it can be tied
// to a verse, so none of it can be shown in a verse-keyed footer, and it is
// dropped here rather than smuggled in under an arbitrary verse. This is the
// same call made for Whiston's translator footnotes in josephus/build.mjs
// and the editorial footnotes in the ANF/NPNF builds. Every excluded block is
// logged to jfb-exclusions.txt with its byte count and opening words, so the
// decision stays auditable instead of invisible.
//
// WHY A FLAT MILESTONE STREAM, NOT A DOM WALK.
// OSIS marks verses with milestones — <verse sID=.../> ... <verse eID=.../> —
// and in this file a single comment routinely opens inside one <p> and closes
// inside a later one (Genesis 2:1 spans three paragraphs). Element nesting
// therefore cannot be used as the extraction unit: a DOM walk keyed on <p>
// truncates such comments at the first paragraph. This script scans the file
// as a flat token stream and treats the sID/eID pair as the only boundary
// that matters, rebuilding paragraph breaks from the <p> tags it passes.
//
// Resumable: raw XML is cached under raw/, so a re-run skips the download.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(HERE, 'raw');
const OUTPUT_PATH = join(HERE, 'jfb.json');
const DEPLOY_PATH = join(HERE, '..', '..', 'public', 'library', 'commentaries', 'jfb.json');
const EXCLUSIONS_PATH = join(HERE, 'jfb-exclusions.txt');

const BASE_URL = 'https://gitlab.com/crosswire-bible-society/jfb/-/raw/master';
const XML_URL = `${BASE_URL}/jfb.osis.xml`;
const CONF_URL = `${BASE_URL}/jfb.conf`;

const TITLE = 'Jamieson, Fausset & Brown Commentary (1871)';
const LICENSE_NOTE =
  'Robert Jamieson (1802–1880), A. R. Fausset (1821–1910) and David Brown (1803–1897), '
  + 'Commentary Critical and Explanatory on the Whole Bible (1871) — public domain; all three '
  + 'authors died more than a century ago. Text from the CrossWire Bible Society\'s OSIS edition '
  + '(gitlab.com/crosswire-bible-society/jfb, DistributionLicense: Public Domain), itself derived '
  + 'from CCEL\'s transcription. Only verse-anchored comments are imported: the introductions and '
  + 'the chronological tables of the Parables and Miracles are excluded, since they anchor to no '
  + 'verse. Built by jfb/build.mjs.';

// OSIS book abbreviations in canonical Protestant order, paired with the book
// names Foundation uses (src/bibleMeta.ts CANONICAL_BOOKS). Duplicated here
// rather than imported because this script runs outside the app's TypeScript
// build; the JFB file was verified to use exactly these 66 abbreviations.
const OSIS_BOOK_IDS = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut',
  'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
  '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra',
  'Neh', 'Esth', 'Job', 'Ps', 'Prov',
  'Eccl', 'Song', 'Isa', 'Jer', 'Lam',
  'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
  'Obad', 'Jonah', 'Mic', 'Nah', 'Hab',
  'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts',
  'Rom', '1Cor', '2Cor', 'Gal', 'Eph',
  'Phil', 'Col', '1Thess', '2Thess', '1Tim',
  '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas',
  '1Pet', '2Pet', '1John', '2John', '3John',
  'Jude', 'Rev',
];
const CANONICAL_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy',
  'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra',
  'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations',
  'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk',
  'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts',
  'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy',
  '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John',
  'Jude', 'Revelation',
];
const OSIS_TO_CANONICAL = new Map(OSIS_BOOK_IDS.map((id, i) => [id, CANONICAL_BOOKS[i]]));
const BOOK_ORDER = new Map(CANONICAL_BOOKS.map((name, i) => [name, i]));

// ---------- download ----------

async function fetchCached(url, filename, refetch) {
  const cached = join(RAW_DIR, filename);
  if (!refetch && existsSync(cached)) {
    console.log(`  reusing raw/${filename}`);
    return readFile(cached, 'utf8');
  }
  console.log(`  downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${url}`);
  const text = await res.text();
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(cached, text, 'utf8');
  return text;
}

// Refuse to build from a module that no longer declares itself public
// domain. Foundation only ever ships public-domain or explicitly
// license-checked texts, and a silent upstream licence change must stop the
// build rather than quietly ship a restricted text.
function assertPublicDomain(conf) {
  const line = /^DistributionLicense=(.*)$/m.exec(conf);
  if (!line) throw new Error('jfb.conf declares no DistributionLicense — refusing to build.');
  const licence = line[1].trim();
  if (!/^public domain$/i.test(licence)) {
    throw new Error(
      `jfb.conf declares DistributionLicense="${licence}", not "Public Domain" — refusing to build.`,
    );
  }
  console.log(`  licence check passed: DistributionLicense=${licence}`);
}

// ---------- text helpers ----------

// The file uses exactly one entity (&amp;) and no numeric references, but the
// other four predefined XML entities are decoded too so an upstream text
// revision can't silently leave "&quot;" in the reader's face.
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function squash(s) {
  return s.replace(/[ \t\r\n]+/g, ' ').trim();
}

// Strip tags for logging/heading purposes — keeps only the visible text.
// Tags become a space so words either side don't run together, which leaves
// a gap before any punctuation that followed a tag ("Ge 2:1 ."); that gap is
// closed again here so headings read as written.
function plainText(xml) {
  return squash(decodeEntities(xml.replace(/<[^>]*>/g, ' '))).replace(/\s+([.,;:!?])/g, '$1');
}

// Tidy a rebuilt comment: collapse runs of whitespace inside each paragraph,
// drop empty ones, and join with the blank-line separator the rest of the app
// already uses to mark paragraph breaks (see smithsImport.ts, which splits
// article text on a blank-line boundary).
//
// A bold run that straddles a paragraph break would leave one paragraph with
// an odd number of ** markers and turn everything after it bold, so any
// unbalanced paragraph is closed off here.
function normalizeParagraphs(parts) {
  return parts
    .map((p) => squash(decodeEntities(p)).replace(/\*\*\s*\*\*/g, ''))
    .map((p) => ((p.match(/\*\*/g) ?? []).length % 2 === 1 ? `${p}**` : p))
    .filter((p) => p.replace(/\*/g, '').trim())
    .join('\n\n');
}

// ---------- verse reference helpers ----------

// Turn the source's enumerated osisID list ("Gen.2.5 Gen.2.6") into the
// covered-verse range string Foundation stores in entries.position_ref, in
// the same notation the Companion Bible's Structure lines already use and
// versesInRefRange() in src/components/Pane.tsx already parses: a single
// verse as "5", a contiguous run as "5-6", anything else as a comma list.
//
// Only the verse numbers go in — the entry's own book and chapter already
// carry the rest, and every JFB comment was verified to stay inside one
// chapter (the importer re-checks rather than trusting that).
function formatVerseRange(verses) {
  const contiguous = verses.every((v, i) => i === 0 || v === verses[i - 1] + 1);
  if (verses.length === 1) return String(verses[0]);
  if (contiguous) return `${verses[0]}-${verses[verses.length - 1]}`;
  return verses.join(', ');
}

// Parse a <verse> osisID into { book, chapter, verses }. Every failure mode
// throws: a comment whose reference can't be read is a bug in this parser or
// a change upstream, and either way guessing would put commentary against the
// wrong verse. Same "reject rather than guess" rule as the Companion Bible
// notation parser.
function parseOsisId(osisId, where) {
  const tokens = osisId.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) throw new Error(`${where}: empty osisID`);
  let book = null;
  let chapter = null;
  const verses = [];
  for (const token of tokens) {
    const m = /^([0-9A-Za-z]+)\.(\d+)\.(\d+)$/.exec(token);
    if (!m) throw new Error(`${where}: osisID token "${token}" is not Book.Chapter.Verse`);
    const canonical = OSIS_TO_CANONICAL.get(m[1]);
    if (!canonical) throw new Error(`${where}: unknown OSIS book "${m[1]}"`);
    const ch = Number(m[2]);
    if (book === null) { book = canonical; chapter = ch; }
    else if (canonical !== book) throw new Error(`${where}: osisID "${osisId}" spans two books`);
    else if (ch !== chapter) throw new Error(`${where}: osisID "${osisId}" spans two chapters`);
    verses.push(Number(m[3]));
  }
  verses.sort((a, b) => a - b);
  return { book, chapter, verses };
}

// ---------- the parser ----------

// Walks the file once as a flat token stream. Everything between a
// <verse sID> and its matching <verse eID> becomes one comment; everything
// outside is either a section heading (kept, attached to the comment that
// follows) or front matter (dropped and logged).
//
// Returns { comments, exclusions, stats }.
function parseJfb(xml) {
  const comments = [];
  const exclusions = [];
  const stats = { headingsInside: 0, headingsOutside: 0, chapterLabels: 0, unclosed: 0 };

  // State while inside a comment.
  let open = null;          // { book, chapter, verses, range, heading, parts }
  let buffer = '';          // text accumulated for the current paragraph
  // State while outside a comment.
  let pendingHeading = null;   // nearest preceding x-s3 title, not yet attached
  let outside = '';            // raw XML skipped since the last comment closed
  let currentBook = null;      // for labelling exclusions

  const flushParagraph = () => {
    if (!open) return;
    open.parts.push(buffer);
    buffer = '';
  };

  const recordExclusion = (raw) => {
    const text = plainText(raw);
    if (!text) return;
    exclusions.push({ book: currentBook, bytes: Buffer.byteLength(raw, 'utf8'), text });
  };

  // One pass over every tag; the gaps between tags are character data.
  const tagRe = /<[^>]*>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(xml)) !== null) {
    const chars = xml.slice(last, m.index);
    last = tagRe.lastIndex;
    const tag = m[0];
    if (open) buffer += chars;
    else outside += chars;

    // --- verse milestones: the only boundaries that matter ---
    const sID = /^<verse\s+sID="[^"]*"\s+osisID="([^"]*)"/.exec(tag);
    if (sID) {
      if (open) {
        // An unterminated span would swallow the next comment whole. Close it
        // rather than merging two comments together, and count it.
        stats.unclosed++;
        flushParagraph();
        comments.push({ ...open, text: normalizeParagraphs(open.parts) });
        open = null;
      }
      recordExclusion(outside);
      outside = '';
      const where = `verse osisID="${sID[1]}"`;
      const { book, chapter, verses } = parseOsisId(sID[1], where);
      open = {
        book,
        chapter,
        verses,
        range: formatVerseRange(verses),
        heading: pendingHeading,
        parts: [],
      };
      if (pendingHeading) stats.headingsOutside++;
      // Consumed: a heading labels the one comment that follows it, so it
      // must not repeat above every later comment in the section.
      pendingHeading = null;
      buffer = '';
      continue;
    }
    if (/^<verse\s+eID=/.test(tag)) {
      if (open) {
        flushParagraph();
        comments.push({ ...open, text: normalizeParagraphs(open.parts) });
        open = null;
      }
      outside = '';
      continue;
    }

    // --- section headings ---
    // x-s3 is JFB's pericope heading ("Ge 2:2-7. The First Sabbath."), the
    // one worth showing. x-s2 is always a bare "CHAPTER n" label (verified:
    // all 215 distinct values), which is redundant in a chapter-scoped
    // footer, so it is counted and dropped rather than rendered as noise.
    const title = /^<title\s+type="(x-s2|x-s3)"/.exec(tag);
    if (title) {
      const close = xml.indexOf('</title>', tagRe.lastIndex - tag.length);
      const inner = close === -1 ? '' : xml.slice(tagRe.lastIndex, close);
      const text = plainText(inner);
      if (title[1] === 'x-s2') {
        stats.chapterLabels++;
      } else if (open) {
        // A heading already inside this span belongs to this comment and
        // wins over any pending one, so a block never carries two.
        open.heading = text || open.heading;
        stats.headingsInside++;
      } else {
        pendingHeading = text || null;
      }
      // Skip the title's own content so it can't leak into the comment text
      // or into an exclusion record.
      if (close !== -1) {
        tagRe.lastIndex = close + '</title>'.length;
        last = tagRe.lastIndex;
      }
      continue;
    }

    // --- book boundary, for exclusion labelling ---
    const book = /^<div\s+type="book"\s+osisID="([^"]*)"/.exec(tag);
    if (book) {
      recordExclusion(outside);
      outside = '';
      currentBook = OSIS_TO_CANONICAL.get(book[1]) ?? book[1];
      // A book boundary also drops any heading left dangling by the previous
      // book, so it can't attach across the seam.
      pendingHeading = null;
      continue;
    }

    // --- inline markup inside a comment ---
    if (open) {
      // <hi type="bold"> carries the verse-number lemma that opens nearly
      // every comment ("5-6. rain, mist--"). Preserved as ** ** so the footer
      // can render it as the cell's lead-in; it is the single most useful
      // piece of formatting in the text.
      if (/^<hi\s+type="bold"/.test(tag)) buffer += '**';
      else if (tag === '</hi>') buffer += '**';
      // Paragraph boundaries inside a span (Genesis 2:1 has two) become real
      // paragraph breaks — parts[] is the paragraph list, joined with a blank
      // line by normalizeParagraphs.
      else if (/^<\/p>/.test(tag) || /^<p[\s>]/.test(tag)) flushParagraph();
      // <reference> keeps its visible text only: cross-reference linking is
      // future work, and the visible form ("Ge 1:11") is what the reader
      // needs meanwhile. src/components/ReferenceText.tsx already turns text
      // like that into a clickable reference at render time.
      continue;
    }
  }

  if (open) {
    stats.unclosed++;
    flushParagraph();
    comments.push({ ...open, text: normalizeParagraphs(open.parts) });
  }
  recordExclusion(outside + xml.slice(last));

  return { comments, exclusions, stats };
}

// ---------- bundling ----------

// Group comments into one bundle book per Bible book, in canonical order,
// with comments sorted by chapter then first covered verse. Comments that
// overlap (a broad range plus a narrower comment nested inside it — 2,713
// verses in this text) keep the broader one first, which is the order the
// footer renders them in.
function bundleBooks(comments) {
  const byBook = new Map();
  for (const c of comments) {
    if (!byBook.has(c.book)) byBook.set(c.book, []);
    byBook.get(c.book).push(c);
  }
  const books = [];
  for (const name of CANONICAL_BOOKS) {
    const rows = byBook.get(name);
    if (!rows) continue;
    rows.sort((a, b) => {
      if (a.chapter !== b.chapter) return a.chapter - b.chapter;
      if (a.verses[0] !== b.verses[0]) return a.verses[0] - b.verses[0];
      // Same starting verse: the wider comment is the outer one.
      return b.verses.length - a.verses.length;
    });
    books.push({
      book: name,
      comments: rows.map((c) => ({
        chapter: c.chapter,
        verse: c.verses[0],
        verses: c.range,
        heading: c.heading ?? null,
        text: c.text,
      })),
    });
  }
  const unknown = [...byBook.keys()].filter((b) => !BOOK_ORDER.has(b));
  if (unknown.length) throw new Error(`Comments for unrecognised books: ${unknown.join(', ')}`);
  return books;
}

async function writeExclusionReport(exclusions, stats, commentCount) {
  const lines = [
    'JFB build — excluded blocks',
    '',
    'Everything below sits outside a <verse sID>/<verse eID> pair in',
    'jfb.osis.xml and so anchors to no verse: the OSIS header, the general',
    'introductions (Jamieson on the Pentateuch and Historical Books, Fausset',
    'on the Poetical and Prophetical Books), the per-book introductions, and',
    "David Brown's chronological tables of the Parables and the Miracles.",
    'None of it can be placed in a verse-keyed footer, so none of it is',
    'imported. Listed here so the decision stays auditable.',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Comments kept: ${commentCount}`,
    `Blocks excluded: ${exclusions.length}`,
    `Bytes excluded: ${exclusions.reduce((n, e) => n + e.bytes, 0)}`,
    `Chapter labels dropped (<title type="x-s2">, always "CHAPTER n"): ${stats.chapterLabels}`,
    `Section headings attached from outside a verse span: ${stats.headingsOutside}`,
    `Section headings attached from inside a verse span: ${stats.headingsInside}`,
    '',
    '---',
    '',
  ];
  for (const e of exclusions) {
    const opening = e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text;
    lines.push(`[${e.book ?? 'header'}] ${e.bytes} bytes — ${opening}`);
  }
  await writeFile(EXCLUSIONS_PATH, `${lines.join('\n')}\n`, 'utf8');
}

// ---------- main ----------

async function main() {
  const refetch = process.argv.includes('--refetch');

  console.log('Fetching source…');
  const conf = await fetchCached(CONF_URL, 'jfb.conf', refetch);
  assertPublicDomain(conf);
  const xml = await fetchCached(XML_URL, 'jfb.osis.xml', refetch);

  console.log('Parsing…');
  const { comments, exclusions, stats } = parseJfb(xml);
  if (stats.unclosed > 0) {
    throw new Error(`${stats.unclosed} verse span(s) never closed — the file's milestones are malformed.`);
  }

  const empty = comments.filter((c) => !c.text);
  if (empty.length) {
    throw new Error(
      `${empty.length} comment block(s) parsed to empty text, first at `
      + `${empty[0].book} ${empty[0].chapter}:${empty[0].range}.`,
    );
  }

  const books = bundleBooks(comments);
  const withHeading = comments.filter((c) => c.heading).length;
  const multiVerse = comments.filter((c) => c.verses.length > 1).length;

  console.log(`  ${comments.length} comment blocks across ${books.length} books`);
  console.log(`  ${multiVerse} cover a verse range; ${withHeading} carry a section heading`);
  console.log(`  ${exclusions.length} non-verse blocks excluded (see jfb-exclusions.txt)`);

  const bundle = {
    metadata: {
      title: TITLE,
      author: 'Robert Jamieson, A. R. Fausset and David Brown',
      license_note: LICENSE_NOTE,
      source_url: XML_URL,
      built_at: new Date().toISOString(),
      comment_count: comments.length,
    },
    books,
  };

  const json = JSON.stringify(bundle);
  await writeFile(OUTPUT_PATH, json, 'utf8');
  await mkdir(dirname(DEPLOY_PATH), { recursive: true });
  await writeFile(DEPLOY_PATH, json, 'utf8');
  await writeExclusionReport(exclusions, stats, comments.length);

  console.log(`Wrote ${OUTPUT_PATH} (${(json.length / 1e6).toFixed(1)} MB)`);
  console.log(`Wrote ${DEPLOY_PATH}`);
}

main().catch((err) => {
  console.error(`\nBuild failed: ${err.message}`);
  process.exit(1);
});
