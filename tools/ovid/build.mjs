// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): parses the two Project Gutenberg HTML texts that together carry Henry
// T. Riley's 1851 prose translation of Ovid's Metamorphoses, and writes
// ovid.json — a bundle shaped to feed Foundation's compound-work import (one
// source, 15 books, a 2-level Book → Fable toc_entries hierarchy). Parse and
// clean only: does not touch src-tauri/, src/db.ts or src/importer.ts, and is
// not part of the app runtime.
//
// TRANSLATION PROVENANCE — read before changing any ID below.
// Both texts must be the RILEY translation (Henry T. Riley, 1851, Bohn's
// Classical Library; translator died 1878). The two Gutenberg transcriptions
// are of the Bell (1893) and McKay (1899) reprints, both long out of
// copyright. Modern translations of the Metamorphoses — Melville, Lombardo,
// Martin, Raeburn and similar — are separately copyrighted and must NEVER be
// substituted in. The script verifies Riley's name in each file's Gutenberg
// header and refuses to build if it is missing. Unlike the Talmud there is no
// licence exception to guard here; this is an unambiguous public-domain
// import, and the guard exists only to stop the wrong edition being swapped
// in by accident.
//
// WHY THIS PARSES HTML, NOT PLAIN TEXT.
// Gutenberg offers both, and the HTML is not merely convenient here — it is
// the only shape that carries the structure this bundle needs. It marks each
// book and fable with a stable anchor (`bookXIV`, `bookXIV_fableIII`), tags
// each of Riley's footnote markers with the note it points at
// (`href="#note8_3"`), classes his per-fable commentary (`p.explanation`) and
// his fable synopses (`p.synopsis`), and — decisively — wraps the two
// reprints' page and line locators in their own spans (`span.pagenum`,
// `span.linenum`) instead of leaving them loose in the sentence. In the
// plain-text edition every one of those is a guess. In particular the inline
// footnote anchors make note-to-fable mapping *exact*: a note belongs to the
// fable whose prose carries its marker, so none of it rests on matching Latin
// line ranges.
//
// THE TWO FILES ARE NOT MARKED UP ALIKE. Books I–VII head each book with
// `<h2>` inside a `div.chapter`; Books VIII–XV use `<h4 class="chapter">` and
// have no chapter div at all. Neither the heading level nor the wrapper is
// therefore a safe signal, and this parser keys on the anchor names, which
// both files share. Riley's own footnotes are `note<book>_<n>`; the
// transcriber's added notes are `note<book>_<LETTER>`, which is what keeps
// the two apart.
//
// Usage:
//   node build.mjs              parse raw/ and build
//   node build.mjs --inspect    report the structure found in raw/ and stop
//   node build.mjs --audit      also print per-fable paragraph/note counts

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const OUTPUT_PATH = path.join(__dirname, 'ovid.json');
const DEPLOY_PATH = path.join(__dirname, '..', '..', 'public', 'library', 'historical', 'ovid.json');

// The two Gutenberg texts, in reading order. Together they are one work —
// they fold into a single source with 15 books, the way Josephus's four texts
// fold into one. `expectedBooks` is the run of book numbers each file is
// supposed to contain, asserted after parsing: a file yielding a different
// run is either the wrong edition or a parser that has drifted.
const VOLUMES = [
  {
    id: 'i-vii',
    gutenbergId: 21765,
    file: '21765-h.htm',
    reprint: 'George Bell & Sons, London, 1893',
    expectedBooks: [1, 2, 3, 4, 5, 6, 7],
  },
  {
    id: 'viii-xv',
    gutenbergId: 26073,
    file: '26073-h.htm',
    reprint: 'David McKay, Philadelphia, 1899',
    expectedBooks: [8, 9, 10, 11, 12, 13, 14, 15],
  },
];

const ROMAN_NUMERALS = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII',
  'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV',
];

// Structural anchors, shared by both files. The closing quote is what keeps
// `book([IVX]+)` from also matching `bookI_fableI`.
const BOOK_ANCHOR_RE = /<a\s+name="book([IVX]+)"/g;
// Fables are split on their PRINTED HEADING, not on the fable anchors, and
// the difference is not cosmetic. Riley sometimes prints two or three fables
// under one heading ("FABLES VI AND VII.", "FABLES IV. V. AND VI."), and the
// two files disagree about how to anchor that: Book II gives such a heading a
// single anchor, Book XIII gives one per fable. Counting anchors therefore
// yields a different set of units in each file, and splitting on them cuts a
// combined heading in half — the first half holding no prose at all. The
// heading is what the printed book actually divides on, so it is what this
// divides on.
const FABLE_HEADING_RE = /<h5>([\s\S]*?)<\/h5>/g;
// Every numeral in such a heading is a fable it covers.
const HEADING_NUMERAL_RE = /\b([IVX]+)\b/g;
// Riley's own notes only: his are numbered, the transcriber's added notes use
// a letter (`note10_A`) and are excluded with the rest of the transcriber's
// apparatus.
const NOTE_BODY_RE = /<a\s+name="note(\d+)_(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
const NOTE_MARKER_RE = /class="tag"[^>]*href="#note(\d+)_(\d+)"/g;
// The Latin line a note keys itself to, after its italic lemma.
const VER_RE = /Ver\.\s*(\d{1,4})/;

// Containers that are not Riley and not Ovid, removed wholesale before
// anything is read out of the page. `mynote` and `endnote` are the Gutenberg
// transcriber's own commentary — including notes *about* Riley's notes, which
// sit inside the footnote blocks rather than in the front matter, so cutting
// front matter alone would not catch them.
const EXCLUDED_BLOCKS = [
  { name: 'transcriber\'s notes (div.mynote)', re: /<div class="mynote[^"]*">[\s\S]*?<\/div>/g },
  { name: 'transcriber\'s notes (p.mynote)', re: /<p class="mynote[^"]*">[\s\S]*?<\/p>/g },
  { name: 'transcriber\'s supplementary notes (div.endnote)', re: /<div class="endnote">[\s\S]*?<\/div>/g },
  { name: 'publisher\'s introduction (div.intro)', re: /<div class="intro">[\s\S]*?<\/div>/g },
  { name: 'table of contents (div.contents)', re: /<div class="contents">[\s\S]*?<\/div>/g },
  { name: 'title page (div.titlepage)', re: /<div class="titlepage">[\s\S]*?<\/div>/g },
  { name: 'publisher\'s advertisement (div.advert)', re: /<div class="advert">[\s\S]*?<\/div>/g },
  { name: 'illustrations (div.fig)', re: /<div class="fig">[\s\S]*?<\/div>/g },
];

// Back matter, by anchor. Everything from the earliest of these to the end of
// the file is the transcriber's apparatus — a note on the texts used, an
// errata list, a line-number index, a name index, a footnote index — and none
// of it is the poem. The "Synoptical View" (a book-by-book plot synopsis,
// anchored `bell_synopsis`) is front matter and falls away with everything
// before the first book anchor.
const BACK_MATTER_ANCHORS = ['texts', 'errors', 'lines', 'names', 'footnotes'];

const ENTITIES = {
  '&mdash;': '—', '&ndash;': '–', '&nbsp;': ' ', '&amp;': '&',
  '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&bull;': '•',
  '&hellip;': '…', '&deg;': '°', '&oelig;': 'œ', '&aelig;': 'æ',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d) => String.fromCodePoint(Number(d)))
    .replace(/&[a-z]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

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

// One HTML fragment to one line of plain reading text.
//
// The page/line locators go first and go entirely: `span.pagenum` and
// `span.linenum` are the two reprints' typesetting furniture, interleaved
// mid-sentence ("...the whole universe, <span class="linenum bell">I. 6-26
// </span> which men..."), and they are neither Ovid's words nor Riley's.
// Unlike JFB's verse ranges there is no parallel worth preserving. The class
// match is deliberately loose (`pagenum bell`, `pagenum mckay`, bare
// `pagenum`) because the two files label the same span differently.
//
// Footnote markers go too: they are `<a class="tag">` wrapping a bare numeral,
// so removing the element removes the digit with it — none of the guesswork
// the plain-text edition would have forced, where a marker is fused onto the
// preceding word and indistinguishable from a numeral belonging to the text.
//
// Everything else is unwrapped rather than dropped. Riley's <i> marks words
// he supplied that the Latin only implies; entries.text is plain text
// everywhere in this app and no pane renders markup, so the emphasis is lost
// but the words are kept — the same call the Talmud import made with Sefaria's
// <b> and Foxe with Gutenberg's _underscores_. Greek is kept as its own
// characters; the transliteration Gutenberg hides in a title attribute goes
// with the tag.
function htmlToText(fragment) {
  let text = fragment
    .replace(/<span class="(?:pagenum|linenum)[^"]*">[\s\S]*?<\/span>/g, ' ')
    .replace(/<a\s[^>]*class="tag"[^>]*>[\s\S]*?<\/a>/g, '')
    .replace(/<a\s+class="tag"[^>]*>[\s\S]*?<\/a>/g, '')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<[^>]+>/g, '');
  return normalizeWhitespace(decodeEntities(text));
}

// Pulls the <p> elements out of a fragment, with their class, in order.
function paragraphsIn(fragment) {
  const out = [];
  const re = /<p([^>]*)>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(fragment)) !== null) {
    const cls = (m[1].match(/class="([^"]*)"/) ?? [, ''])[1];
    const text = htmlToText(m[2]);
    if (text) out.push({ cls, text });
  }
  return out;
}

// Every match of `re` with its index, so a file can be cut into regions.
function anchorPositions(html, re) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(html)) !== null) out.push({ index: m.index, groups: m.slice(1) });
  return out;
}

// Hard gate on translation provenance — see the header note.
function assertRiley(volume, raw) {
  const header = normalizeWhitespace(decodeEntities(raw.slice(0, 8000).replace(/<[^>]+>/g, ' ')));
  if (!/Henry\s+T(?:homas)?\.?\s+Riley/i.test(header)) {
    throw new Error(
      `${volume.file} does not name Henry T. Riley as translator in its header. Refusing to ` +
      'build: modern translations of the Metamorphoses are separately copyrighted and must ' +
      'never be substituted for Riley\'s.',
    );
  }
}

// Strips Gutenberg's boilerplate, the transcriber's apparatus and the front
// and back matter, leaving the poem. What was removed is logged rather than
// silently dropped — this project's standing audit-trail rule.
function isolateBody(volume, raw, log) {
  let html = raw.replace(/\r\n/g, '\n');

  const start = html.match(/\*\*\*\s*START OF TH[EI][^\n]*\*\*\*/i);
  if (start) html = html.slice(html.indexOf(start[0]) + start[0].length);
  const end = html.match(/\*\*\*\s*END OF TH[EI][^\n]*\*\*\*/i);
  if (end) html = html.slice(0, html.indexOf(end[0]));

  for (const block of EXCLUDED_BLOCKS) {
    const hits = html.match(block.re);
    if (hits) {
      log.push(`${volume.file}: excluded ${hits.length} × ${block.name}.`);
      html = html.replace(block.re, ' ');
    }
  }

  // Back matter: cut from the earliest of its anchors to the end.
  let cut = html.length;
  let cutName = null;
  for (const anchor of BACK_MATTER_ANCHORS) {
    const i = html.search(new RegExp(`<a\\s+name="${anchor}"`));
    if (i !== -1 && i < cut) { cut = i; cutName = anchor; }
  }
  if (cutName) {
    log.push(`${volume.file}: excluded back matter from the "${cutName}" anchor to the end of the file.`);
    html = html.slice(0, cut);
  }

  // Front matter: everything before the first book anchor — the title page,
  // the publisher's introduction and the Synoptical View.
  const books = anchorPositions(html, BOOK_ANCHOR_RE);
  if (books.length === 0) {
    throw new Error(`${volume.file}: no book anchor found — the file's markup is not what this parser expects.`);
  }
  if (books[0].index > 0) {
    log.push(
      `${volume.file}: excluded ${books[0].index} bytes of front matter (title page, publisher's ` +
      'introduction, Synoptical View) before the first book anchor.',
    );
  }
  return html;
}

// Parses one volume into books → fables, each fable carrying its own prose,
// Riley's explanation of it, and the notes its markers point at.
function parseVolume(volume, raw, log, anomalies) {
  assertRiley(volume, raw);
  const html = isolateBody(volume, raw, log);

  const bookAnchors = anchorPositions(html, BOOK_ANCHOR_RE);
  const books = [];

  bookAnchors.forEach((anchor, i) => {
    const region = html.slice(anchor.index, bookAnchors[i + 1]?.index ?? html.length);
    // Book numbers come from POSITION, never from the printed numeral — the
    // lesson Fox's Book of Martyrs taught on first contact with its real
    // text: a duplicate numeral taken at face value merges two units, and
    // the book number is half of every citation below it.
    const number = volume.expectedBooks[i];
    if (number === undefined) {
      throw new Error(
        `${volume.file}: found more book anchors than the ${volume.expectedBooks.length} this ` +
        'volume should contain.',
      );
    }
    const printed = romanToInt(anchor.groups[0]);
    if (printed !== number) {
      anomalies.push(
        `${volume.file}: book at position ${i + 1} of this volume is anchored "book${anchor.groups[0]}" ` +
        `(numeral ${printed}) but sits where Book ${number} belongs. Numbered from position.`,
      );
    }
    books.push(parseBook(volume, region, number, anomalies));
  });

  return books;
}

function parseBook(volume, region, number, anomalies) {
  const roman = ROMAN_NUMERALS[number];

  // The book's footnote block sits at its end. Split it off first so its
  // prose isn't read as the last fable's.
  const footnoteStart = region.search(/<div class="footnote">/);
  const body = footnoteStart === -1 ? region : region.slice(0, footnoteStart);
  const notesById = footnoteStart === -1
    ? new Map()
    : parseNotes(region.slice(footnoteStart));

  // Fable headings, in document order. An <h5> that doesn't say FABLE is
  // something else — Book I's "THE ARGUMENT" is one — and is not a split
  // point.
  const headings = [];
  FABLE_HEADING_RE.lastIndex = 0;
  let m;
  while ((m = FABLE_HEADING_RE.exec(body)) !== null) {
    const label = normalizeWhitespace(decodeEntities(m[1].replace(/<[^>]+>/g, ' ')));
    if (!/\bFABLES?\b/i.test(label)) continue;
    const numerals = [];
    HEADING_NUMERAL_RE.lastIndex = 0;
    let n;
    while ((n = HEADING_NUMERAL_RE.exec(label)) !== null) numerals.push(romanToInt(n[1]));
    headings.push({ index: m.index, label, numerals });
  }

  const book = { number, roman, fables: [], preamble: null, noteCount: notesById.size };

  // Book I opens on THE ARGUMENT — Ovid's proem, before Fable I. It is his
  // own words, not apparatus, so it is kept, with its own citation and TOC
  // row, rather than being folded into Fable I or dropped. Fable numbering is
  // untouched by it: Fable I is still I.1.
  if (headings.length > 0 && headings[0].index > 0) {
    const head = body.slice(0, headings[0].index);
    const paragraphs = paragraphsIn(head).map((p) => p.text);
    if (paragraphs.length > 0) {
      const label = (head.match(/<h5>([\s\S]*?)<\/h5>/) ?? [, ''])[1];
      const title = normalizeWhitespace(decodeEntities(label.replace(/<[^>]+>/g, ' '))).replace(/\.$/, '');
      book.preamble = {
        title: toTitleCase(title) || 'The Argument',
        paragraphs,
        noteIds: markerIdsIn(head),
        notes: [],
      };
    }
  }

  headings.forEach((heading, i) => {
    const fragment = body.slice(heading.index, headings[i + 1]?.index ?? body.length);

    const paragraphs = [];
    const explanation = [];
    for (const p of paragraphsIn(fragment)) {
      // p.explanation is Riley's commentary on the fable; p.synopsis is his
      // one-paragraph argument for it, printed under the fable's heading and
      // read as its opening. Everything else is the translated narrative.
      if (/\bexplanation\b/.test(p.cls)) explanation.push(p.text);
      else paragraphs.push(p.text);
    }

    if (heading.numerals.length === 0) {
      anomalies.push(
        `${volume.file}: heading "${heading.label}" in Book ${roman} carries no fable numeral; ` +
        'numbered from position.',
      );
    }
    const numerals = heading.numerals.length > 0 ? heading.numerals : [i + 1];

    book.fables.push({
      // The unit's ordinal within the book. This is what becomes
      // entries.chapter — a LOADING unit, never a citation — so it is taken
      // from position and is dense and unique by construction, which is what
      // keeps two units from merging (the fault Fox's Book of Martyrs
      // exposed). The printed numerals below carry the citation.
      ordinal: i + 1,
      // The fable number(s) Riley printed over this unit: [8], or [6, 7] for
      // "FABLES VI AND VII.", or [4, 5, 6] for "FABLES IV. V. AND VI."
      numerals,
      label: formatFableLabel(numerals),
      citation: formatFableCitation(roman, numerals),
      paragraphs,
      explanation,
      noteIds: markerIdsIn(fragment),
      notes: [],
    });
  });

  // Riley's own numbering should run 1..n across a book with no gap and no
  // repeat once the combined headings are expanded. A gap means a heading was
  // missed, or the source itself is irregular — either way it is recorded
  // rather than smoothed over.
  const printed = book.fables.flatMap((f) => f.numerals);
  for (let i = 0; i < printed.length; i++) {
    if (printed[i] !== i + 1) {
      anomalies.push(
        `${volume.file}: Book ${roman}'s printed fable numbering reads ` +
        `[${printed.join(', ')}] — expected a dense run from 1. The reading order and the ` +
        'loading units are unaffected; only the printed citations are.',
      );
      break;
    }
  }

  // Notes are filed by the marker that points at them, so the mapping is
  // exact rather than inferred from Latin line ranges — the whole reason this
  // parses HTML. A note nothing points at is reported by validate().
  const claimed = new Set();
  const attach = (unit) => {
    for (const id of unit.noteIds) {
      const note = notesById.get(id);
      if (note && !claimed.has(id)) { unit.notes.push(note); claimed.add(id); }
    }
  };
  if (book.preamble) attach(book.preamble);
  for (const fable of book.fables) attach(fable);

  book.unclaimedNotes = [...notesById.entries()]
    .filter(([id]) => !claimed.has(id))
    .map(([, note]) => note);

  return book;
}

// "FABLES VI AND VII." reads as a heading; as a TOC row and a citation it
// wants to be uniform with its neighbours.
function formatFableLabel(numerals) {
  const romans = numerals.map(intToRoman);
  if (romans.length === 1) return `Fable ${romans[0]}`;
  return `Fables ${romans.slice(0, -1).join(', ')} and ${romans[romans.length - 1]}`;
}

// The citation Riley's own numbering gives this unit: "II.8" for a single
// fable, "II.6-7" for a combined heading.
function formatFableCitation(bookRoman, numerals) {
  if (numerals.length === 1) return `${bookRoman}.${numerals[0]}`;
  return `${bookRoman}.${numerals[0]}-${numerals[numerals.length - 1]}`;
}

// Headings are printed in capitals ("THE ARGUMENT"); the TOC reads better in
// the app's own sentence case, and nothing downstream depends on the shouting.
function toTitleCase(text) {
  return text.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

// Every Riley note marker in a fragment, in order of appearance.
function markerIdsIn(fragment) {
  const out = [];
  NOTE_MARKER_RE.lastIndex = 0;
  let m;
  while ((m = NOTE_MARKER_RE.exec(fragment)) !== null) out.push(`${m[1]}_${m[2]}`);
  return out;
}

// Parses a book's footnote block into id → note. Each note opens with an
// anchor carrying its printed number, then an italic lemma, then "Ver. N" —
// the Latin line it hangs on — then the note itself.
function parseNotes(fragment) {
  const anchors = anchorPositions(fragment, NOTE_BODY_RE);
  const notes = new Map();
  anchors.forEach((anchor, i) => {
    const slice = fragment.slice(anchor.index, anchors[i + 1]?.index ?? fragment.length);
    // The anchor's own text is the note's printed number ("4."); drop it so
    // it isn't repeated when the note is rendered.
    const text = htmlToText(slice.replace(NOTE_BODY_RE, ' '));
    if (!text) return;
    const id = `${anchor.groups[0]}_${anchor.groups[1]}`;
    const ver = text.match(VER_RE);
    notes.set(id, { number: Number(anchor.groups[1]), ver: ver ? Number(ver[1]) : null, text });
  });
  return notes;
}

// Reports what the parser can see, without building anything, so the
// structure can be checked before a bundle is trusted.
async function inspect(volume) {
  const raw = await fs.readFile(path.join(RAW_DIR, volume.file), 'utf8');
  const log = [];
  const anomalies = [];
  console.log(`\n=== ${volume.file} ===`);
  const books = parseVolume(volume, raw, log, anomalies);
  for (const line of log) console.log(`  ${line}`);
  for (const book of books) {
    const paras = book.fables.reduce((n, f) => n + f.paragraphs.length, 0);
    const expl = book.fables.reduce((n, f) => n + f.explanation.length, 0);
    // The preamble's notes count too — leaving them out here once made a
    // clean mapping look like three lost notes.
    const notes = book.fables.reduce((n, f) => n + f.notes.length, 0)
      + (book.preamble ? book.preamble.notes.length : 0);
    const printed = book.fables.flatMap((f) => f.numerals);
    console.log(
      `  Book ${book.roman}: ${book.fables.length} units / ${printed.length} fables, ` +
      `${paras} paragraphs, ` +
      `${expl} explanation paragraphs, ${notes}/${book.noteCount} notes mapped` +
      (book.preamble ? `, preamble "${book.preamble.title}"` : '') +
      (book.unclaimedNotes.length ? `, ${book.unclaimedNotes.length} UNCLAIMED` : ''),
    );
    for (const f of book.fables.filter((x) => x.numerals.length > 1)) {
      console.log(`    combined heading: ${f.label} → ${f.citation}`);
    }
  }
  for (const line of anomalies) console.log(`  ANOMALY: ${line}`);
}

// Refuses to ship a half-read work.
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
        problems.push(`Book ${book.roman} ${fable.label} (${fable.citation}) has no prose`);
      }
    }
    // Every note Riley printed should be claimed by a marker in the text. An
    // unclaimed one means a marker was missed, which means prose was missed.
    if (book.unclaimedNotes.length > 0) {
      problems.push(
        `Book ${book.roman} has ${book.unclaimedNotes.length} footnotes that no marker in the ` +
        'text points at',
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`Parse validation failed:\n  - ${problems.join('\n  - ')}`);
  }
}

async function main() {
  const inspectOnly = process.argv.includes('--inspect');
  const audit = process.argv.includes('--audit');

  if (inspectOnly) {
    for (const volume of VOLUMES) await inspect(volume);
    console.log('\n--inspect only: nothing written.');
    return;
  }

  const log = [];
  const anomalies = [];
  const books = [];

  for (const volume of VOLUMES) {
    process.stdout.write(`Books ${volume.id.toUpperCase()} (${volume.file})… `);
    const raw = await fs.readFile(path.join(RAW_DIR, volume.file), 'utf8');
    const parsed = parseVolume(volume, raw, log, anomalies);
    const got = parsed.map((b) => b.number);
    if (got.join(',') !== volume.expectedBooks.join(',')) {
      throw new Error(
        `${volume.file} yielded books [${got}], expected [${volume.expectedBooks}]. Either the ` +
        'wrong file was supplied or the parser has drifted; refusing to build.',
      );
    }
    books.push(...parsed);
    console.log(`${parsed.length} books, ${parsed.reduce((n, b) => n + b.fables.length, 0)} units`);
  }

  validate(books);

  const totalUnits = books.reduce((n, b) => n + b.fables.length, 0);
  const totalFables = books.reduce(
    (n, b) => n + b.fables.reduce((m, f) => m + f.numerals.length, 0), 0,
  );
  const totalParagraphs = books.reduce(
    (n, b) => n + b.fables.reduce((m, f) => m + f.paragraphs.length, 0)
      + (b.preamble ? b.preamble.paragraphs.length : 0), 0,
  );
  const totalExplanation = books.reduce(
    (n, b) => n + b.fables.reduce((m, f) => m + f.explanation.length, 0), 0,
  );
  const totalNotes = books.reduce(
    (n, b) => n + b.fables.reduce((m, f) => m + f.notes.length, 0)
      + (b.preamble ? b.preamble.notes.length : 0), 0,
  );

  if (audit) {
    for (const book of books) {
      if (book.preamble) {
        console.log(`  ${book.roman}.0  "${book.preamble.title}"  ${book.preamble.paragraphs.length}¶  ${book.preamble.notes.length} notes`);
      }
      for (const f of book.fables) {
        console.log(
          `  ${f.citation}  (unit ${f.ordinal})  ${f.paragraphs.length}¶  ` +
          `${f.explanation.length} expl  ${f.notes.length} notes`,
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
        'Riley\'s per-fable "Explanation" sections and his numbered footnotes are included, each at ' +
        'the foot of the fable it belongs to. The reprints\' page and line locator numbers, which the ' +
        'transcription interleaves mid-sentence, are stripped as typesetting artifacts; both ' +
        'publishers\' introductions, the Synoptical View and the Gutenberg transcriber\'s own notes ' +
        'and indexes are excluded as apparatus.',
      total_books: books.length,
      total_units: totalUnits,
      total_fables: totalFables,
      total_paragraphs: totalParagraphs,
      total_explanation_paragraphs: totalExplanation,
      total_footnotes: totalNotes,
      exclusions: log,
      source_anomalies: anomalies,
    },
    books: books.map((b) => ({
      number: b.number,
      roman: b.roman,
      name: `Book ${b.roman}`,
      preamble: b.preamble
        ? {
          title: b.preamble.title,
          paragraphs: b.preamble.paragraphs,
          notes: b.preamble.notes.map((n) => ({ number: n.number, ver: n.ver, text: n.text })),
        }
        : null,
      fables: b.fables.map((f) => ({
        // ordinal = loading unit (entries.chapter); numerals/citation = what
        // Riley printed, and what the reader is shown.
        ordinal: f.ordinal,
        numerals: f.numerals,
        label: f.label,
        citation: f.citation,
        paragraphs: f.paragraphs,
        explanation: f.explanation,
        notes: f.notes.map((n) => ({ number: n.number, ver: n.ver, text: n.text })),
      })),
    })),
  };

  const json = JSON.stringify(bundle, null, 1);
  await fs.writeFile(OUTPUT_PATH, json, 'utf8');
  await fs.mkdir(path.dirname(DEPLOY_PATH), { recursive: true });
  await fs.writeFile(DEPLOY_PATH, json, 'utf8');
  console.log(
    `\n${totalFables} fables, ${totalParagraphs} paragraphs, ${totalExplanation} explanation ` +
    `paragraphs, ${totalNotes} footnotes across ${books.length} books`,
  );
  for (const line of log) console.log(`  note: ${line}`);
  for (const line of anomalies) console.log(`  ANOMALY: ${line}`);
  console.log(`wrote ${OUTPUT_PATH}`);
  console.log(`wrote ${DEPLOY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
