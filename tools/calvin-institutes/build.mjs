// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads Calvin's Institutes of the Christian Religion from CCEL as
// ThML and writes institutes.json — a bundle shaped to feed Foundation's
// freeform compound import (one source, one `books` row per Book, one entry
// per paragraph, under a Book → Chapter → Section table of contents).
//
// PROVENANCE — read before changing any URL below.
// Source: CCEL's edition of Henry Beveridge's translation
//   https://ccel.org/ccel/calvin/institutes
// fetched as ThML from https://ccel.org/ccel/calvin/institutes.xml. Beveridge
// (died 1863) first published this translation in 1845 for the Calvin
// Translation Society; it is the standard 19th-century English rendering and
// the one most commonly cited in English-language Calvin scholarship, which
// is why it was chosen over John Allen's 1813 (Gutenberg) and Thomas Norton's
// archaic 1561.
//
// ============================================================================
// LICENCE — THE FILE IS NOT UNIFORMLY PUBLIC DOMAIN. READ THIS BEFORE EDITING.
// ============================================================================
// CCEL's <DC.Rights> for this work says "Public Domain", and for Calvin and
// Beveridge that is true many times over. But CCEL has bundled into the same
// file a modern editorial INTRODUCTION by "The Rev. John Murray, M.A.,
// Th.M." — the Westminster Theological Seminary professor John Murray
// (1898–1975), written for a 20th-century reprint of Beveridge and opening
// "The publication in English of another edition of the opus magnum of
// Christian theology is an event fraught with much encouragement... the
// publishers have confidence...". That essay is still in copyright: Murray
// died in 1975, so life+70 runs to 2045, and a US reprint of that era would
// have its own term. It is NOT covered by the work-level rights statement,
// which describes the 1845 translation the reprint carries.
//
// So this build does two things rather than one:
//   1. hard-fails unless <DC.Rights> says Public Domain AND the metadata
//      names Beveridge as translator and Calvin as author (the check every
//      other builder here performs); and
//   2. drops the Murray introduction by name, and then re-scans the finished
//      bundle for "John Murray" and hard-fails if a single trace survives.
// (2) is deliberately a tripwire rather than a filter: if CCEL ever renames
// or moves that division, the build must stop rather than quietly start
// shipping a copyrighted essay. A work-level rights statement is evidence
// about the work, not about every block inside the file — that is the lesson
// the Internet Archive's caveat on Calvin's Commentaries taught, reaching a
// different answer here because this time the non-free component is real.
//
// WHY NOT tools/npnf2/shared/thml.mjs. That module was offered as scaffolding
// to adapt, and on inspection it is the wrong shape. It is built around
// div-nesting: it votes on whether a division is a container of works or a
// flat run of chapters, and recovers sequence labels from titles and leading
// prefixes. The Institutes has exactly two div levels (div1 = Book, div2 =
// Chapter, no div3 at all) and its *sections* — the unit that matters, and
// the unit the standard citation names — are not elements. They are body
// paragraphs that open with a bare number ("1. Our wisdom, in so far as..."),
// which no amount of div-walking will find. Reusing that module would mean
// disabling most of it and bolting on the one thing it does not do, so this
// is a dedicated parser. Only the small, genuinely shared habits are carried
// over: attribute-agnostic <note> stripping and inline-tag unwrapping.
//
// STRUCTURE, as measured rather than assumed:
//   div1  Title Page          — publisher boilerplate, excluded
//   div1  Prefatory Material  — 13 div2s, a mix (see PREFATORY_KEEP below)
//   div1  BOOK FIRST/…FOURTH  — 19/18/26/21 div2s: an ARGUMENT plus the
//                               18/17/25/20 canonical chapters
//   div1  ONE HUNDRED APHORISMS — 4 div2s, one per Book: a numbered digest
//   div1  Indexes             — CCEL apparatus, excluded
// Inside a chapter: an <h3> with the chapter number, <p class="introHead">
// with its subject and the word "Sections.", then <p class="intro"> synopsis
// lines (one per section, the edition's analytical outline), then the body
// paragraphs. Sections run to more than one paragraph — Book First alone has
// 165 numbered openings across 216 body paragraphs — so a section is NOT one
// paragraph and the citation goes on the paragraph that opens it, exactly as
// the Talmud bundle puts a daf's citation on its opening paragraph.
//
// WHAT IS EXCLUDED, AND WHY. The Murray introduction (above, on licence
// grounds); the title page; CCEL's reference apparatus — Tables I–III of
// Scripture/Hebrew/Greek, the Index to Authors Quoted, the General Index of
// Chapters, and the two Indexes divisions; and the edition's numbered
// footnotes (<note>), which are Beveridge's apparatus, the same call made for
// Whiston's footnotes in josephus/build.mjs. Calvin's own Scripture citations
// are primary content and are KEPT: <scripRef> is unwrapped to its text, not
// dropped. Every exclusion is logged block by block to exclusions.txt.
//
// SCRIPTURE LINKS. Each <scripRef> also carries CCEL's machine-read
// `osisRef` ("Bible:Rom.12.6"), which resolves even the bare continuations
// Calvin writes ("Rom. 8:32; 12:6" tags "12:6" as Romans too) that no text
// parser could. The tag is swapped for sentinel characters that ride through
// every text transformation untouched, and only once a paragraph is final
// are they lifted out into character offsets (see liftRefs). The stored text
// is identical to what it would be without the links.
//
// Resumable: raw ThML is cached under raw/, so a re-run skips the download.
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
const OUTPUT_PATH = join(HERE, 'institutes.json');
const DEPLOY_PATH = join(HERE, '..', '..', 'public', 'library', 'reformation', 'institutes.json');
const EXCLUSIONS_PATH = join(HERE, 'exclusions.txt');

const XML_URL = 'https://ccel.org/ccel/calvin/institutes.xml';
const USER_AGENT =
  'FoundationCalvinInstitutesBuilder/1.0 (personal, non-commercial, offline Bible study app; '
  + 'one-time archival fetch; contact: shintax909@gmail.com)';

const REFETCH = process.argv.includes('--refetch');

// The copyrighted essay this build must never ship. Matched on the division
// title, and independently tripwired on the author's name in the output.
const COPYRIGHTED_INTRO_TITLE = 'Introduction';
const COPYRIGHTED_INTRO_AUTHOR = 'John Murray';

// Prefatory divisions to KEEP, with the attribution each carries. Everything
// else under "Prefatory Material" is reference apparatus and is excluded.
// Listed explicitly rather than filtered by pattern: this is the division
// that holds the one copyrighted block in the file, so membership here is a
// decision recorded per item, not a rule that might sweep a new one in.
const PREFATORY_KEEP = new Map([
  ['The Printers to the Readers.', 'The printers, to the readers (1561 edition)'],
  ['The Original Translator’s Preface.', 'Thomas Norton, translator’s preface (1561)'],
  ['Prefatory Address', 'John Calvin, prefatory address to King Francis I'],
  ['The Epistle to the Reader', 'John Calvin, epistle to the reader'],
  ['Subject of the Present Work', 'John Calvin, the subject of the present work'],
  ['Epistle to the Reader.', 'John Calvin, epistle to the reader'],
  ['Method and Arrangement, or Subject of the Whole Work.', 'John Calvin, method and arrangement'],
]);

// `citation` is the number the standard Book.Chapter.Section reference uses;
// only the four Books have one.
const BOOK_TITLES = new Map([
  ['BOOK FIRST', { name: 'Book First — Of the Knowledge of God the Creator', citation: 1 }],
  ['BOOK SECOND', { name: 'Book Second — Of the Knowledge of God the Redeemer, in Christ', citation: 2 }],
  ['BOOK THIRD', { name: 'Book Third — The Mode of Obtaining the Grace of Christ', citation: 3 }],
  ['BOOK FOURTH', { name: 'Book Fourth — Of the Holy Catholic Church', citation: 4 }],
]);

// "CHAPTER 7. - THE TESTIMONY..." -> 7. An ARGUMENT or a prefatory piece has
// no number and returns null.
function chapterNumber(title) {
  const m = /^CHAPTER\s+(\d+)\./i.exec(title);
  return m ? Number(m[1]) : null;
}

// OSIS book abbreviations paired with Foundation's canonical names
// (src/bibleMeta.ts CANONICAL_BOOKS). Duplicated rather than imported because
// this script runs outside the app's TypeScript build, as in jfb/build.mjs.
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

// Sentinels marking a <scripRef> inside paragraph text until liftRefs:
// REF_OPEN osisRef REF_MID visible text REF_CLOSE. Control characters, so
// neither the whitespace collapse nor any regex below touches them.
const REF_OPEN = '';
const REF_MID = '';
const REF_CLOSE = '';
const REF_MARKUP = /[^]*|/g;

const exclusions = [];
function logExclusion(kind, label, text) {
  const flat = String(text).replace(REF_MARKUP, '').replace(/\s+/g, ' ').trim();
  exclusions.push(`${kind}\t${label}\t${flat.length} bytes\t${flat.slice(0, 160)}`);
}

// ---------- download ----------

async function loadXml() {
  const cached = join(RAW_DIR, 'institutes.xml');
  if (!REFETCH && existsSync(cached)) {
    console.log('  reusing raw/institutes.xml');
    return readFile(cached, 'utf8');
  }
  console.log(`  downloading ${XML_URL}`);
  const res = await fetch(XML_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/xml' },
  });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${XML_URL}`);
  const text = await res.text();
  if (text.length < 1_000_000) throw new Error(`institutes.xml is only ${text.length} bytes — truncated?`);
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(cached, text, 'utf8');
  return text;
}

// Refuse to build from a file that no longer declares itself public domain,
// or that is not the edition this script was written against. Same hard fail
// as jfb/build.mjs and calvin-commentaries/build.mjs.
function assertPublicDomainBeveridge(xml) {
  const headEnd = xml.indexOf('</ThML.head>');
  if (headEnd === -1) throw new Error('No ThML head — refusing to build.');
  const head = xml.slice(0, headEnd);

  const rights = /<DC\.Rights>([^<]*)<\/DC\.Rights>/i.exec(head);
  if (!rights) throw new Error('institutes.xml declares no DC.Rights — refusing to build.');
  if (!/^\s*public domain\s*$/i.test(rights[1])) {
    throw new Error(`institutes.xml declares DC.Rights="${rights[1].trim()}", not "Public Domain" — refusing to build.`);
  }
  if (!/Beveridge,\s*Henry/i.test(head)) {
    throw new Error('institutes.xml does not name Henry Beveridge as translator — refusing to build.');
  }
  if (!/Calvin,\s*John\s*\(\s*1509\s*-\s*1564\s*\)/i.test(head)) {
    throw new Error('institutes.xml does not name John Calvin as author — refusing to build.');
  }
  const bookId = /<bookID>([^<]*)<\/bookID>/i.exec(head);
  if (!bookId || bookId[1].trim() !== 'institutes') {
    throw new Error(`institutes.xml declares bookID="${bookId?.[1]?.trim() ?? 'none'}" — not the work expected.`);
  }
  console.log(`  licence check passed: DC.Rights=${rights[1].trim()}, translator Beveridge, author Calvin`);
}

// ---------- ThML → text ----------

function stripNotes(xml) {
  return xml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, (m) => {
    logExclusion("editor's footnote", 'note', m.replace(/<[^>]*>/g, ' '));
    return ' ';
  });
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, '&');
}

// <scripRef> holds Calvin's own Scripture citations — primary content. The
// tag goes, the reference text stays, bracketed by sentinels (see REF_OPEN).
function inlineToText(html) {
  return decodeEntities(
    html
      .replace(
        /<scripRef\b([^>]*)>([\s\S]*?)<\/scripRef>/gi,
        (_, attrs, inner) => `${REF_OPEN}${attr(attrs, 'osisRef') ?? ''}${REF_MID}${inner}${REF_CLOSE}`,
      )
      .replace(/<pb\b[^>]*\/?>/gi, ' ')
      .replace(/<index\b[^>]*\/?>/gi, '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/?(span|i|b|em|strong|sup|sub|u|a|font|small|l|lg)\b[^>]*>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function attr(tag, name) {
  const m = new RegExp(String.raw`(?:^|\s)${name}="([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

// Split a chunk of markup into its <p> elements, keeping each one's class so
// the caller can tell the edition's synopsis lines from Calvin's prose.
function paragraphs(chunk) {
  const out = [];
  const re = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(chunk)) !== null) {
    const cls = attr(m[0], 'class') ?? '';
    const text = inlineToText(m[2]);
    if (text) out.push({ cls, text });
  }
  return out;
}

// Slice the document into div1s, and each div1 into its div2s.
function divisions(xml) {
  const d1 = [...xml.matchAll(/<div1\b[^>]*>/gi)];
  return d1.map((m, i) => {
    const end = d1[i + 1]?.index ?? xml.length;
    const body = xml.slice(m.index, end);
    const d2 = [...body.matchAll(/<div2\b[^>]*>/gi)];
    return {
      title: (attr(m[0], 'title') ?? '').trim(),
      children: d2.map((c, j) => ({
        title: (attr(c[0], 'title') ?? '').trim(),
        body: body.slice(c.index, d2[j + 1]?.index ?? body.length),
      })),
    };
  });
}

// ---------- chapter parsing ----------

// Turn one chapter's markup into its synopsis lines and its numbered
// sections.
//
// SEPARATING THE SYNOPSIS FROM THE BODY. Each chapter prints an analytical
// outline — one summary line per section — before the prose. Some chapters
// mark those lines `class="intro"`; MANY DO NOT (Book 1 ch. 1 does, ch. 7
// carries no class attribute at all), so class cannot be the test. Filtering
// on it silently passed the outline through as the body: the text stored for
// the citation 1.7.4 was "4. Conclusion, That the authority of Scripture is
// founded on..." — the summary — with Calvin's actual prose appended to it as
// continuation paragraphs.
//
// What IS uniform is the shape: a marker paragraph reading "Sections." (or
// "Section."), then the outline numbered 1..N, then the body numbered 1..N
// all over again. So the body is found by the RESTART: after the marker, a
// numbered run is the outline until the count returns to 1, and from there it
// is Calvin. A chapter with no marker (the prefatory pieces, the Aphorisms)
// has no outline and is read as body throughout.
//
// A section opens at a body paragraph beginning "<n>. ", and the number is
// VALIDATED rather than trusted: it must be the next in sequence, so a
// paragraph that merely happens to start with a numeral cannot open a
// spurious section. One that breaks sequence is kept as continuation prose
// and logged, so the case stays visible instead of being guessed at.
function parseChapter(chapterBody, label) {
  const ps = paragraphs(chapterBody);
  const synopsis = [];
  const sections = [];

  const numbered = (t) => {
    const m = /^(\d+)\.\s+/.exec(t);
    return m ? Number(m[1]) : null;
  };

  let i = 0;
  const markerAt = ps.findIndex((p) => /^sections?\.\s*$/i.test(p.text));
  if (markerAt !== -1) {
    // Everything up to the marker is the chapter's own heading, which the
    // div2 `title` attribute already carries.
    for (let k = 0; k < markerAt; k++) logExclusion('chapter heading (kept in the title)', label, ps[k].text);
    i = markerAt + 1;
    // The outline ends where the body begins, and the body always opens at
    // section 1 — so the boundary is the SECOND paragraph numbered 1 (the
    // first being the outline's own opening line).
    //
    // Deliberately not "a run that climbs 1, 2, 3…": the outline breaks that
    // sequence often enough to matter. Book 3 ch. 21 opens its outline "l."
    // with a lowercase L where the scan should read a 1, and 4.15/4.16/4.20
    // each drop a number partway down. A climbing run stops dead at the first
    // such break and spills the rest of the outline into Calvin's prose —
    // which is exactly what it did, putting 159 outline lines into the body.
    // Waiting for the restart tolerates every one of those defects, because
    // it relies only on the body starting at 1.
    let seenNumbered = false;
    while (i < ps.length) {
      const n = numbered(ps[i].text);
      if (n === 1 && seenNumbered) break;
      if (n !== null) seenNumbered = true;
      synopsis.push(ps[i].text);
      i += 1;
    }
  }

  // Seed from the first numbered paragraph rather than assuming 1. The
  // Aphorisms run as one list of 100 across four chapters, so every chapter
  // but the first opens partway up the count.
  let expected = ps.slice(i).map((p) => numbered(p.text)).find((n) => n !== null) ?? 1;

  // The outline, where there is one, states how many sections the chapter has
  // — one summary line each. Used as the ceiling on what may count as a
  // section number, which turns the edition's own analysis into a cross-check
  // rather than trusting the body's numbering alone.
  const ceiling = synopsis.length > 0 ? synopsis.length : Infinity;
  let last = 0;

  for (; i < ps.length; i++) {
    const p = ps[i];
    const n = numbered(p.text);
    // A section opens on the next number in sequence — or on any later number
    // still within the outline's count, because ONE malformed numeral must
    // not cascade. Book 3 ch. 22 lost sections 2 through 11 to a single "2."
    // the scan failed to render: a strict +1 rule waited for a 2 that never
    // arrived and swallowed the remaining nine sections as continuation
    // prose. Bridging the gap is logged, so a scan defect stays visible.
    if (n !== null && n >= expected && n <= ceiling && n > last) {
      if (n !== expected) {
        logExclusion(
          'section number missing from the scan (numbering continues past it)',
          label, `expected ${expected}, found ${n}: ${p.text}`,
        );
      }
      sections.push({ section: n, paragraphs: [p.text] });
      last = n;
      expected = n + 1;
      continue;
    }
    if (n !== null && sections.length > 0) {
      logExclusion('numbered paragraph out of sequence (kept as prose)', label, p.text);
    }
    if (sections.length === 0) {
      // Prose before the first numbered section — an unnumbered piece (the
      // prefatory addresses) or a lead-in. Held as section 0 so it is never
      // dropped.
      sections.push({ section: 0, paragraphs: [p.text] });
      continue;
    }
    sections[sections.length - 1].paragraphs.push(p.text);
  }
  return { synopsis, sections };
}

// ---------- build ----------

function build(xml) {
  assertPublicDomainBeveridge(xml);
  const clean = stripNotes(xml);
  const books = [];
  let sawCopyrightedIntro = false;

  for (const d1 of divisions(clean)) {
    const key = [...BOOK_TITLES.keys()].find((k) => d1.title.toUpperCase().startsWith(k));

    if (d1.title === 'Title Page') {
      logExclusion('publisher boilerplate', d1.title, d1.title);
      continue;
    }
    if (d1.title === 'Indexes') {
      for (const c of d1.children) logExclusion("CCEL reference apparatus", c.title, c.title);
      continue;
    }

    if (d1.title === 'Prefatory Material') {
      const chapters = [];
      for (const c of d1.children) {
        if (c.title === COPYRIGHTED_INTRO_TITLE) {
          sawCopyrightedIntro = true;
          logExclusion(
            'STILL IN COPYRIGHT — excluded on licence grounds',
            `${c.title} (by ${COPYRIGHTED_INTRO_AUTHOR}, d. 1975)`,
            'Modern editorial introduction written for a 20th-century reprint; not covered by the '
            + "work-level public-domain statement, which describes Beveridge's 1845 translation.",
          );
          continue;
        }
        const attribution = PREFATORY_KEEP.get(c.title);
        if (!attribution) {
          logExclusion('CCEL reference apparatus', c.title, c.title);
          continue;
        }
        const { sections } = parseChapter(c.body, c.title);
        chapters.push({ title: c.title, number: null, attribution, synopsis: [], sections });
      }
      if (chapters.length > 0) books.push({ name: 'Prefatory Material', citation: null, chapters });
      continue;
    }

    if (key) {
      const chapters = [];
      for (const c of d1.children) {
        const { synopsis, sections } = parseChapter(c.body, `${d1.title} / ${c.title}`);
        chapters.push({
          title: c.title, number: chapterNumber(c.title), attribution: null, synopsis, sections,
        });
      }
      books.push({ ...BOOK_TITLES.get(key), chapters });
      continue;
    }

    if (d1.title.toUpperCase().startsWith('ONE HUNDRED APHORISMS')) {
      const chapters = d1.children.map((c) => {
        const { sections } = parseChapter(c.body, c.title);
        return { title: c.title, number: null, attribution: null, synopsis: [], sections };
      });
      books.push({ name: 'One Hundred Aphorisms', citation: null, chapters });
      continue;
    }

    logExclusion('unrecognised division', d1.title, d1.title);
  }

  if (!sawCopyrightedIntro) {
    throw new Error(
      `The "${COPYRIGHTED_INTRO_TITLE}" division by ${COPYRIGHTED_INTRO_AUTHOR} was not found where `
      + 'this build expects it. CCEL may have restructured the file. Refusing to build rather than '
      + 'risk shipping a copyrighted essay — re-inspect the source and update this script.',
    );
  }
  return books;
}

// "Bible:Rom.12.6-Rom.12.8" -> Romans 12:6. A range or a list links to its
// first passage; a chapter-only ref ("Bible:Ps.93") has a null verse. Returns
// null outside the 66 books (the Apocrypha) or for anything unparseable.
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

// Strips the sentinels from one finished paragraph and reports each linked
// span as [start, end, book, chapter, verse] offsets into the clean text.
// Re-applies the collapse-and-trim inlineToText did, because a sentinel can
// sit between two spaces that would otherwise have merged — so the clean text
// is exactly what the build produced before links existed.
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
      // Whitespace at either edge belongs to the prose, not the link.
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

// Lifts every paragraph's sentinels in place, leaving plain strings and the
// links beside them as [paragraphIndex, start, end, book, chapter, verse].
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
      const label = `${b.name} / ${ch.title}`;
      const synopsisRefs = lift(ch.synopsis, label);
      if (synopsisRefs.length > 0) ch.synopsis_refs = synopsisRefs;
      for (const s of ch.sections) {
        const refs = lift(s.paragraphs, label);
        if (refs.length > 0) s.refs = refs;
      }
    }
  }
}

// The tripwire. A filter that silently stops matching is worse than no
// filter, so the finished bundle is searched for the author's name and the
// build dies if it appears anywhere.
function assertNoCopyrightedText(books) {
  const needle = COPYRIGHTED_INTRO_AUTHOR.toLowerCase();
  for (const b of books) {
    for (const ch of b.chapters) {
      for (const s of ch.sections) {
        for (const p of s.paragraphs) {
          if (p.toLowerCase().includes(needle)) {
            throw new Error(
              `"${COPYRIGHTED_INTRO_AUTHOR}" appears in ${b.name} / ${ch.title} after exclusion — `
              + 'refusing to build.',
            );
          }
        }
      }
    }
  }
  console.log(`  copyright tripwire passed: no trace of ${COPYRIGHTED_INTRO_AUTHOR} in the bundle`);
}

async function main() {
  const xml = await loadXml();
  const books = build(xml);
  liftAllRefs(books);
  assertNoCopyrightedText(books);

  const chapterCount = books.reduce((n, b) => n + b.chapters.length, 0);
  const sectionCount = books.reduce(
    (n, b) => n + b.chapters.reduce((m, c) => m + c.sections.length, 0), 0,
  );
  const paragraphCount = books.reduce(
    (n, b) => n + b.chapters.reduce(
      (m, c) => m + c.sections.reduce((k, s) => k + s.paragraphs.length, 0)
        + c.synopsis.length, 0,
    ), 0,
  );

  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'John Calvin — Institutes of the Christian Religion (tr. Beveridge, 1845)',
      author: 'John Calvin',
      translator: 'Henry Beveridge',
      source_site: 'https://ccel.org/ccel/calvin/institutes',
      license: 'public domain',
      license_note:
        'John Calvin (1509–1564), Institutes of the Christian Religion, in Henry Beveridge’s '
        + 'English translation, first published 1845 for the Calvin Translation Society — public '
        + 'domain; Beveridge died in 1863. Text from CCEL’s ThML edition '
        + '(ccel.org/ccel/calvin/institutes), which declares DC.Rights "Public Domain". CCEL’s '
        + 'file also carries a modern editorial introduction by John Murray (1898–1975), written '
        + 'for a 20th-century reprint and still in copyright; it is NOT included here, and the '
        + 'build refuses to run if it cannot be found and removed. Beveridge’s numbered footnotes '
        + 'and CCEL’s reference tables and indexes are excluded and logged to '
        + 'tools/calvin-institutes/exclusions.txt; Calvin’s own Scripture citations are kept in '
        + 'the text. Built by tools/calvin-institutes/build.mjs.',
      book_count: books.length,
      chapter_count: chapterCount,
      section_count: sectionCount,
      paragraph_count: paragraphCount,
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
    "Excluded from institutes.json by tools/calvin-institutes/build.mjs.\n"
    + 'Columns: kind, label, size, opening words.\n\n'
    + `${exclusions.join('\n')}\n`,
    'utf8',
  );

  console.log(`\n${books.length} books, ${chapterCount} chapters, ${sectionCount} sections, `
    + `${paragraphCount} paragraphs, ${(Buffer.byteLength(json) / 1048576).toFixed(2)} MB`);
  for (const b of books) {
    console.log(`   ${b.chapters.length.toString().padStart(3)} chapters  ${b.name}`);
  }
  console.log(`${refStats.linked} Scripture references linked, ${refStats.unlinked} left as plain text.`);
  console.log(`${exclusions.length} exclusions logged.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
