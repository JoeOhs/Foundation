// Finds E. W. Bullinger's cross-references inside a Companion Bible note and
// resolves them to something navigable. Pure text analysis — it never alters
// the note, only reports spans within it (see parseBullingerRefs' contract),
// so rendering can partition `entries.text` exactly the way StrongsWords
// partitions a verse.
//
// Two kinds of reference appear in the notes:
//
//   Scripture   "Eph. 3. 1"   book, chapter, verse — separated by periods,
//                             not the modern colon. Chains continue with
//                             "; 4. 1" (new chapter, same book) and
//                             ", 25" (another verse, same chapter), so
//                             "Acts 12. 12, 25; 15. 37, 39" is four refs.
//   Appendix    "Ap. 98. XII" appendix number, then a subsection path in
//                             mixed roman/arabic/letter notation.
//
// Plus bare "v. 22", meaning a verse of the book the note itself is in, and
// bare "Cp. 38. 7" after a cue word, a chapter and verse of that same book.

import { canonicalBookName } from './bibleMeta';

export type BullingerRef =
  | { kind: 'scripture'; book: string; chapter: number; verse: number | null }
  | { kind: 'appendix'; number: number; section: string | null };

// One slice of the original text. Concatenating every `text` in order
// reproduces the input exactly — that invariant is what lets the renderer
// show references without ever rewriting the stored note.
export interface RefSegment {
  text: string;
  ref: BullingerRef | null;
}

// Bullinger's own abbreviations. Spelled out rather than derived, because
// two of his forms collide with a naive prefix match: "Phil." is
// Philippians (Philemon is "Philem."), and "Jud." is Judges (Jude is
// "Jude"). Ordinals appear as both "1 Cor." and "I Cor.".
const BOOK_ABBREVIATIONS: Record<string, string> = {
  gen: 'Genesis', ex: 'Exodus', exod: 'Exodus', lev: 'Leviticus', num: 'Numbers',
  deut: 'Deuteronomy', josh: 'Joshua', judg: 'Judges', jud: 'Judges', ruth: 'Ruth',
  ezra: 'Ezra', neh: 'Nehemiah', est: 'Esther', esth: 'Esther', job: 'Job',
  ps: 'Psalms', pss: 'Psalms', psa: 'Psalms', psalm: 'Psalms', psalms: 'Psalms',
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

// Books that only ever appear with an ordinal.
const ORDINAL_BOOKS: Record<string, string[]> = {
  sam: ['1 Samuel', '2 Samuel'],
  kings: ['1 Kings', '2 Kings'],
  kin: ['1 Kings', '2 Kings'],
  chron: ['1 Chronicles', '2 Chronicles'],
  chr: ['1 Chronicles', '2 Chronicles'],
  cor: ['1 Corinthians', '2 Corinthians'],
  thess: ['1 Thessalonians', '2 Thessalonians'],
  tim: ['1 Timothy', '2 Timothy'],
  pet: ['1 Peter', '2 Peter'],
  john: ['1 John', '2 John', '3 John'],
};

const ORDINALS: Record<string, number> = { '1': 1, '2': 2, '3': 3, i: 1, ii: 2, iii: 3 };

function resolveBook(ordinal: string | undefined, name: string): string | null {
  const key = name.toLowerCase().replace(/\./g, '');
  if (ordinal) {
    const n = ORDINALS[ordinal.toLowerCase()];
    const family = ORDINAL_BOOKS[key];
    if (n && family) return family[n - 1] ?? null;
    // "1 John" style: an ordinal on a book that also exists without one.
    if (n) return canonicalBookName(`${n} ${name}`);
    return null;
  }
  const direct = BOOK_ABBREVIATIONS[key];
  if (direct) return direct;
  if (ORDINAL_BOOKS[key]) return null; // needs an ordinal to be unambiguous
  return canonicalBookName(name);
}

// Long enough for every canonical book's full name ("Thessalonians" is 13
// letters) — Smith's dictionary writes books out in full, where Bullinger
// abbreviates.
const BOOK_WORD = '[A-Z][A-Za-z]{1,14}';
const ORDINAL = '(?:[123]|I{1,3})';
// "Eph. 3. 1" / "1 Cor. 3. 9" / "Acts 2. 29" — Bullinger's chapter/verse
// separator is a period and the book's own period is optional. Smith's
// dictionary uses the modern colon ("Numbers 26:59"); both are accepted.
const SCRIPTURE_RE = new RegExp(
  `\\b(?:(${ORDINAL})\\s+)?(${BOOK_WORD})\\.?\\s+(\\d{1,3})(?:[.:]\\s*(\\d{1,3}))?`,
  'g',
);
// "; 4. 1" (or "; 33:39") continues into a new chapter of the same book;
// ", 25" adds another verse of the same chapter.
const CHAPTER_CONT_RE = /^;\s*(\d{1,3})[.:]\s*(\d{1,3})/;
// Never a thousands separator: "601,730" is a figure, not verse 730.
const VERSE_CONT_RE = /^,(?!\d{3}(?!\d))\s*(\d{1,3})(?!\d)/;
// "Ezra 29,818" / "Neh. 31,089": a count written after a book named as a
// noun ("Named in Ezra 29,818"), not chapter 29.
const THOUSANDS_AHEAD_RE = /^,\d{3}(?!\d)/;

const APPENDIX_RE = /\bAp\.?\s*(\d{1,3})/g;
// A subsection token: roman numeral, small number, or a single letter.
const SECTION_TOKEN_RE = /^\s*\.\s*([IVXLC]+|[ivxlc]+|\d{1,2}|[A-Za-z])(?=\s*[.,;)\s]|$)/;
const MAX_SECTION_TOKENS = 5;
const ORDINAL_THEN_BOOK_RE = new RegExp(`^[123]\\s+${BOOK_WORD}\\.?\\s+\\d`);
// Does `text` continue, at `pos`, with a book name and a chapter? Then a 1-3
// ending just before `pos` is that book's ordinal, not part of the reference
// before it: "So 1 Cor. 10. 7", "Deut. 32. 9, 1 Chron. 16. 18".
const BOOK_AHEAD_RE = new RegExp(`^\\s+${BOOK_WORD}\\.?\\s+\\d`);
function isOrdinalOfNextBook(n: string, text: string, pos: number): boolean {
  return /^[123]$/.test(n) && BOOK_AHEAD_RE.test(text.slice(pos));
}

// "v. 22" — a verse of the book this note belongs to.
const LOCAL_VERSE_RE = /\bv{1,2}\.\s*(\d{1,3})/g;
// "Cp. 38. 7" — a chapter and verse of the note's own book, with no book
// name. Only taken after a cue word, so bare number pairs elsewhere (dates,
// "p. 666", appendix sections) are never read as references.
const LOCAL_CHAPTER_RE = /(?:\b(?:Cp|cp|See|see)\.?|\bNot|\bas in|\bnotes? on)\s+(\d{1,3})\.\s*(\d{1,3})/g;

interface Match {
  start: number;
  end: number;
  ref: BullingerRef;
}

function scanAppendixes(text: string, out: Match[]): void {
  APPENDIX_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = APPENDIX_RE.exec(text)) !== null) {
    let end = m.index + m[0].length;
    const sections: string[] = [];
    // Walk the subsection path, stopping at the first token that reads like
    // ordinary prose rather than a section label.
    while (sections.length < MAX_SECTION_TOKENS) {
      const rest = text.slice(end);
      const s = SECTION_TOKEN_RE.exec(rest);
      if (!s) break;
      // "Ap. 41. 1 Sam. 4. 4": that "1" opens the next reference.
      if (ORDINAL_THEN_BOOK_RE.test(rest.slice(s[0].length - s[1].length))) break;
      sections.push(s[1]);
      end += s[0].length;
    }
    out.push({
      start: m.index,
      end,
      ref: { kind: 'appendix', number: Number(m[1]), section: sections[0] ?? null },
    });
  }
}

// Continuations chain off the end of a reference: "; 4. 1" moves to a new
// chapter of the same book, ", 25" adds a verse — or, after a chapter-only
// reference ("Pss. 56, 57"), another chapter. Returns where the chain ends.
function chainContinuations(
  text: string, pos: number, book: string, chapter: number, verse: number | null, out: Match[],
): number {
  let curChapter = chapter;
  let chapterList = verse === null;
  for (;;) {
    const rest = text.slice(pos);
    const ch = CHAPTER_CONT_RE.exec(rest);
    if (ch) {
      curChapter = Number(ch[1]);
      chapterList = false;
      out.push({
        start: pos, end: pos + ch[0].length,
        ref: { kind: 'scripture', book, chapter: curChapter, verse: Number(ch[2]) },
      });
      pos += ch[0].length;
      continue;
    }
    const v = VERSE_CONT_RE.exec(rest);
    if (v && !isOrdinalOfNextBook(v[1], text, pos + v[0].length)) {
      out.push({
        start: pos, end: pos + v[0].length,
        ref: chapterList
          ? { kind: 'scripture', book, chapter: Number(v[1]), verse: null }
          : { kind: 'scripture', book, chapter: curChapter, verse: Number(v[1]) },
      });
      pos += v[0].length;
      continue;
    }
    return pos;
  }
}

const SINGLE_CHAPTER_BOOKS = new Set(['Obadiah', 'Philemon', '2 John', '3 John', 'Jude']);

function scanScripture(text: string, out: Match[]): void {
  SCRIPTURE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCRIPTURE_RE.exec(text)) !== null) {
    const book = resolveBook(m[1], m[2]);
    const figureAhead = THOUSANDS_AHEAD_RE.test(text.slice(m.index + m[0].length));
    if (book && figureAhead && m[4] !== undefined) {
      // "Ezra 2: 42,360" — chapter 2 gives the figure 42,360: link the
      // chapter only, and leave the figure as text.
      const chEnd = m.index + m[0].indexOf(m[3], (m[1]?.length ?? 0) + m[2].length) + m[3].length;
      out.push({ start: m.index, end: chEnd, ref: { kind: 'scripture', book, chapter: Number(m[3]), verse: null } });
      SCRIPTURE_RE.lastIndex = m.index + m[0].length;
      continue;
    }
    if (!book || figureAhead || isOrdinalOfNextBook(m[4] ?? m[3], text, m.index + m[0].length)) {
      // A near-miss must not eat the text it spanned. "See 1 Cor. 16. 9"
      // first matches "See 1" (book "See", chapter 1), which resolves to
      // nothing — but it has already consumed the "1" that belongs to
      // "1 Cor.". Resume one character in so the real reference is still
      // found.
      SCRIPTURE_RE.lastIndex = m.index + 1;
      continue;
    }
    // "Jude 23": a one-chapter book is cited by verse alone.
    const oneChapter = m[4] === undefined && SINGLE_CHAPTER_BOOKS.has(book);
    const chapter = oneChapter ? 1 : Number(m[3]);
    const verse = oneChapter ? Number(m[3]) : m[4] === undefined ? null : Number(m[4]);
    out.push({ start: m.index, end: m.index + m[0].length, ref: { kind: 'scripture', book, chapter, verse } });

    SCRIPTURE_RE.lastIndex = chainContinuations(text, m.index + m[0].length, book, chapter, verse, out);
  }
}

// "Deuteronomy supplied Solomon with petitions for his prayer. Cp. 30. 1-3":
// a book named in full shortly before a bare reference, with no reference in
// between, is the book meant. Only names that are never a person ("Job",
// "Ruth") or an ordinary word ("the Exodus", "Numbers", "Judges"), and
// "Kings"/"Chronicles" are left out because they need an ordinal.
const PROSE_BOOK_RE = /\b(Genesis|Leviticus|Deuteronomy|Psalms|Proverbs|Ecclesiastes|Lamentations)\b(?!\.?\s*\d)/g;
const PROSE_BOOK_WINDOW = 150;
function bookNamedInProse(text: string, cueAt: number, out: Match[]): string | null {
  const from = Math.max(0, cueAt - PROSE_BOOK_WINDOW);
  let last: RegExpExecArray | null = null;
  PROSE_BOOK_RE.lastIndex = from;
  for (let m; (m = PROSE_BOOK_RE.exec(text)) !== null && m.index < cueAt;) last = m;
  if (!last) return null;
  const at = last.index;
  if (out.some((x) => x.ref.kind === 'scripture' && x.start > at && x.start < cueAt)) return null;
  return canonicalBookName(last[1]);
}

function scanLocalVerses(text: string, out: Match[], context: { book: string; chapter: number }): void {
  LOCAL_VERSE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LOCAL_VERSE_RE.exec(text)) !== null) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      ref: { kind: 'scripture', book: context.book, chapter: context.chapter, verse: Number(m[1]) },
    });
  }
  LOCAL_CHAPTER_RE.lastIndex = 0;
  while ((m = LOCAL_CHAPTER_RE.exec(text)) !== null) {
    const start = m.index + m[0].length - m[0].replace(/^\D+/, '').length; // link the numbers, not the cue
    const chapter = Number(m[1]);
    // "(Jer. 25. 1, cp. 32. 1)", "Ex. 30. 12 (cp. 38. 25)": a cue
    // straight after another book's reference continues that book, not the
    // note's own. Not across "and": "2 Chron. 5. 9, and see 9. 21" in a
    // 1 Kings note means 1 Kings 9. 21. Across a full stop only inside a
    // bracket that book's reference opened: "(Dan. 9. 1. Cp. 6. 1)" is
    // Daniel 6. 1, but "Ex. 17. 16. Cp. 3. 1" in Esther is Esther 3. 1.
    const cueAt = m.index;
    const open = text.lastIndexOf('(', cueAt);
    const prev = out.find((x) => x.ref.kind === 'scripture' && x.end <= cueAt
      && (/^[,;]?\s*\(?$/.test(text.slice(x.end, cueAt))
        || (/^\.\s*$/.test(text.slice(x.end, cueAt)) && open >= 0 && open < x.start
          && !text.slice(open, cueAt).includes(')'))));
    const book = prev && prev.ref.kind === 'scripture' ? prev.ref.book : (bookNamedInProse(text, cueAt, out) ?? context.book);
    out.push({
      start,
      end: m.index + m[0].length,
      ref: { kind: 'scripture', book, chapter, verse: Number(m[2]) },
    });
    LOCAL_CHAPTER_RE.lastIndex = chainContinuations(text, m.index + m[0].length, book, chapter, Number(m[2]), out);
  }
}

// Splits `text` into consecutive segments, each either plain text or a
// resolved reference. Overlapping candidates are resolved in favour of the
// one that starts earliest (and, on a tie, the longer) — which is what keeps
// the "v. 2" inside "Ap. 104. v. 2" from being torn out as its own verse.
//
// INVARIANT: segments.map(s => s.text).join('') === text
export function parseBullingerRefs(
  text: string,
  context?: { book: string; chapter: number } | null,
): RefSegment[] {
  const matches: Match[] = [];
  scanAppendixes(text, matches);
  scanScripture(text, matches);
  if (context) scanLocalVerses(text, matches, context);

  matches.sort((a, b) => a.start - b.start || b.end - a.end);

  const segments: RefSegment[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue; // overlaps something already taken
    if (match.start > cursor) segments.push({ text: text.slice(cursor, match.start), ref: null });
    segments.push({ text: text.slice(match.start, match.end), ref: match.ref });
    cursor = match.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), ref: null });
  return segments;
}
