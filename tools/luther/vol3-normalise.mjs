// Standalone data-prep pre-stage for Luther Volume III (run with
// `node vol3-normalise.mjs`, outside the Tauri app). Reads the Internet
// Archive's hOCR for the Holman & Castle Press printing and writes
// raw/luther-vol3.html — a Gutenberg-shaped HTML file that build.mjs's
// existing parser consumes unchanged.
//
// WHY THIS EXISTS. Volumes I and II came from Project Gutenberg, whose
// transcribers had already marked up the edition's apparatus: "[Sidenote:
// The Third Commandment]" for the printed marginal topic notes, "[Matt.
// 16:18]" for the printed marginal Scripture citations, a FOOTNOTES heading
// per work, <h3>/<h4> for structure. None of that exists in OCR of a page
// scan. Volume III is a page scan, so this script reconstructs that markup
// from what the page geometry actually says — column positions, type sizes
// and line spacing — and hands build.mjs the shape it already knows how to
// read. It is a translator into the existing contract, not a second parser:
// nothing here segments works, excludes apparatus or writes a bundle.
//
// EDITION. "Works of Martin Luther, with Introductions and Notes", Volume
// III, A. J. Holman Company and The Castle Press, Philadelphia. Copyright
// 1930 by A. J. Holman Company; public domain in the United States since
// 1 January 2026 on 95-year term expiry. Note that Internet Archive's
// catalogue date for this item reads "1915" — that is the *set's* date,
// inherited from the six-volume record (LCCN 15007839), and it is wrong for
// this volume. Provenance is asserted against the printed notice, never
// against IA's metadata field; see build.mjs's vol-3 provenance gate.
//
// NO NETWORK. The three hOCR files are supplied locally under raw/
// (gitignored, like every other builder's raw/ in this repo). See README.md
// for the three Internet Archive identifiers and how to fetch them.
//
// Usage:
//   node vol3-normalise.mjs            write raw/luther-vol3.html
//   node vol3-normalise.mjs --report   also write vol3-normalise-report.txt
//                                      and print the per-page classification
//                                      audit this project's discipline asks
//                                      for before trusting a new parser

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const OUT_PATH = path.join(RAW_DIR, 'luther-vol3.html');
const REPORT_PATH = path.join(__dirname, 'vol3-normalise-report.txt');

// The primary scan, and the two independent scans of the same volume used as
// a cross-check. The Muhlenberg Press copies are the 1930 reprint of this
// same text — a different setting of the same translation, which is what
// makes them useful as a control and useless as a substitute: their page
// numbering and line breaks differ, so they can confirm *what the text says*
// without being able to stand in for this printing's own provenance.
const SCANS = {
  primary: {
    id: 'worksofmartinlut03luth_0',
    file: 'vol3-holman.hocr',
    imprint: 'A. J. Holman Company and The Castle Press',
    label: 'Holman & Castle Press printing (Princeton Theological Seminary copy)',
  },
  controls: [
    {
      id: 'worksofmartinlut03luth',
      file: 'vol3-muhlenberg-princeton.hocr',
      imprint: 'Muhlenberg Press',
      label: 'Muhlenberg Press reprint (Princeton Theological Seminary copy)',
    },
    {
      id: 'worksofmartinlut0003vari',
      file: 'vol3-muhlenberg-winebrenner.hocr',
      imprint: 'Muhlenberg Press',
      label: 'Muhlenberg Press reprint (Winebrenner Theological Seminary copy)',
    },
  ],
};

// ---------------------------------------------------------------------------
// hOCR reading

const PAGE_RE = /<div class="ocr_page"[^>]*title="([^"]*)"/;
// `baseline` is optional: Tesseract omits it on about a hundred of this
// scan's lines — all of them tiny specks in the gutter. Requiring it dropped
// those lines before the conservation gate could count them, which is the
// one thing this script must never do quietly.
const LINE_RE =
  /<span class="ocr_line" id="[^"]+" title="bbox (\d+) (\d+) (\d+) (\d+);[^"]*?x_size ([\d.]+)[^"]*">([\s\S]*?)<\/span>\s*(?=<span class="ocr_line"|<\/p>)/g;
const WORD_RE =
  /<span class="ocrx_word" id="[^"]+" title="bbox (\d+) (\d+) (\d+) (\d+); x_wconf (\d+)[^"]*">([\s\S]*?)<\/span>/g;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function flat(html) {
  return decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}

function parseHocr(raw) {
  const pages = [];
  for (const chunk of raw.split(/(?=<div class="ocr_page")/)) {
    const head = PAGE_RE.exec(chunk);
    if (!head) continue;
    const box = /bbox (\d+) (\d+) (\d+) (\d+)/.exec(head[1]);
    if (!box) continue;
    const lines = [];
    LINE_RE.lastIndex = 0;
    let m;
    while ((m = LINE_RE.exec(chunk)) !== null) {
      const text = flat(m[6]);
      if (!text) continue;
      const words = [];
      WORD_RE.lastIndex = 0;
      let w;
      while ((w = WORD_RE.exec(m[6])) !== null) {
        const t = flat(w[6]);
        if (t) words.push({ x0: +w[1], x1: +w[3], text: t });
      }
      lines.push({
        x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], size: +m[5], text, words,
      });
    }
    lines.sort((a, b) => a.y0 - b.y0);
    pages.push({ index: pages.length, width: +box[3], lines });
  }
  return pages;
}

const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

// ---------------------------------------------------------------------------
// Page layout
//
// Every threshold below is derived per page rather than fixed, because this
// scan's pages are not uniform: page width ranges from 2377 to 2463 px and
// the body column's left edge ranges from 52 to 480 depending on how the
// leaf sat under the camera. A single sampled page's numbers, hard-coded,
// would mis-cut hundreds of pages. The one global constant is the volume's
// median body type size, computed from every dense page in the file.

function layout(page, bodySize) {
  const { width: W, lines } = page;
  // The body column is whatever the long lines agree on. Long is relative to
  // the page, and 55% is comfortably above the widest marginal note (which
  // never exceeds ~12% of the page) and below the shortest full body line.
  const wide = lines.filter((l) => l.x1 - l.x0 > 0.55 * W);
  if (wide.length < 5) return null;
  const left = median(wide.map((l) => l.x0));
  const right = median(wide.map((l) => l.x1));
  const size = median(wide.map((l) => l.size)) || bodySize;
  const leading = median(
    wide.slice(1).map((l, i) => l.y0 - wide[i].y0).filter((d) => d > 0),
  ) || 85;
  return { W, left, right, size, leading };
}

// The outer margin alternates side with the leaf (recto notes sit right of
// the body, verso notes left of it), so both sides are read rather than a
// side being assumed from page parity — a single missing leaf would invert
// parity for the rest of the volume and silently swap body for margin.
// Two conditions, because either alone misfires. Clearing the body column's
// edge is what puts a line in the margin — with no slack, since a note's
// second line ("7:15" under "Matt.") can end within 30px of the body edge
// and any tolerance there pushes it back into the text. Being narrow is what
// keeps a short final line of a paragraph, which also sits inside the column,
// from being mistaken for a note.
function isMarginLine(l, lay) {
  const outside = l.x1 <= lay.left || l.x0 >= lay.right;
  return outside && l.x1 - l.x0 < 0.3 * (lay.right - lay.left);
}

// Footnotes are set at the foot of the page under a blank rule. Type size
// alone does not find them: on the scholarly introduction pages the notes
// are set only a point or two smaller than the body and the two ranges
// overlap. The reliable signal is the rule itself — an inter-line gap well
// above the page's own leading, low on the page — corroborated by the size
// stepping down across it.
function splitFootnotes(bodyLines, lay) {
  if (bodyLines.length < 6) return [bodyLines, []];
  // Candidates are scanned from the foot of the page upwards, and the first
  // one that holds is taken. Taking the *widest* gap instead is wrong, and
  // wrong in a damaging way: a centred section heading is set off by more
  // space than the footnote rule is — 201px against 102px on the page that
  // opens the third article — so the widest gap on such a page is the
  // heading, and cutting there throws the rest of the article away as
  // apparatus. The rule is the lowest qualifying break, not the biggest.
  //
  // The gap only locates a candidate; the type size is what proves it is the
  // rule. The gap test is deliberately loose — this edition marks a new
  // paragraph by indenting it, never by adding space — and the size test is
  // what does the discriminating.
  const floor = Math.max(3, Math.floor(bodyLines.length * 0.45));
  for (let i = bodyLines.length - 1; i >= floor; i--) {
    const gap = bodyLines[i].y0 - bodyLines[i - 1].y0;
    if (gap < lay.leading * 1.15) continue;
    const after = bodyLines.slice(i);
    const sizeAfter = median(after.map((l) => l.size));
    const sizeBefore = median(bodyLines.slice(0, i).map((l) => l.size));
    if (sizeAfter < sizeBefore * 0.97) return [bodyLines.slice(0, i), after];
  }
  return [bodyLines, []];
}

// The running head — printed page number plus a short title — sits above the
// text block, separated by roughly twice the body leading. It carries the
// printed pagination, which is read (not discarded) so the structure gate
// can check the declared work boundaries against the volume's own page
// numbers.
// A section heading sits above the same double-leading gap as a running
// head, so the gap alone cannot tell them apart, and neither can type size:
// on the scholarly introduction pages the body is set several points smaller
// than the running head above it, so a heading is not reliably the largest
// thing on its page. What separates them is the printed page number. Every
// running head carries one at one end; a heading never does. Getting this
// wrong in the permissive direction leaves a running head visible in the
// text, which is obvious on sight; getting it wrong the other way deletes a
// heading and silently welds two sections together.
const PAGE_NUMBER_AT_EDGE = /^\s*\d[\dIloO]{0,2}\b|\b[\dIloO]{0,2}\d\s*$/;

function takeRunningHead(lines, lay) {
  if (lines.length < 4) return [null, lines];
  const gap = lines[1].y0 - lines[0].y0;
  if (gap < lay.leading * 1.45) return [null, lines];
  if (lines[0].x1 - lines[0].x0 > 0.92 * (lay.right - lay.left)) return [null, lines];
  if (!PAGE_NUMBER_AT_EDGE.test(lines[0].text)) return [null, lines];
  return [lines[0], lines.slice(1)];
}

function printedPageNumber(head) {
  if (!head) return null;
  // "152 The Magnificat" (verso) and "Introduction 9" (recto). Roman-numeral
  // confusions are common at this size ("I5I" for 151, "1o" for 10), so only
  // a clean run of digits at one end is trusted.
  const first = /^(\d{1,3})\b/.exec(head.text);
  const last = /\b(\d{1,3})$/.exec(head.text);
  const n = first ? +first[1] : last ? +last[1] : null;
  return n && n > 0 && n < 600 ? n : null;
}

// ---------------------------------------------------------------------------
// Marginal apparatus
//
// A marginal note wraps over two or three lines in its narrow column, and
// several notes share a page. Spacing alone cannot tell one note's lines
// from the next note's: measured across this scan, the gap *inside* a note
// runs 45-70px and the gap *between* two notes runs 45-1030px, so the two
// distributions overlap almost completely. What separates them is what the
// lines say. A line naming a book of the Bible always opens a new citation;
// a bare chapter-and-verse continues the citation above it; running prose
// continues the topic note above it. Grouping is driven by that, with
// spacing used only to stop a note reaching across half a page.

// Built on first use: the abbreviation tables it reads are declared further
// down, with the citation code they belong to.
let BOOK_WORD = null;
function bookWordRe() {
  if (!BOOK_WORD) {
    const words = [...Object.keys(BOOK_ABBREVIATIONS), ...Object.keys(ORDINAL_BOOKS)]
      .sort((a, b) => b.length - a.length);
    BOOK_WORD = new RegExp(String.raw`^(?:[123]\s*)?(?:${words.join('|')})\b\.?`, 'i');
  }
  return BOOK_WORD;
}
const NUMERIC_ONLY = /^[\s:.,;()[\]ilIoOsSbB£€f'’-]*\d[\d\s:.,;()[\]ilIoOsSbB£€f'’-]*$/;

function classifyMarginLine(text) {
  const t = text.trim();
  if (!t) return 'blank';
  if (bookWordRe().test(t)) return 'book';
  if (NUMERIC_ONLY.test(t)) return 'num';
  return 'prose';
}

// Lines within one printed reference are run together; separate references
// chained under a single book name are rejoined with the semicolon the
// edition itself uses between them.
function joinParts(parts, vocabulary) {
  return parts.map((p) => dehyphenate(p.map((l) => l.text), vocabulary)).join('; ');
}

function groupMarginNotes(marginLines, lay, vocabulary) {
  const gaps = marginLines.slice(1)
    .map((l, i) => l.y0 - marginLines[i].y0)
    .filter((d) => d > 0 && d < lay.leading * 1.6);
  const leading = median(gaps) || 60;
  const notes = [];
  for (const l of marginLines) {
    const kind = classifyMarginLine(l.text);
    if (kind === 'blank') continue;
    const prev = notes[notes.length - 1];
    const last = prev ? prev.parts[prev.parts.length - 1] : null;
    const gap = prev ? l.y0 - last[last.length - 1].y0 : Infinity;
    const near = gap < leading * 2.3;
    if (kind === 'num' && prev && prev.kind === 'cite' && near) {
      // A bare chapter-and-verse under a book name. If the reference above it
      // is still missing its numbers this line supplies them; if it is
      // already complete, the margin is listing a chain under one book
      // ("1 Cor. 11:26 / 11:27 / 11:28"), which is a second reference to the
      // same book rather than a new note.
      if (prev.complete) prev.parts.push([l]);
      else last.push(l);
      prev.complete = resolveCitation(joinParts(prev.parts, vocabulary)) !== null;
      continue;
    }
    if (kind === 'prose' && prev && prev.kind === 'prose' && near) {
      last.push(l);
      continue;
    }
    const note = { kind: kind === 'prose' ? 'prose' : 'cite', parts: [[l]], complete: false };
    if (note.kind === 'cite') note.complete = resolveCitation(l.text) !== null;
    notes.push(note);
  }
  return notes.map((n) => ({
    y: n.parts[0][0].y0,
    kind: n.kind,
    text: joinParts(n.parts, vocabulary),
  }));
}

// Both the body and the margin break words across lines, and the margin —
// being narrow — breaks most of them ("The First Accusa- tion— Impa-
// tience"). Joined blindly these become nonsense words, so a trailing
// hyphen followed by a lower-case continuation is closed up.
function dehyphenate(lineTexts, vocabulary = null) {
  let out = '';
  for (const raw of lineTexts) {
    const t = raw.trim();
    if (!t) continue;
    if (!out) { out = t; continue; }
    if (/[-‐‑­]$/.test(out) && /^[a-zà-ÿ]/.test(t)) {
      out = out.replace(/[-‐‑­]$/, '') + t;
      continue;
    }
    // In the margin the hyphen is often lost with the rest of the fine
    // detail, leaving "Accusa" and "tion—" on consecutive lines with nothing
    // to mark the break. Where a vocabulary is supplied — the body text of
    // this same volume, which is the right corpus for this edition's own
    // spelling — the two fragments are closed up only if doing so makes a
    // word the volume actually uses. "Accusa"+"tion" is joined; "the"+"Old"
    // is not, because "theOld" appears nowhere.
    if (vocabulary) {
      const a = /([A-Za-zà-ÿ]+)$/.exec(out);
      const b = /^([a-zà-ÿ]+)/.exec(t);
      if (a && b && !vocabulary.has(a[1].toLowerCase())
          && vocabulary.has((a[1] + b[1]).toLowerCase())) {
        out += t;
        continue;
      }
    }
    out += ` ${t}`;
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Marginal Scripture citations
//
// The edition prints its cross-references in the margin. Volumes I and II
// carry the same references, but from a proof-read transcription, where they
// are inline and reliable ("[Matt. 16:18]"). Here they are OCR of 6-point
// type and a meaningful share of them are damaged: "Mark I1:24", "Matt.
// 13°33", "zr Thess. §:21", "8372 he Gal. grax. f.".
//
// A wrong Scripture reference in a Bible study application is worse than a
// missing one — it sends the reader somewhere the edition never pointed —
// so a citation is kept only when it resolves completely: a book this
// abbreviation table knows, and a chapter that exists in that book. Anything
// that does not resolve is dropped from the text and written to the report,
// where it can be read against the page images. OCR damage at this size
// overwhelmingly produces unparseable rubbish rather than a plausible wrong
// verse, which is what makes this filter worth having; it is not proof
// against a single misread digit inside an otherwise valid reference, and
// the report says so.

const BOOK_ABBREVIATIONS = {
  gen: 'Genesis', ex: 'Exodus', exod: 'Exodus', lev: 'Leviticus', num: 'Numbers',
  deut: 'Deuteronomy', josh: 'Joshua', judg: 'Judges', jud: 'Judges', ruth: 'Ruth',
  ezra: 'Ezra', neh: 'Nehemiah', est: 'Esther', esth: 'Esther', job: 'Job',
  ps: 'Psalms', psa: 'Psalms', psalm: 'Psalms', psalms: 'Psalms',
  prov: 'Proverbs', ecc: 'Ecclesiastes', eccl: 'Ecclesiastes',
  cant: 'Song of Solomon', song: 'Song of Solomon',
  isa: 'Isaiah', jer: 'Jeremiah', lam: 'Lamentations', ezek: 'Ezekiel', dan: 'Daniel',
  hos: 'Hosea', joel: 'Joel', amos: 'Amos', obad: 'Obadiah', jonah: 'Jonah',
  mic: 'Micah', nah: 'Nahum', hab: 'Habakkuk', zeph: 'Zephaniah', hag: 'Haggai',
  zech: 'Zechariah', mal: 'Malachi',
  matt: 'Matthew', mat: 'Matthew', mark: 'Mark', luke: 'Luke', john: 'John',
  jno: 'John', acts: 'Acts', rom: 'Romans', gal: 'Galatians', eph: 'Ephesians',
  phil: 'Philippians', philip: 'Philippians', philem: 'Philemon', phm: 'Philemon',
  col: 'Colossians', tit: 'Titus', titus: 'Titus', heb: 'Hebrews',
  jas: 'James', james: 'James', jude: 'Jude', rev: 'Revelation',
};

const ORDINAL_BOOKS = {
  sam: ['1 Samuel', '2 Samuel'],
  kings: ['1 Kings', '2 Kings'],
  kin: ['1 Kings', '2 Kings'],
  chron: ['1 Chronicles', '2 Chronicles'],
  cor: ['1 Corinthians', '2 Corinthians'],
  thess: ['1 Thessalonians', '2 Thessalonians'],
  tim: ['1 Timothy', '2 Timothy'],
  pet: ['1 Peter', '2 Peter'],
  john: ['1 John', '2 John', '3 John'],
  jno: ['1 John', '2 John', '3 John'],
};

// Chapters per book, canonical 66-book order. Used only to reject a citation
// whose chapter cannot exist — the cheapest check that catches the bulk of
// the OCR damage without a verse-level concordance.
const CHAPTERS = {
  Genesis: 50, Exodus: 40, Leviticus: 27, Numbers: 36, Deuteronomy: 34,
  Joshua: 24, Judges: 21, Ruth: 4, '1 Samuel': 31, '2 Samuel': 24,
  '1 Kings': 22, '2 Kings': 25, '1 Chronicles': 29, '2 Chronicles': 36, Ezra: 10,
  Nehemiah: 13, Esther: 10, Job: 42, Psalms: 150, Proverbs: 31,
  Ecclesiastes: 12, 'Song of Solomon': 8, Isaiah: 66, Jeremiah: 52, Lamentations: 5,
  Ezekiel: 48, Daniel: 12, Hosea: 14, Joel: 3, Amos: 9,
  Obadiah: 1, Jonah: 4, Micah: 7, Nahum: 3, Habakkuk: 3,
  Zephaniah: 3, Haggai: 2, Zechariah: 14, Malachi: 4,
  Matthew: 28, Mark: 16, Luke: 24, John: 21, Acts: 28,
  Romans: 16, '1 Corinthians': 16, '2 Corinthians': 13, Galatians: 6, Ephesians: 6,
  Philippians: 4, Colossians: 4, '1 Thessalonians': 5, '2 Thessalonians': 3, '1 Timothy': 6,
  '2 Timothy': 4, Titus: 3, Philemon: 1, Hebrews: 13, James: 5,
  '1 Peter': 5, '2 Peter': 3, '1 John': 5, '2 John': 1, '3 John': 1,
  Jude: 1, Revelation: 22,
};

// Applied only inside the chapter and verse slots, where the grammar already
// says the characters must be digits. Tesseract confuses these pairs
// constantly at 6-point ("Mark I1:24" for 11:24, "Ps. 5O:2" for 50:2), and
// repairing them where a digit is the only legal reading is safe in a way
// that a general spell-fix over the text would not be.
const DIGIT_LOOKALIKES = { i: '1', l: '1', I: '1', o: '0', O: '0', s: '5', S: '5', b: '6', B: '8' };
const toDigits = (s) => s.replace(/[ilIoOsSbB]/g, (c) => DIGIT_LOOKALIKES[c]);

// "Matt." / "1 Cor." / "I Cor." — the book, if the note names one.
const BOOK_HEAD = /^(?:([123])\s*)?([A-Za-z]{2,10})\s*[.,;:]?\s*/;

function resolveBook(ordinal, word) {
  const key = word.toLowerCase();
  if (ordinal) {
    // An ordinal is only meaningful on a book that has one. "2 Matt." is
    // damage, not a reference.
    return ORDINAL_BOOKS[key]?.[+ordinal - 1] ?? null;
  }
  // Checked before the ordinal table on purpose: "john" appears in both, and
  // an unnumbered "John 8:11" is the Gospel, not an incomplete epistle.
  return BOOK_ABBREVIATIONS[key] ?? null;
}

// The margin prints chains and verse lists as well as single references:
// "Isa. 48:9, 10", "Rom. 3:24; 5:15 ff.", "Matt. 24:15, 24". Each is parsed
// whole and re-emitted in one canonical form, so a chain is not silently
// truncated to its first verse.
function resolveCitation(raw) {
  const cleaned = raw
    .replace(/[’'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[IVXivx]+\s+(?=[A-Za-z]{2,})/, (m) => {
      // "I Cor. 3:8" — a roman ordinal, not a stray glyph.
      const r = m.trim().toLowerCase();
      return r === 'i' ? '1 ' : r === 'ii' ? '2 ' : r === 'iii' ? '3 ' : m;
    })
    .replace(/[-–—]/g, ' ')
    .trim();
  const head = BOOK_HEAD.exec(cleaned);
  if (!head) return null;
  const book = resolveBook(head[1], head[2]);
  if (!book || !CHAPTERS[book]) return null;

  const rest = cleaned.slice(head[0].length).trim();
  if (!rest) return null;

  const parts = [];
  let chapter = null;
  for (const segRaw of rest.split(';')) {
    let seg = segRaw.trim();
    if (!seg) continue;
    // "ff."/"f." — and the ff-ligature, which Tesseract reads as a currency
    // sign. Trailing punctuation on it is noise ("1:28 ff,").
    let tail = '';
    seg = seg.replace(/\s*(f{1,2}|£|€|fi)\s*[.,]?\s*$/i, (_, f) => {
      tail = /^f$/i.test(f) ? ' f.' : ' ff.';
      return '';
    }).trim();
    const m = /^([\dilIoOsSbB]{1,3})\s*[:.]\s*(.+)$/.exec(seg);
    let verseList;
    if (m) {
      chapter = +toDigits(m[1]);
      verseList = m[2];
    } else if (chapter !== null) {
      verseList = seg;
    } else {
      return null;
    }
    if (!Number.isInteger(chapter) || chapter < 1 || chapter > CHAPTERS[book]) return null;
    const verses = [];
    for (const vRaw of verseList.split(',')) {
      const t = vRaw.trim();
      if (!t) continue;
      if (!/^[\dilIoOsSbB]{1,3}$/.test(t)) return null;
      const v = +toDigits(t);
      // 176 is the longest chapter in the Bible (Psalm 119); anything beyond
      // it cannot be a verse number in any book.
      if (!Number.isInteger(v) || v < 1 || v > 176) return null;
      verses.push(v);
    }
    if (!verses.length) return null;
    parts.push(`${chapter}:${verses.join(', ')}${tail}`);
  }
  return parts.length ? `${book} ${parts.join('; ')}` : null;
}

// The printed topic notes are short Title-Case English phrases ("The Types
// of the Old Testament", "Penance"). They are told from OCR wreckage by
// their words: a genuine note is spelt with words this volume's body text
// also uses, and never contains a digit — the numbers in the margin all
// belong to Scripture references.
function isTopicNote(text, vocabulary) {
  if (/\d/.test(text)) return false;
  const tokens = text.match(/[A-Za-zà-ÿ]{2,}/g) ?? [];
  if (!tokens.length) return false;
  const known = tokens.filter((t) => vocabulary.has(t.toLowerCase())).length;
  // Two thirds, not more: these are OCR of 6-point type, and a note like
  // "The Scriptures Inerrant" can carry one word the body text never uses.
  // A one-word note has no context to corroborate it, so it must be a
  // substantial word and one the volume actually uses.
  if (tokens.length === 1) return tokens[0].length >= 4 && known === 1;
  return known / tokens.length >= 0.6;
}

// ---------------------------------------------------------------------------
// Headings inside the body

function isDisplayPage(page, bodySize) {
  const lines = page.lines;
  if (lines.length < 2 || lines.length > 14) return false;
  const big = lines.filter((l) => l.size >= bodySize * 1.05);
  if (big.length < 2) return false;
  return big.some((l) => /^[^a-z]*$/.test(l.text) && l.text.split(/\s+/).length >= 2);
}

// This edition does not set its section headings any larger than its text:
// "THE FIRST ARTICLE" through "THE LAST ARTICLE" are body size, in capitals,
// centred in the column. Size was the wrong thing to look at — it found five
// headings in the volume and missed the other forty-one, welding a
// forty-one-part treatise into one 270-paragraph section. What marks a
// heading here is that it is short, capitalised, and centred: its left and
// right indents are about equal, which is never true of a line of prose,
// whether that line opens a paragraph (indented left, full right) or closes
// one (flush left, short right).
function isInlineHeading(l, lay) {
  const column = lay.right - lay.left;
  if (l.size < lay.size * 0.9) return false;
  if (l.x1 - l.x0 > 0.72 * column) return false;
  const letters = l.text.replace(/[^A-Za-z]/g, '');
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  if (upper / letters.length <= 0.85) return false;
  const centred = Math.abs((l.x0 - lay.left) - (lay.right - l.x1)) < 0.12 * column;
  return centred && l.x0 - lay.left > 0.04 * column;
}

const ROMAN_TOKEN = /^[IVXL]+\.?$/;

// Short words cannot be judged by presence in the vocabulary the way long
// ones can — "of", "in", "to" are shorter than the vocabulary records, and a
// speck like "Mi" may well have been misread somewhere in 13,000 lines of
// body text too. Frequency separates them cleanly: the real short words of
// English run to thousands of occurrences in this volume, OCR specks to one
// or two.
function cleanTitle(raw, shortWordCounts) {
  return raw
    .split(/\s+/)
    .filter((tok) => {
      if (!tok) return false;
      if (!/[A-Za-z0-9]/.test(tok)) return false;
      const word = tok.replace(/[^A-Za-zà-ÿ]/g, '');
      if (!word || word.length > 2) return true;
      if (ROMAN_TOKEN.test(tok)) return true;
      return (shortWordCounts.get(word.toLowerCase()) ?? 0) >= 20;
    })
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Assembly

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function buildDocument(pages, bodySize, vocabulary, shortWordCounts) {
  const out = [];
  const stats = {
    pages: 0, bodyLines: 0, marginNotes: 0, marginLines: 0, citationsKept: 0,
    citationsDropped: 0, sidenotes: 0, footnoteLines: 0, runningHeads: 0,
    droppedShort: 0, titleLines: 0, unclassified: 0, displayPages: 0,
    sidenotesDropped: 0,
  };
  const droppedCitations = [];
  const keptCitations = [];
  const keptSidenotes = [];
  const droppedSidenoteNotes = [];
  const shortDrops = [];
  const displayPages = [];

  // One open paragraph carries across page boundaries; a printed paragraph
  // routinely runs over the foot of one page onto the head of the next.
  let para = [];
  let titlePageText = '';
  let pendingSidenotes = [];
  let footnoteBuf = [];
  const flushParagraph = () => {
    if (!para.length) return;
    for (const s of pendingSidenotes) {
      out.push(`<p>[Sidenote: ${escape(s)}]</p>`);
      stats.sidenotes++;
    }
    pendingSidenotes = [];
    out.push(`<p>${escape(dehyphenate(para))}</p>`);
    para = [];
  };
  const flushFootnotes = () => {
    if (!footnoteBuf.length) return;
    flushParagraph();
    out.push('<h5>FOOTNOTES</h5>');
    for (const f of footnoteBuf) out.push(`<p>${escape(f)}</p>`);
    footnoteBuf = [];
  };

  for (const page of pages) {
    if (!page.lines.length) continue;
    stats.pages++;

    // A display page opens a work (or the back matter). It closes whatever
    // came before it, including that work's accumulated footnotes, so the
    // FOOTNOTES block always sits at the end of the work it belongs to —
    // the same placement Gutenberg used in Volumes I and II, and the
    // placement build.mjs's parser requires (a FOOTNOTES heading runs until
    // the next heading, so one emitted mid-work would swallow the rest).
    // The title page is set like a work's half-title and would otherwise be
    // read as one. It is emitted as ordinary paragraphs instead, for two
    // reasons: build.mjs excludes it with the rest of the front matter (as it
    // does in Volumes I and II), and the vol-3 provenance gate reads the
    // imprint and volume number off it.
    if (isDisplayPage(page, bodySize) && /CASTLE\s+PRESS|HOLMAN/i.test(page.lines.map((l) => l.text).join(' '))) {
      flushFootnotes();
      flushParagraph();
      for (const l of page.lines) out.push(`<p>${escape(l.text)}</p>`);
      stats.titleLines += page.lines.length;
      titlePageText = page.lines.map((l) => l.text).join(' ');
      continue;
    }

    if (isDisplayPage(page, bodySize)) {
      flushFootnotes();
      flushParagraph();
      // The half-title pages are decorated and heavily show-through, and
      // Tesseract reads specks off them as words: a stray "|" for a rule, an
      // "Mi" out of an ornament. This heading becomes the first section's
      // title in the reading pane, so the specks are dropped — but only ones
      // that cannot be words: punctuation on its own, and one- or two-letter
      // fragments the volume's own text never uses. Roman numerals are kept,
      // since the edition numbers the three Emser pieces "I.", "II.", "III.".
      const title = cleanTitle(
        page.lines
          .filter((l) => l.size >= bodySize * 0.6 && /[A-Za-z]/.test(l.text))
          .map((l) => l.text)
          .join(' '),
        shortWordCounts,
      );
      out.push(`<h3>${escape(title)}</h3>`);
      displayPages.push({ index: page.index, title, lines: page.lines.length });
      stats.displayPages++;
      const used = page.lines.filter((l) => l.size >= bodySize * 0.6 && /[A-Za-z]/.test(l.text));
      stats.titleLines += used.length;
      stats.unclassified += page.lines.length - used.length;
      continue;
    }

    const lay = layout(page, bodySize);
    if (!lay) {
      // A page with no recognisable text block: a plate, a blank leaf, or a
      // fly-title's stray marks. Counted, never silently swallowed.
      stats.droppedShort += page.lines.length;
      shortDrops.push({ index: page.index, text: page.lines.map((l) => l.text).join(' ').slice(0, 90) });
      continue;
    }

    const margin = page.lines.filter((l) => isMarginLine(l, lay));
    stats.marginLines += margin.length;
    let rest = page.lines.filter((l) => !isMarginLine(l, lay));
    const [head, afterHead] = takeRunningHead(rest, lay);
    if (head) stats.runningHeads++;
    rest = afterHead;
    const [bodyLines, footLines] = splitFootnotes(rest, lay);
    stats.bodyLines += bodyLines.length;
    stats.footnoteLines += footLines.length;

    const notes = groupMarginNotes(margin, lay, vocabulary);
    stats.marginNotes += notes.length;

    // Each marginal note is anchored to the body line it sits beside. A
    // citation is inserted at that line's end, which is where the printed
    // page puts it; a topic note is held back and emitted before the
    // paragraph it labels, which is the shape Volumes I and II use.
    const inserts = new Map();
    for (const note of notes) {
      if (!bodyLines.length) {
        // A note beside a page with no body block of its own — the foot of a
        // work, or a plate. There is nothing to anchor it to.
        if (note.kind === 'cite') {
          stats.citationsDropped++;
          droppedCitations.push({ page: page.index, text: note.text, why: 'no body line to anchor to' });
        } else {
          stats.sidenotesDropped++;
          droppedSidenoteNotes.push({ page: page.index, text: note.text, why: 'no body line to anchor to' });
        }
        continue;
      }
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < bodyLines.length; i++) {
        const d = Math.abs(bodyLines[i].y0 - note.y);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (note.kind === 'cite') {
        const resolved = resolveCitation(note.text);
        if (resolved) {
          stats.citationsKept++;
          keptCitations.push({ page: page.index, printed: note.text, resolved });
          inserts.set(best, `${inserts.get(best) ?? ''} [${resolved}]`);
        } else {
          stats.citationsDropped++;
          droppedCitations.push({ page: page.index, text: note.text, why: 'did not resolve to a book and chapter' });
        }
      } else if (!isTopicNote(note.text, vocabulary)) {
        // What is left in the margin after the citations is not all topic
        // notes: damaged references the grouper could not read a book off
        // ("zr Thess. §:21", "13°33"), and specks of scan noise ("i)",
        // "8372 he"). A topic note ends up on entries.heading, where it is
        // read as a label for the paragraph, so anything that cannot be
        // shown to be one is dropped rather than displayed as one.
        stats.sidenotesDropped++;
        droppedSidenoteNotes.push({ page: page.index, text: note.text, why: 'not readable as a topic note' });
      } else {
        // Several topic notes can fall against one paragraph; each is kept in
        // order and build.mjs attaches the last, logging the rest.
        (bodyLines[best].sidenotes ??= []).push(note.text);
        keptSidenotes.push({ page: page.index, text: note.text });
      }
    }

    for (let i = 0; i < bodyLines.length; i++) {
      const l = bodyLines[i];
      if (isInlineHeading(l, lay)) {
        flushParagraph();
        out.push(`<h5>${escape(l.text)}</h5>`);
        continue;
      }
      // A first line set in from the column edge opens a new paragraph.
      if (para.length && l.x0 > lay.left + 0.018 * lay.W) flushParagraph();
      if (l.sidenotes) pendingSidenotes.push(...l.sidenotes);
      para.push(l.text + (inserts.get(i) ?? ''));
    }
    if (footLines.length) footnoteBuf.push(dehyphenate(footLines.map((l) => l.text)));
  }
  flushFootnotes();
  flushParagraph();

  return { out, stats, titlePageText, droppedCitations, keptCitations, keptSidenotes, droppedSidenoteNotes, shortDrops, displayPages };
}

// ---------------------------------------------------------------------------
// Cross-scan control
//
// Three independent scans of this volume exist. Volumes I and II had one
// source apiece and no way to tell an OCR artefact from the printed text;
// here a word that two scans agree on and the third does not is almost
// certainly the third's error, and a *structural* disagreement — a different
// number of works, or a work opening in a different place — means the
// primary scan is damaged in a way that would corrupt the bundle.

function controlSummary(raw, bodySize) {
  const pages = parseHocr(raw);
  let display = 0;
  const words = [];
  for (const p of pages) {
    if (isDisplayPage(p, bodySize)) { display++; continue; }
    const lay = layout(p, bodySize);
    if (!lay) continue;
    for (const l of p.lines) {
      if (isMarginLine(l, lay)) continue;
      for (const w of l.words) {
        const t = w.text.replace(/[^A-Za-z]/g, '').toLowerCase();
        if (t.length > 3) words.push(t);
      }
    }
  }
  return { pages: pages.length, display, words: new Set(words), wordCount: words.length };
}

// ---------------------------------------------------------------------------

async function main() {
  const audit = process.argv.includes('--report');
  console.log('Normalising Luther Vol. III from hOCR…');

  const rawPrimary = await fs.readFile(path.join(RAW_DIR, SCANS.primary.file), 'utf8');
  const pages = parseHocr(rawPrimary);
  if (pages.length < 400) {
    throw new Error(
      `${SCANS.primary.file}: only ${pages.length} hOCR pages — this volume has ~479. ` +
      'Refusing to normalise a truncated scan.',
    );
  }
  const bodySize = median(
    pages.filter((p) => p.lines.length >= 25).map((p) => median(p.lines.map((l) => l.size))),
  );
  console.log(`  ${pages.length} pages, median body type size ${bodySize}`);

  // The volume's own body text, used to decide whether two margin fragments
  // are one hyphenated word. Built from the body column only — the margin is
  // exactly the material whose spelling is in doubt, so letting it vote on
  // its own repairs would be circular.
  const vocabulary = new Set();
  const shortWordCounts = new Map();
  for (const p of pages) {
    const lay = layout(p, bodySize);
    if (!lay) continue;
    for (const l of p.lines) {
      if (isMarginLine(l, lay)) continue;
      for (const w of l.words) {
        const t = w.text.replace(/[^A-Za-zà-ÿ]/g, '').toLowerCase();
        if (t.length > 2) vocabulary.add(t);
        else if (t) shortWordCounts.set(t, (shortWordCounts.get(t) ?? 0) + 1);
      }
    }
  }

  const { out, stats, titlePageText, droppedCitations, keptCitations, keptSidenotes, droppedSidenoteNotes, shortDrops, displayPages } =
    buildDocument(pages, bodySize, vocabulary, shortWordCounts);

  // NORMALISER CONSERVATION GATE. build.mjs's own conservation gate can only
  // account for what reaches it; lines this script drops — running heads,
  // stray marks on a plate — never appear in its input. So every OCR line is
  // accounted for here, at the point it is classified, and an unexplained
  // remainder stops the build rather than quietly shrinking the volume.
  const totalLines = pages.reduce((n, p) => n + p.lines.length, 0);
  const accounted =
    stats.bodyLines + stats.footnoteLines + stats.runningHeads +
    stats.marginLines + stats.droppedShort + stats.titleLines + stats.unclassified;
  if (accounted !== totalLines) {
    throw new Error(
      `Line conservation failed — ${totalLines} OCR lines in the scan, ${accounted} classified ` +
      `(body ${stats.bodyLines} + footnote ${stats.footnoteLines} + running head ${stats.runningHeads} ` +
      `+ margin ${stats.marginLines} + title ${stats.titleLines} + plate ${stats.droppedShort} ` +
      `+ unused ${stats.unclassified}). Lines are vanishing before build.mjs can see them.`,
    );
  }

  // PROVENANCE.
  //
  // The volume's own title page carries the edition, the volume number and
  // both imprints, and Tesseract reads all of it cleanly. What it does not
  // read is the copyright notice: the leaf is nearly blank with show-through
  // from the title page behind it, and the OCR of it is the single line
  // "A. J. Horman Company" — the year is simply absent. The notice does read
  // "Copyright, 1930, by A. J. Holman Company" on the page image, but a gate
  // cannot assert what the OCR does not contain.
  //
  // So the year is taken from the control scans, where it survives: the
  // Muhlenberg reprint of this same volume prints its own 1930 notice, and
  // the library call number stamped on the same leaf ("BR 330 .E5313 1930
  // v.3") repeats it. Both are independent of Internet Archive's catalogue
  // date field, which for this item wrongly reads 1915 and is never consulted.
  if (!/VOLUME\s+III/i.test(titlePageText)) {
    throw new Error('The primary scan\'s title page does not read "VOLUME III". Refusing to build.');
  }
  if (!/HOLMAN/i.test(titlePageText) || !/CASTLE\s+PRESS/i.test(titlePageText)) {
    throw new Error(
      'The primary scan\'s title page does not carry the A. J. Holman Company and The Castle ' +
      'Press imprint. This build is pinned to that printing; refusing to build.',
    );
  }
  const yearEvidence = [];
  for (const c of SCANS.controls) {
    const raw = await fs.readFile(path.join(RAW_DIR, c.file), 'utf8');
    for (const p of parseHocr(raw).slice(0, 16)) {
      for (const l of p.lines) {
        if (/\b1930\b/.test(l.text)) yearEvidence.push(`${c.id} p${p.index}: ${l.text}`);
      }
    }
  }
  if (!yearEvidence.length) {
    throw new Error(
      'No control scan shows a printed 1930 date in its front matter. The 1930 copyright is what ' +
      'puts this volume in the public domain (95-year term expiry, 1 January 2026); refusing to ' +
      'build a text whose printed date cannot be read anywhere.',
    );
  }

  const html = [
    '<html><head><title>Works of Martin Luther, Volume III</title></head><body>',
    '<!-- FOUNDATION-PROVENANCE',
    'edition: Works of Martin Luther, with Introductions and Notes',
    'volume: III',
    `imprint: ${SCANS.primary.imprint}, Philadelphia`,
    'printed-year: 1930',
    `primary-scan: ${SCANS.primary.id}`,
    `title-page-as-read: ${titlePageText}`,
    ...yearEvidence.map((e) => `year-evidence: ${e}`),
    ...SCANS.controls.map((c) => `control-scan: ${c.id}`),
    'ia-date-field: NOT USED — Internet Archive records 1915 for this item, which is the',
    '  six-volume set date (LCCN 15007839) and is wrong for this volume.',
    '-->',
    '*** START OF THIS NORMALISED TRANSCRIPTION ***',
    ...out,
    '*** END OF THIS NORMALISED TRANSCRIPTION ***',
    '</body></html>',
  ].join('\n');
  await fs.writeFile(OUT_PATH, `${html}\n`, 'utf8');

  console.log(
    `  ${stats.displayPages} display pages, ${stats.bodyLines} body lines, ` +
    `${stats.marginNotes} marginal notes ` +
    `(${stats.citationsKept} citations kept, ${stats.citationsDropped} dropped, ` +
    `${stats.sidenotes} sidenotes), ${stats.footnoteLines} footnote lines`,
  );
  console.log(`  wrote ${path.relative(process.cwd(), OUT_PATH)} (${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)}MB)`);

  // CROSS-SCAN CONTROL GATE.
  const primaryWords = new Set();
  for (const p of pages) {
    if (isDisplayPage(p, bodySize)) continue;
    const lay = layout(p, bodySize);
    if (!lay) continue;
    for (const l of p.lines) {
      if (isMarginLine(l, lay)) continue;
      for (const w of l.words) {
        const t = w.text.replace(/[^A-Za-z]/g, '').toLowerCase();
        if (t.length > 3) primaryWords.add(t);
      }
    }
  }
  const controls = [];
  for (const c of SCANS.controls) {
    const raw = await fs.readFile(path.join(RAW_DIR, c.file), 'utf8');
    const s = controlSummary(raw, bodySize);
    // How much of the control scan's vocabulary the primary also saw. Two
    // scans of the same setting of the same text should overlap heavily; a
    // collapse here means the primary scan is not the book we think it is,
    // or has been badly damaged.
    let shared = 0;
    for (const w of s.words) if (primaryWords.has(w)) shared++;
    const overlap = shared / s.words.size;
    controls.push({ ...c, ...s, overlap });
    console.log(
      `  control ${c.id}: ${s.pages} pages, ${s.display} display pages, ` +
      `vocabulary overlap with primary ${(overlap * 100).toFixed(1)}%`,
    );
    if (overlap < 0.8) {
      throw new Error(
        `Cross-scan control failed: only ${(overlap * 100).toFixed(1)}% of ${c.id}'s vocabulary ` +
        'appears in the primary scan. These are supposed to be two printings of the same volume; ' +
        'refusing to build a text whose identity the controls do not corroborate.',
      );
    }
  }

  if (audit) {
    const lines = [
      'Luther Vol. III — hOCR normalisation report',
      '',
      `Generated: ${new Date().toISOString()}`,
      `Primary scan: ${SCANS.primary.id} — ${SCANS.primary.label}`,
      '',
      `hOCR pages: ${pages.length} (${stats.pages} carrying text)`,
      `OCR lines total: ${totalLines}`,
      `  body: ${stats.bodyLines}`,
      `  footnote: ${stats.footnoteLines}`,
      `  running heads (dropped): ${stats.runningHeads}`,
      `  marginal notes: ${stats.marginNotes}`,
      `  display-page lines not used in a title: ${stats.unclassified}`,
      `  lines on pages with no text block (dropped): ${stats.droppedShort}`,
      '',
      `Marginal Scripture citations kept: ${stats.citationsKept}`,
      `Marginal Scripture citations dropped as unresolvable: ${stats.citationsDropped}`,
      `Marginal topic notes kept as [Sidenote: ...]: ${stats.sidenotes}`,
      `Marginal notes dropped as unreadable: ${stats.sidenotesDropped}`,
      '',
      '--- cross-scan control ---',
      'Two further scans of this volume (the Muhlenberg Press reprint of the same',
      'text) are read as a control on the primary. They are not imported: their',
      'pagination and line breaks differ, and only the Holman & Castle Press',
      'printing carries this volume\'s own imprint and copyright notice.',
      ...controls.map((c) =>
        `  ${c.id}: ${c.pages} pages, ${c.display} display pages, ` +
        `${c.words.size} distinct words, ${(c.overlap * 100).toFixed(1)}% also seen in the primary`),
      '',
      '--- display pages (work boundaries as the scan presents them) ---',
      ...displayPages.map((d) => `  hOCR page ${d.index}: ${d.title}`),
      '',
      '--- marginal Scripture citations kept, as printed -> as emitted ---',
      'Emitted with the canonical book name rather than the printed',
      'abbreviation. The printed form is itself OCR and is often damaged, so a',
      'resolved reference is the honest thing to carry; the printed form is',
      'kept here beside it so any resolution can be checked.',
      ...keptCitations.map((c) => `  p${c.page}: ${JSON.stringify(c.printed)} -> ${c.resolved}`),
      '',
      '--- marginal Scripture citations dropped (read these against the page images) ---',
      'Overwhelmingly half-references: a book name whose chapter and verse the',
      'OCR never captured, or a chapter and verse whose book name it never',
      'captured. Nothing here can be recovered from this scan.',
      ...droppedCitations.map((d) => `  p${d.page}: ${JSON.stringify(d.text)} — ${d.why}`),
      '',
      '--- marginal topic notes kept (these become entries.heading) ---',
      ...keptSidenotes.map((s) => `  p${s.page}: ${s.text}`),
      '',
      '--- marginal notes dropped as unreadable ---',
      ...droppedSidenoteNotes.map((d) => `  p${d.page}: ${JSON.stringify(d.text)} — ${d.why}`),
      '',
      '--- pages with no recognisable text block ---',
      ...shortDrops.map((d) => `  p${d.index}: ${JSON.stringify(d.text)}`),
    ];
    await fs.writeFile(REPORT_PATH, `${lines.join('\n')}\n`, 'utf8');
    console.log(`  wrote ${path.relative(process.cwd(), REPORT_PATH)}`);
  }
}

main().catch((err) => { console.error(`\n${err.message}\n`); process.exit(1); });
