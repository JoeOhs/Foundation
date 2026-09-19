// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads Thomas Aquinas's Summa Contra Gentiles in Joseph Rickaby's
// 1905 translation, "Of God and His Creatures", from CCEL as ThML and writes
// gentiles.json — a bundle shaped for Foundation's freeform compound import
// (one source, one `books` row per Book, one entry per paragraph, under a
// Book → Chapter table of contents).
//
// EDITION — pinned, and why. Two public-domain English translations exist:
//   - Joseph Rickaby, S.J., "Of God and His Creatures" (Burns & Oates /
//     B. Herder, 1905). Rickaby died in 1932. Published 1905 → public domain
//     in the US; life+70 → public domain in the UK since 2003.
//   - The English Dominican Fathers' complete translation (Burns Oates &
//     Washbourne, 1923–29). Also US public domain (published before 1931),
//     but only as archive.org page scans with uncorrected OCR — the same
//     problem that ruled out the archive.org scan of Smith's Dictionary.
// Rickaby is taken because CCEL carries it as clean, structured ThML. It is
// ABRIDGED — Rickaby says so on his title page and omits or summarises
// chapters he judged obsolete (Aristotelian physics and astronomy) — which is
// stated in the licence note and the Library entry rather than hidden. His
// printed chapter numbers are kept as printed (merged ones as "32, 35"),
// bar the transcription typos NUMBER_FIXES corrects.
//
// LICENCE GUARD. CCEL's <DC.Rights> for this file is EMPTY, so the Calvin
// builds' "DC.Rights says Public Domain" gate cannot apply. The gate here is
// the edition itself: the build refuses to run unless the head names the
// 1905 Burns & Oates printing and the title page names Rickaby as translator,
// so a CCEL swap to some later (possibly copyrighted) translation fails
// loudly. Per-block, as with Calvin: the only non-1905 prose in the file is
// CCEL's own staff description in <ThML.head> (never read) and CCEL's
// generated indexes (excluded); the tripwire re-scans the bundle for the
// staff writer's name.
//
// FOOTNOTES ARE KEPT. Rickaby's ~1,000 notes are the "annotated" in his
// title — where he says what he left untranslated and why — so unlike
// Beveridge's they are not stripped. Each is lifted out of the paragraph
// (ThML nests a note's own <p>s inside the prose <p>), a "[n]" marker is left
// where it stood, and the note is emitted after its chapter as apparatus,
// "n. text". Numbers are Rickaby's own and unique across the file.

import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(HERE, 'raw');
const OUTPUT_PATH = join(HERE, 'gentiles.json');
const DEPLOY_PATH = join(HERE, '..', '..', 'public', 'library', 'apologetics', 'gentiles.json');
const EXCLUSIONS_PATH = join(HERE, 'exclusions.txt');
const XML_URL = 'https://ccel.org/ccel/aquinas/gentiles.xml';
const USER_AGENT = 'Foundation-data-prep/1.0 (personal offline Bible study app)';
const REFETCH = process.argv.includes('--refetch');

// CCEL's staff description of the work lives in the head; its author's name
// must never reach the bundle.
const CCEL_STAFF_NEEDLE = 'O’Bannon';

const BOOKS = new Map([
  ['Book I.', { name: 'Book I — Of God as He Is in Himself', citation: 'I' }],
  ['Book II.', { name: 'Book II — God the Origin of Creatures', citation: 'II' }],
  ['Book III.', { name: 'Book III — God the End of Creatures', citation: 'III' }],
  ['Book IV.', { name: 'Book IV — Of God in His Revelation', citation: 'IV' }],
]);
// Rickaby's own 1905 prose outside the Books.
const TRANSLATOR_PIECES = new Map([
  ['Preface', 'Translator’s Preface'],
  ['Afterword', 'Translator’s Afterword'],
]);

// Chapter numbers CCEL's transcription gets wrong, found by the order check
// in build(). Keyed by Book and the chapter's title, so each fix names
// exactly one chapter and fails loudly (below) if that chapter moves.
const NUMBER_FIXES = [
  // Printed "LVIII" between LXVII and LVIX.
  { book: 'Book III.', title: 'That God is everywhere and in all things', from: 58, to: 68 },
  // Printed "LVIX" — not a numeral; LXIX, between LXVIII and LXXI.
  { book: 'Book III.', title: 'Of the Opinion of those who withdraw from Natural Things', from: 64, to: 69 },
  // Printed "CXLIV" straight after CXLVIII; CXLIX.
  { book: 'Book III.', title: 'That the Divine Assistance does not compel a Man to Virtue', from: 144, to: 149 },
  // Printed "CXVI" between XCV and XCVII, in a Book of 97 chapters; XCVI.
  { book: 'Book IV.', title: 'Of the Last Judgement', from: 116, to: 96 },
];

const OSIS_BOOK_IDS = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
  '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov',
  'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
  'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts', 'Rom', '1Cor', '2Cor', 'Gal', 'Eph',
  'Phil', 'Col', '1Thess', '2Thess', '1Tim', '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas',
  '1Pet', '2Pet', '1John', '2John', '3John', 'Jude', 'Rev',
];
const CANONICAL_BOOKS = [
  'Genesis', 'Exodus', 'Leviticus', 'Numbers', 'Deuteronomy', 'Joshua', 'Judges', 'Ruth', '1 Samuel', '2 Samuel',
  '1 Kings', '2 Kings', '1 Chronicles', '2 Chronicles', 'Ezra', 'Nehemiah', 'Esther', 'Job', 'Psalms', 'Proverbs',
  'Ecclesiastes', 'Song of Solomon', 'Isaiah', 'Jeremiah', 'Lamentations', 'Ezekiel', 'Daniel', 'Hosea', 'Joel', 'Amos',
  'Obadiah', 'Jonah', 'Micah', 'Nahum', 'Habakkuk', 'Zephaniah', 'Haggai', 'Zechariah', 'Malachi',
  'Matthew', 'Mark', 'Luke', 'John', 'Acts', 'Romans', '1 Corinthians', '2 Corinthians', 'Galatians', 'Ephesians',
  'Philippians', 'Colossians', '1 Thessalonians', '2 Thessalonians', '1 Timothy', '2 Timothy', 'Titus', 'Philemon', 'Hebrews', 'James',
  '1 Peter', '2 Peter', '1 John', '2 John', '3 John', 'Jude', 'Revelation',
];
const OSIS_TO_CANONICAL = new Map(OSIS_BOOK_IDS.map((id, i) => [id, CANONICAL_BOOKS[i]]));

// Sentinels for a <scripRef> until liftRefs — same scheme as
// calvin-institutes/build.mjs.
const REF_OPEN = '';
const REF_MID = '';
const REF_CLOSE = '';
const REF_MARKUP = /[^]*|/g;

const exclusions = [];
function logExclusion(kind, label, text) {
  const flat = String(text).replace(REF_MARKUP, '').replace(/\s+/g, ' ').trim();
  exclusions.push(`${kind}\t${label}\t${flat.length} bytes\t${flat.slice(0, 160)}`);
}

async function loadXml() {
  const cached = join(RAW_DIR, 'gentiles.xml');
  if (!REFETCH && existsSync(cached)) {
    console.log('  reusing raw/gentiles.xml');
    return readFile(cached, 'utf8');
  }
  console.log(`  downloading ${XML_URL}`);
  const res = await fetch(XML_URL, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' } });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${XML_URL}`);
  const text = await res.text();
  if (text.length < 1_000_000) throw new Error(`gentiles.xml is only ${text.length} bytes — truncated?`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(cached, text, 'utf8');
  return text;
}

// The edition gate — see the header note.
function assertRickaby1905(xml) {
  const headEnd = xml.indexOf('</ThML.head>');
  if (headEnd === -1) throw new Error('No ThML head — refusing to build.');
  const head = xml.slice(0, headEnd);
  const bookId = /<bookID>([^<]*)<\/bookID>/i.exec(head)?.[1]?.trim();
  if (bookId !== 'gentiles') throw new Error(`bookID="${bookId ?? 'none'}" — not the work expected.`);
  if (!/<DC\.Title>\s*Of God and His Creatures\s*<\/DC\.Title>/i.test(head)) {
    throw new Error('DC.Title is not "Of God and His Creatures" — not the Rickaby edition; refusing to build.');
  }
  if (!/<pubHistory>[^<]*Burne?s &amp; Oates[^<]*1905[^<]*<\/pubHistory>/i.test(head)) {
    throw new Error('pubHistory does not name the 1905 Burns & Oates printing — refusing to build.');
  }
  const titlePage = xml.slice(headEnd, xml.indexOf('<div1', xml.indexOf('<div1') + 1));
  if (!/JOSEPH\s+RICKABY/i.test(titlePage) || !/1905|BURNS\s*&amp;\s*OATES/i.test(titlePage)) {
    throw new Error('Title page does not name Joseph Rickaby / Burns & Oates — refusing to build.');
  }
  console.log('  edition check passed: Rickaby, Burns & Oates 1905');
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, '&');
}

function attr(tag, name) {
  const m = new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

function inlineToText(html) {
  return decodeEntities(
    html
      .replace(
        /<scripRef\b([^>]*)>([\s\S]*?)<\/scripRef>/gi,
        (_, attrs, inner) => `${REF_OPEN}${attr(attrs, 'osisRef') ?? ''}${REF_MID}${inner}${REF_CLOSE}`,
      )
      .replace(/<pb\b[^>]*\/?>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?(span|i|b|em|strong|sup|sub|u|a|font|small|l|lg)\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t\r\n]+/g, ' ').trim();
}

function paragraphs(chunk) {
  return [...chunk.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)]
    .map((m) => ({ cls: attr(m[1], 'class') ?? '', text: inlineToText(m[2]) }))
    .filter((p) => p.text);
}

// Pulls every <note> out of a chunk, leaving "[n]" where it stood, and
// returns the notes as formatted paragraphs ("n. text", continuation
// paragraphs unprefixed).
function liftNotes(chunk, label) {
  const notes = [];
  const body = chunk.replace(/<note\b([^>]*)>([\s\S]*?)<\/note>/gi, (_, attrs, inner) => {
    const n = attr(attrs, 'n');
    if (!n) {
      logExclusion('unnumbered note (kept, unmarked)', label, inner.replace(/<[^>]*>/g, ' '));
    }
    const ps = /<p\b/i.test(inner) ? paragraphs(inner).map((p) => p.text) : [inlineToText(inner)];
    ps.filter(Boolean).forEach((t, i) => notes.push(i === 0 && n ? `${n}. ${t}` : t));
    return n ? `[${n}]` : ' ';
  });
  return { body, notes };
}

function divisions(xml) {
  const d1 = [...xml.matchAll(/<div1\b[^>]*>/gi)];
  return d1.map((m, i) => {
    const body = xml.slice(m.index, d1[i + 1]?.index ?? xml.length);
    const d2 = [...body.matchAll(/<div2\b[^>]*>/gi)];
    return {
      title: (attr(m[0], 'title') ?? '').trim(),
      body,
      children: d2.map((c, j) => ({
        title: (attr(c[0], 'title') ?? '').trim(),
        body: body.slice(c.index, d2[j + 1]?.index ?? body.length),
      })),
    };
  });
}

const ROMAN = { I: 1, V: 5, X: 10, L: 50, C: 100 };
function romanToInt(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]];
    n += v < (ROMAN[s[i + 1]] ?? 0) ? -v : v;
  }
  return n;
}

// "CHAPTERS XLI–XLV—Title" → { numbers: '41–45', first: 41, title }.
// Rickaby merges chapters ("XXXII, XXXV", "XLI–XLV") and once prints an
// arabic "12", so the numeral run is tokenised rather than matched as one
// roman numeral. A dash counts as a range only when a numeral follows it;
// otherwise it is the separator before the title.
function parseHeading(text) {
  let rest = text.replace(/^CHAPTERS?\s+/i, '');
  if (rest === text) return null;
  const nums = [];
  const seps = [];
  for (;;) {
    const m = /^([IVXLC]+|\d+)\b\.?/.exec(rest);
    if (!m) break;
    nums.push(/\d/.test(m[1]) ? Number(m[1]) : romanToInt(m[1]));
    rest = rest.slice(m[0].length);
    const sep = /^\s*([,–-])\s*(?=[IVXLC]+\b|\d)/.exec(rest);
    if (!sep) break;
    seps.push(sep[1] === ',' ? ', ' : '–');
    rest = rest.slice(sep[0].length);
  }
  if (nums.length === 0) return null;
  const title = rest.replace(/^\s*[—–.-]*\s*/, '').trim();
  return { numbers: nums.map((n, i) => (i ? seps[i - 1] : '') + n).join(''), first: nums[0], last: Math.max(...nums), title };
}

// One chapter: its printed number(s) and name from the `chaptertitle` line,
// which is kept even where CCEL's div2 title attribute lost it ("Chapter "),
// falling back to the div2 title for the few chapters printed without one.
function parseChapter(chunk, label, divTitle) {
  const { body, notes } = liftNotes(chunk, label);
  const ps = paragraphs(body);
  const head = ps.findIndex((p) => p.cls === 'chaptertitle');
  const heading = (head !== -1 && parseHeading(ps[head].text.replace(REF_MARKUP, ''))) || parseHeading(divTitle);
  if (!heading) throw new Error(`No "CHAPTER <n>—title" heading in ${label} — the chapter shape changed.`);
  if (head === -1) logExclusion('no chaptertitle line (heading from CCEL div title)', label, divTitle);
  const prose = ps.filter((_, i) => i !== head).map((p) => p.text);
  return { number: heading.first, last: heading.last, numbers: heading.numbers, title: heading.title, paragraphs: prose, notes };
}

function build(xml) {
  assertRickaby1905(xml);
  const books = [];
  for (const d1 of divisions(xml)) {
    const key = [...BOOKS.keys()].find((k) => d1.title.startsWith(k));
    if (key) {
      // Book IV's heading ("BOOK IV / OF GOD IN HIS REVELATION") is its own
      // div2; the Book row already carries it.
      const chapters = d1.children
        .filter((c) => c.title !== 'Book Title' || (logExclusion('book heading (kept as the Book name)', key, c.title), false))
        .map((c) => parseChapter(c.body, `${key} ${c.title}`, c.title));
      for (const fix of NUMBER_FIXES.filter((f) => f.book === key)) {
        const c = chapters.find((ch) => ch.title.startsWith(fix.title) && ch.number === fix.from);
        if (!c) throw new Error(`Number fix for ${key} "${fix.title}" no longer matches — re-check the source.`);
        c.number = fix.to;
        c.last = fix.to;
        c.numbers = String(fix.to);
        logExclusion('chapter number corrected', `${key} ${fix.title}`, `printed ${fix.from}, is ${fix.to}`);
      }
      // Out-of-order numbers are logged, not fatal: Rickaby does reorder (IV
      // puts LIV–LV before L–LII) and merges ("CIX", then "CVIII, CX"). The
      // log is what surfaced the typos NUMBER_FIXES corrects.
      chapters.forEach((c, i) => {
        if (i > 0 && c.last <= chapters[i - 1].number) {
          logExclusion('chapter out of printed order (kept as printed)', key, `${c.numbers} after ${chapters[i - 1].numbers}`);
        }
      });
      books.push({ ...BOOKS.get(key), chapters });
      continue;
    }
    const piece = TRANSLATOR_PIECES.get(d1.title);
    if (piece) {
      const { body, notes } = liftNotes(d1.body, d1.title);
      const prose = paragraphs(body).map((p) => p.text);
      books.push({ name: piece, citation: null, chapters: [{ number: 1, numbers: null, title: piece, paragraphs: prose, notes }] });
      continue;
    }
    logExclusion(d1.title === 'Indexes' ? 'CCEL reference apparatus' : 'title page / dedication', d1.title, d1.title);
  }
  if (books.filter((b) => b.citation).length !== 4) throw new Error('Expected four Books — the file changed shape.');
  return books;
}

function resolveOsis(osisRef) {
  const first = osisRef.split(/\s+/)[0].replace(/^Bible:/, '').split('-')[0];
  const [osisBook, ch, v] = first.split('.');
  const book = OSIS_TO_CANONICAL.get(osisBook);
  const chapter = Number(ch);
  if (!book || !Number.isInteger(chapter) || chapter < 1) return null;
  const verse = v === undefined ? null : Number(v);
  if (verse !== null && (!Number.isInteger(verse) || verse < 1)) return null;
  return { book, chapter, verse };
}

const refStats = { linked: 0, unlinked: 0 };

// Identical to calvin-institutes/build.mjs's liftRefs.
function liftRefs(marked, label) {
  let text = '';
  const refs = [];
  let open = null;
  for (let i = 0; i < marked.length; i++) {
    const c = marked[i];
    if (c === REF_OPEN) {
      const mid = marked.indexOf(REF_MID, i);
      open = { osis: marked.slice(i + 1, mid), start: text.length };
      i = mid;
    } else if (c === REF_CLOSE) {
      const visible = text.slice(open.start);
      const start = open.start + (visible.length - visible.trimStart().length);
      const end = text.trimEnd().length;
      const target = open.osis ? resolveOsis(open.osis) : null;
      if (target && start < end) {
        refs.push([start, end, target.book, target.chapter, target.verse]);
        refStats.linked += 1;
      } else {
        logExclusion('scripture reference not linked', label, `${open.osis || '(no osisRef)'}: ${visible}`);
        refStats.unlinked += 1;
      }
      open = null;
    } else if (/\s/.test(c)) {
      if (text.length > 0 && !text.endsWith(' ')) text += ' ';
    } else {
      text += c;
    }
  }
  text = text.trimEnd();
  for (const r of refs) r[1] = Math.min(r[1], text.length);
  return { text, refs };
}

function liftAllRefs(books) {
  const lift = (lines, label) => {
    const out = [];
    lines.forEach((line, i) => {
      const { text, refs } = liftRefs(line, label);
      lines[i] = text;
      for (const r of refs) out.push([i, ...r]);
    });
    return out;
  };
  for (const b of books) {
    for (const ch of b.chapters) {
      const label = `${b.name} / ${ch.number}`;
      const refs = lift(ch.paragraphs, label);
      if (refs.length > 0) ch.refs = refs;
      const noteRefs = lift(ch.notes, label);
      if (noteRefs.length > 0) ch.note_refs = noteRefs;
    }
  }
}

function assertNoCcelProse(books) {
  const json = JSON.stringify(books);
  if (json.includes(CCEL_STAFF_NEEDLE) || /CCEL Staff/i.test(json)) {
    throw new Error('CCEL staff prose found in the bundle — refusing to build.');
  }
  console.log('  tripwire passed: no CCEL staff prose in the bundle');
}

async function main() {
  const xml = await loadXml();
  const books = build(xml);
  liftAllRefs(books);
  assertNoCcelProse(books);

  const chapterCount = books.reduce((n, b) => n + b.chapters.length, 0);
  const paragraphCount = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.paragraphs.length, 0), 0);
  const noteCount = books.reduce((n, b) => n + b.chapters.reduce((m, c) => m + c.notes.length, 0), 0);
  if (chapterCount < 380 || paragraphCount < 1700) {
    throw new Error(`Only ${chapterCount} chapters / ${paragraphCount} paragraphs — the parse lost text.`);
  }

  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'Thomas Aquinas — Summa Contra Gentiles (Of God and His Creatures, tr. Rickaby, 1905)',
      author: 'Thomas Aquinas',
      translator: 'Joseph Rickaby, S.J.',
      source_site: 'https://ccel.org/ccel/aquinas/gentiles',
      license: 'public domain',
      license_note:
        'Thomas Aquinas (1225–1274), Summa Contra Gentiles, in Joseph Rickaby’s annotated and '
        + 'abridged English translation "Of God and His Creatures" (Burns & Oates, London, 1905) — '
        + 'public domain; published 1905, and Rickaby died in 1932. Text from CCEL’s ThML edition '
        + '(ccel.org/ccel/aquinas/gentiles); the build refuses any file that does not name the 1905 '
        + 'Rickaby printing. Chapters Rickaby omitted are absent, not missing; his footnotes are kept '
        + 'after each chapter. CCEL’s own description and indexes are excluded and logged to '
        + 'tools/aquinas-gentiles/exclusions.txt. Built by tools/aquinas-gentiles/build.mjs.',
      chapter_count: chapterCount,
      paragraph_count: paragraphCount,
      note_paragraph_count: noteCount,
      scripture_ref_count: refStats.linked,
    },
    books,
  };

  const json = JSON.stringify(bundle);
  await writeFile(OUTPUT_PATH, json, 'utf8');
  await mkdir(dirname(DEPLOY_PATH), { recursive: true });
  await writeFile(DEPLOY_PATH, json, 'utf8');
  await writeFile(
    EXCLUSIONS_PATH,
    'Excluded from gentiles.json by tools/aquinas-gentiles/build.mjs.\n'
    + 'Columns: kind, label, size, opening words.\n\n'
    + `${exclusions.join('\n')}\n`,
    'utf8',
  );

  console.log(`\n${books.length} books, ${chapterCount} chapters, ${paragraphCount} paragraphs, `
    + `${noteCount} note paragraphs, ${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB`);
  for (const b of books) console.log(`   ${b.chapters.length.toString().padStart(3)} chapters  ${b.name}`);
  console.log(`${refStats.linked} Scripture references linked, ${refStats.unlinked} left as plain text.`);
  console.log(`${exclusions.length} exclusions logged.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
