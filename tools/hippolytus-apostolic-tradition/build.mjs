// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads Project Gutenberg ebook #61614 — Burton Scott Easton's
// 1934 translation of Hippolytus's *The Apostolic Tradition* — parses its
// introduction and its numbered translation, strips Gutenberg's boilerplate
// and Easton's critical apparatus, and writes
// hippolytus-apostolic-tradition.json, a bundle shaped to feed Foundation's
// compound-work import (one source, two books, a 3-level toc_entries
// hierarchy). Download-and-clean only: does not touch src-tauri/, src/db.ts
// or src/importer.ts, and is not part of the app runtime.
//
// LICENCE — read before changing any ID below.
// The only edition this bundle may ship is Easton's, published 1934 by
// Cambridge University Press and PRINTED IN THE UNITED STATES, which makes
// it a domestic 1909-Act work rather than a foreign-first-publication case
// needing URAA analysis. Its 28-year copyright term expired unrenewed: the
// Catalog of Copyright Entries, Third Series (Renewals) was checked by hand
// across all four half-year volumes the renewal window could fall in —
// Jan–Jun 1961, Jul–Dec 1961, Jan–Jun 1962, Jul–Dec 1962 — and carries no
// entry for Easton. Project Gutenberg reached the same conclusion
// independently: it distributes the text freely, and its transcribers state
// in the ebook itself that "this eBook is public-domain in the country of
// publication".
//
// Gregory Dix's 1937 edition and the Dix/Chadwick 1968 revision are still in
// copyright (SPCK). They must never be used as a source text here, and the
// wording of this translation must never be checked against them.
//
// Resumable: raw HTML is cached under raw/, so a re-run skips the download.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUTENBERG_ID = 61614;
const SOURCE_URL = `https://www.gutenberg.org/files/${GUTENBERG_ID}/${GUTENBERG_ID}-h/${GUTENBERG_ID}-h.htm`;
const RAW_PATH = path.join(__dirname, 'raw', `${GUTENBERG_ID}-h.htm`);
const OUTPUT_PATH = path.join(__dirname, 'hippolytus-apostolic-tradition.json');
const DEPLOY_PATH = path.join(
  __dirname, '..', '..', 'public', 'library', 'patristic', 'hippolytus-apostolic-tradition.json',
);
const USER_AGENT =
  'FoundationHippolytusBuilder/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

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
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
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
      if (cached.length > 100000) return cached;
    } catch {
      /* not cached yet */
    }
  }
  const html = await fetchText(SOURCE_URL);
  await fs.mkdir(path.dirname(RAW_PATH), { recursive: true });
  await fs.writeFile(RAW_PATH, html, 'utf8');
  return html;
}

// Each entry is [regex, what its absence means]. Every phrase is matched
// against whitespace-normalised text, never the raw file: the transcription
// wraps its lines, and a wrap falling inside a phrase would fail the check on
// a perfectly good file.
const EDITION_MARKERS = [
  [/\*\*\* END OF THE PROJECT GUTENBERG EBOOK 61614 \*\*\*/i,
    `does not carry Project Gutenberg's end marker for ebook ${GUTENBERG_ID} — not the release ` +
    'this bundle is cleared to ship'],
  [/this eBook is public-domain in the country of publication/i,
    "no longer carries the transcribers' public-domain statement"],
  // Translator, not author: the risk here is shipping Dix or Dix/Chadwick,
  // both of which are still in copyright.
  [/<meta name="author" content="Burton Scott Easton" \/>/i,
    'does not declare Burton Scott Easton as its author — wrong ebook, or a different translation'],
  [/<meta name="DC.Title" content="The Apostolic Tradition of Hippolytus" \/>/i,
    'does not name "The Apostolic Tradition of Hippolytus" — wrong ebook'],
  // The printed verso, reproduced by the transcribers. These two lines ARE
  // the public-domain argument: a 1934 US printing with a US copyright notice
  // is a domestic 1909-Act work whose unrenewed term has expired. A release
  // that stopped reproducing them would no longer evidence the clearance.
  [/Copyright 1934, Cambridge University Press/i,
    "no longer reproduces the printed edition's 1934 Cambridge copyright notice"],
  [/PRINTED IN THE UNITED STATES OF AMERICA/i,
    'no longer reproduces the "PRINTED IN THE UNITED STATES OF AMERICA" line, which is what '
    + 'makes this a domestic work rather than a URAA restoration question'],
];

// Hard gate on edition and licence — see the header note. A mistyped ebook
// number, or a Gutenberg re-release that swapped the translation or dropped
// the evidence for the clearance, must fail the build rather than quietly
// ship a text this project has not cleared.
function assertEaston(html) {
  const flat = html.replace(/\s+/g, ' ');
  for (const [marker, complaint] of EDITION_MARKERS) {
    if (!marker.test(flat)) {
      throw new Error(
        `PG ${GUTENBERG_ID} ${complaint}. Refusing to build — re-verify the clearance before ` +
        'shipping this text.',
      );
    }
  }
}

// ---------------------------------------------------------------------------
// HTML → text
// ---------------------------------------------------------------------------

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  mdash: '—', ndash: '–', hellip: '…', sect: '§',
  sup1: '¹', sup2: '²', sup3: '³', deg: '°',
  auml: 'ä', ouml: 'ö', uuml: 'ü', eacute: 'é',
  egrave: 'è', agrave: 'à', ccedil: 'ç', oelig: 'œ',
  aelig: 'æ', szlig: 'ß', iuml: 'ï', ecirc: 'ê',
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+\d?);/gi, (m, name) => {
      const hit = ENTITIES[name] ?? ENTITIES[name.toLowerCase()];
      if (hit === undefined) {
        throw new Error(`Unhandled HTML entity "${m}" — add it to ENTITIES before building.`);
      }
      return hit;
    });
}

// Apparatus that must never reach entries.text:
//   .fn      Easton's footnote reference markers, "[71]"
//   .pb      the printed page numbers, both the between-block divs and the
//            spans set inside a paragraph — left in, "35" would fuse into
//            the sentence around it
//   .sn      the manuscript sigla (LAT/GRE/SAH/ETH) printed in the margin
//            beside the line each witness covers. Real information, but it
//            is *marginal* information: dropped into the run of the text it
//            reads as a word Hippolytus wrote. Foundation has nowhere to put
//            a margin, so it is dropped rather than corrupted in.
function stripApparatus(html) {
  return html
    .replace(/<a class="fn"[^>]*>[\s\S]*?<\/a>/g, '')
    .replace(/<div class="pb"[^>]*>[\s\S]*?<\/div>/g, '')
    .replace(/<span class="pb"[^>]*>[\s\S]*?<\/span>/g, '')
    .replace(/<span class="sn">[\s\S]*?<\/span>/g, '');
}

function toText(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

// A running-prose block: newlines are transcription line-wraps, not breaks.
function paragraphText(html) {
  return toText(html).replace(/\s+/g, ' ').trim();
}

// A liturgical dialogue or a verse quotation, where the printed line breaks
// carry meaning ("The Lord be with you." / "And with thy spirit."). Kept as
// ONE entry with its lines intact rather than split into one-line entries:
// entries.text renders pre-wrap, and a versicle and its response are a unit
// to highlight or note, not two.
function verseText(html) {
  return toText(html)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// Leftmost-match alternation: a verse or blockquote wrapper is matched
// before the <p> elements inside it, so those are consumed with their
// wrapper rather than emitted twice.
const BLOCK_RE = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>|<div class="verse">([\s\S]*?)<\/div>|<blockquote>([\s\S]*?)<\/blockquote>|<p\b[^>]*>([\s\S]*?)<\/p>/g;

// Walks one region of the document, emitting { kind, level, text, raw }.
function* blocks(region) {
  BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = BLOCK_RE.exec(region)) !== null) {
    const [, hLevel, hBody, verse, quote, para] = m;
    if (hBody !== undefined) {
      yield { kind: 'heading', level: Number(hLevel), text: paragraphText(hBody), raw: hBody };
    } else if (verse !== undefined) {
      yield { kind: 'verse', text: verseText(verse), raw: verse };
    } else if (quote !== undefined) {
      // A blockquote wraps its own <p>s; flatten them into one paragraph.
      yield { kind: 'para', text: paragraphText(quote), raw: quote };
    } else {
      yield { kind: 'para', text: paragraphText(para), raw: para };
    }
  }
}

const MINOR_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'nor', 'of',
  'on', 'or', 'the', 'to', 'with',
]);

// Easton's headings are set in full caps. Only an all-caps heading is
// recased, so anything already carrying its printed casing ("Ordination",
// "Lay Devotions") is left exactly as it is.
function titleCase(s) {
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

function region(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Could not find "${startMarker}" — has the transcription changed?`);
  }
  const end = html.indexOf(endMarker, start + startMarker.length);
  if (end === -1) {
    throw new Error(`Could not find "${endMarker}" — has the transcription changed?`);
  }
  return html.slice(start, end);
}

// ---------------------------------------------------------------------------
// Easton's introduction
// ---------------------------------------------------------------------------

// Four top-level pieces, in printed order. The printed CONTENTS table and the
// running INTRODUCTION half-title between them carry no text of their own and
// are skipped; "The Important Books" is Easton's annotated bibliography,
// which sits physically inside the front matter but reads as its own section.
const INTRO_PARTS = [
  { title: 'Prefatory Note', start: '<h2 id="ch1"', end: '<h2 id="toc"' },
  { title: 'The Important Books', start: '<h3>THE IMPORTANT BOOKS</h3>', end: '<h2 id="ch2"' },
  { title: 'I. Church Orders', start: '<h2 id="ch3"', end: '<h2 id="ch4"' },
  { title: 'II. Hippolytus', start: '<h2 id="ch4"', end: '<h2 id="ch5"' },
];

// Returns [{ title, subsections: [{ title, paragraphs }] }]. A part's text
// before its first <h3> becomes an untitled lead-in subsection, so nothing is
// dropped for want of a heading.
function parseIntroduction(html) {
  return INTRO_PARTS.map((part) => {
    const body = stripApparatus(region(html, part.start, part.end));
    const subsections = [{ title: '', paragraphs: [] }];
    let current = subsections[0];

    for (const block of blocks(body)) {
      if (block.kind === 'heading') {
        // The part's own <h2> repeats its title; only <h3>s subdivide it.
        if (block.level === 2) continue;
        current = { title: titleCase(block.text), paragraphs: [] };
        subsections.push(current);
        continue;
      }
      if (block.text) current.paragraphs.push(block.text);
    }
    return {
      title: part.title,
      subsections: subsections
        .filter((s) => s.paragraphs.length > 0)
        // "The Important Books" is its own <h3> *and* the whole part, so
        // keeping the title here would give the TOC a row nested under an
        // identically named parent.
        .map((s) => (s.title === part.title ? { ...s, title: '' } : s)),
    };
  });
}

// ---------------------------------------------------------------------------
// The translation
// ---------------------------------------------------------------------------

// Easton's part names, from the headings he gives them in the Notes ("PART I
// / Ordination"). The printed translation heads them "PART I" alone, so the
// name is carried across from his own wording rather than invented.
const PART_NAMES = {
  'PART I': 'Ordination',
  'PART II': 'Baptism',
  'PART III': 'Church Laws',
  'PART IV': 'Lay Devotions',
  'LATER ADDITIONS': '',
};

// Section titles, likewise Easton's own — the headings over his Notes, which
// key by chapter or by a span of chapters. He gives the printed translation
// no section titles at all, so without these the TOC would be 38 rows reading
// "Chapter 2", "Chapter 3", … A span's title is attached to the chapter that
// OPENS it and the span is named in the row ("Chapters 4-6. The Eucharist"),
// exactly as his Notes head it; the chapters inside the span are left
// untitled, because he did not separately title them and inventing a name
// for each would be putting words in his mouth.
const SECTION_TITLES = [
  { from: 2, to: 2, title: 'The Bishop' },
  { from: 4, to: 6, title: 'The Eucharist' },
  { from: 8, to: 8, title: 'Presbyters' },
  { from: 9, to: 9, title: 'Deacons' },
  { from: 10, to: 10, title: 'Confessors' },
  { from: 11, to: 15, title: 'Minor Orders' },
  { from: 16, to: 20, title: 'Catechumens' },
  { from: 21, to: 21, title: 'The Baptismal Ceremony' },
  { from: 22, to: 22, title: 'Confirmation' },
  { from: 23, to: 23, title: 'The Baptismal Eucharist' },
  { from: 26, to: 26, title: 'The Agape' },
  { from: 38, to: 38, title: 'Conclusion' },
];

// Easton numbered the translation's sentences as superscript "verses". They
// are kept: his notes, his introduction and the scholarly literature all cite
// the work as "36. 12", and without the superscripts that citation cannot be
// followed in the reading pane.
const SUPERSCRIPTS = /[¹²³⁰⁴-⁹]/;

// A paragraph that opens a numbered chapter: "2." either as the anchor the
// transcription usually sets, or bare (the Ethiopic later additions).
const CHAPTER_OPEN_RE = /^\s*(?:<a id="tch(\d+)"[^>]*>\s*\d+\.\s*<\/a>|(\d{1,2})\.(?=\s|&))/;

function parseTranslation(html) {
  const body = stripApparatus(region(html, '<h2 id="ch5"', '<h2 id="ch6"'));
  const parts = [];
  let part = null;
  let chapter = null;
  // Easton's running discussion inside "Later Additions", dropped below.
  let commentaryDropped = 0;

  const openPart = (label) => {
    part = { label, name: PART_NAMES[label] ?? '', chapters: [] };
    parts.push(part);
    chapter = null;
  };
  const openChapter = (number) => {
    if (!part) openPart('');
    chapter = { number, paragraphs: [] };
    part.chapters.push(chapter);
  };

  for (const block of blocks(body)) {
    if (block.kind === 'heading') {
      // The <h2> is the work's own title page ("THE APOSTOLIC TRADITION OF
      // HIPPOLYTUS / TRANSLATION"), not a section.
      if (block.level === 2) continue;
      const label = block.text.toUpperCase();
      if (!(label in PART_NAMES)) {
        throw new Error(
          `Unexpected heading "${block.text}" in the translation — check the transcription.`,
        );
      }
      openPart(label);
      continue;
    }
    if (!block.text) continue;

    const open = block.kind === 'para' ? block.raw.match(CHAPTER_OPEN_RE) : null;
    if (open) {
      openChapter(Number(open[1] ?? open[2]));
      // The chapter numeral is carried in the entry's label and the TOC row,
      // so it is stripped from the prose rather than printed twice.
      const text = block.text.replace(/^\d{1,2}\.\s*/, '');
      if (text) chapter.paragraphs.push(text);
      continue;
    }

    // "Later Additions" prints Easton's discussion of each addition directly
    // beneath it, with no heading to separate the two. His paragraphs are the
    // ones carrying no verse superscript — every paragraph of the translation
    // itself is numbered. Notes are excluded from this bundle, so they are
    // dropped here; the count is asserted below, so a change in the
    // transcription cannot silently start merging his prose into
    // Hippolytus's, nor throw Hippolytus's away.
    // A verse block is always the translation — a versicle or a psalm, never
    // Easton's prose — so only running paragraphs are tested.
    if (part?.label === 'LATER ADDITIONS' && block.kind === 'para' && !SUPERSCRIPTS.test(block.text)) {
      commentaryDropped++;
      continue;
    }

    if (!chapter) {
      throw new Error(`Text before the first numbered chapter: "${block.text.slice(0, 60)}…"`);
    }
    chapter.paragraphs.push(block.text);
  }

  return { parts, commentaryDropped };
}

function sectionTitleFor(number) {
  const span = SECTION_TITLES.find((s) => s.from === number);
  if (!span) return { title: '', span: '' };
  return {
    title: span.title,
    span: span.from === span.to ? '' : `${span.from}-${span.to}`,
  };
}

// ---------------------------------------------------------------------------
// Shape checks
// ---------------------------------------------------------------------------

// Easton's chapter numbering is not a simple run: there is no chapter 7, and
// 24, 26, 31 and 32 are printed twice over — once where the Oriental versions
// put them, once among the "Later Additions". Pinning the exact expected
// shape is what makes a changed transcription fail loudly instead of quietly
// shipping a work with chapters swallowed into one another.
const EXPECTED_TRANSLATION = {
  '': [1],
  'PART I': [2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15],
  'PART II': [16, 17, 18, 19, 20, 21, 22, 23],
  'PART III': [25, 26, 27, 28, 29, 30, 33, 34],
  'PART IV': [35, 36, 37, 38],
  'LATER ADDITIONS': [24, 26, 31, 32],
};
const EXPECTED_COMMENTARY_PARAGRAPHS = 6;
const EXPECTED_INTRO_SUBSECTIONS = {
  'Prefatory Note': 1,
  'The Important Books': 1,
  'I. Church Orders': 11,
  'II. Hippolytus': 2,
};

function assertShape(intro, translation) {
  for (const part of intro) {
    const expected = EXPECTED_INTRO_SUBSECTIONS[part.title];
    if (part.subsections.length !== expected) {
      throw new Error(
        `Introduction "${part.title}" parsed ${part.subsections.length} subsections, expected ` +
        `${expected}. The Gutenberg transcription has probably changed.`,
      );
    }
  }

  const got = Object.fromEntries(
    translation.parts.map((p) => [p.label, p.chapters.map((c) => c.number)]),
  );
  if (Object.keys(got).length !== Object.keys(EXPECTED_TRANSLATION).length) {
    throw new Error(
      `Translation parsed ${Object.keys(got).length} parts, expected ` +
      `${Object.keys(EXPECTED_TRANSLATION).length}.`,
    );
  }
  for (const [label, chapters] of Object.entries(EXPECTED_TRANSLATION)) {
    if (JSON.stringify(got[label]) !== JSON.stringify(chapters)) {
      throw new Error(
        `Translation "${label || '(preamble)'}" parsed chapters ${JSON.stringify(got[label])}, ` +
        `expected ${JSON.stringify(chapters)}. The Gutenberg transcription has probably changed.`,
      );
    }
  }
  for (const part of translation.parts) {
    for (const chapter of part.chapters) {
      if (chapter.paragraphs.length === 0) {
        throw new Error(`Chapter ${chapter.number} parsed with no text.`);
      }
    }
  }
  if (translation.commentaryDropped !== EXPECTED_COMMENTARY_PARAGRAPHS) {
    throw new Error(
      `Dropped ${translation.commentaryDropped} unnumbered paragraphs from "Later Additions", ` +
      `expected ${EXPECTED_COMMENTARY_PARAGRAPHS}. Check what is being dropped before trusting ` +
      "this — those paragraphs are Easton's discussion, and a miscount means either his prose " +
      "is reaching the text or Hippolytus's is being thrown away.",
    );
  }
}

// ---------------------------------------------------------------------------

const LICENSE_NOTE =
  'Public domain — Hippolytus of Rome (c. 170–235), The Apostolic Tradition, in Burton Scott '
  + "Easton's English translation (Cambridge University Press, 1934). Easton's edition was "
  + 'printed in the United States with a US copyright notice, making it a domestic 1909-Act work; '
  + 'its 28-year term expired unrenewed — the Catalog of Copyright Entries, Third Series '
  + '(Renewals) was checked across all four half-year volumes the renewal window could fall in '
  + '(Jan–Jun 1961, Jul–Dec 1961, Jan–Jun 1962, Jul–Dec 1962) with no entry for Easton in any of '
  + 'them. Text from Project Gutenberg ebook #61614, which likewise marks it "Public domain in '
  + "the USA\". Easton's introduction is included; his notes, footnotes and indexes are not. "
  + "Gregory Dix's 1937 edition and the Dix/Chadwick 1968 revision remain in copyright and are "
  + 'not used here.';

async function main() {
  const refetch = process.argv.includes('--refetch');
  process.stdout.write(`The Apostolic Tradition (PG ${GUTENBERG_ID})… `);
  const html = await loadRaw(refetch);
  assertEaston(html);

  const intro = parseIntroduction(html);
  const translation = parseTranslation(html);
  assertShape(intro, translation);

  const introduction = intro.map((part) => ({
    title: part.title,
    subsections: part.subsections,
  }));
  const parts = translation.parts.map((part) => ({
    label: part.label,
    name: part.name,
    chapters: part.chapters.map((chapter) => ({
      number: chapter.number,
      // Easton's note headings key by the chapter numbers of the treatise
      // proper. "Later Additions" reprints four of those numbers for the
      // Ethiopic variants of them, and a note titled "26 The Agape" is about
      // chapter 26 of the treatise, not its variant — so the titles are not
      // carried across.
      ...(part.label === 'LATER ADDITIONS'
        ? { title: '', span: '' }
        : sectionTitleFor(chapter.number)),
      paragraphs: chapter.paragraphs,
    })),
  }));

  const introParagraphs = introduction.reduce(
    (n, p) => n + p.subsections.reduce((m, s) => m + s.paragraphs.length, 0), 0,
  );
  const translationParagraphs = parts.reduce(
    (n, p) => n + p.chapters.reduce((m, c) => m + c.paragraphs.length, 0), 0,
  );
  const chapters = parts.reduce((n, p) => n + p.chapters.length, 0);

  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'Hippolytus — The Apostolic Tradition',
      author: 'Hippolytus of Rome (c. 170–235)',
      translator: 'Burton Scott Easton (1877–1950), translation published 1934',
      source_site: 'https://www.gutenberg.org/',
      gutenberg_id: GUTENBERG_ID,
      license_note: LICENSE_NOTE,
      total_paragraphs: introParagraphs + translationParagraphs,
    },
    introduction,
    translation: parts,
  };

  const json = JSON.stringify(bundle, null, 1);
  await fs.writeFile(OUTPUT_PATH, json, 'utf8');
  await fs.mkdir(path.dirname(DEPLOY_PATH), { recursive: true });
  await fs.writeFile(DEPLOY_PATH, json, 'utf8');

  console.log(
    `${introParagraphs} introduction paragraphs; ${translationParagraphs} paragraphs across ` +
    `${chapters} chapters in ${parts.length} parts`,
  );
  console.log(`wrote ${OUTPUT_PATH}`);
  console.log(`wrote ${DEPLOY_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
