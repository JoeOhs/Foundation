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
// Plus bare "v. 22", meaning a verse of the book the note itself is in.

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
const VERSE_CONT_RE = /^,\s*(\d{1,3})/;

const APPENDIX_RE = /\bAp\.?\s*(\d{1,3})/g;
// A subsection token: roman numeral, small number, or a single letter.
const SECTION_TOKEN_RE = /^\s*\.\s*([IVXLC]+|[ivxlc]+|\d{1,2}|[A-Za-z])(?=\s*[.,;)\s]|$)/;
const MAX_SECTION_TOKENS = 5;

// "v. 22" — a verse of the book this note belongs to.
const LOCAL_VERSE_RE = /\bv{1,2}\.\s*(\d{1,3})/g;

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

function scanScripture(text: string, out: Match[]): void {
  SCRIPTURE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SCRIPTURE_RE.exec(text)) !== null) {
    const book = resolveBook(m[1], m[2]);
    if (!book) {
      // A near-miss must not eat the text it spanned. "See 1 Cor. 16. 9"
      // first matches "See 1" (book "See", chapter 1), which resolves to
      // nothing — but it has already consumed the "1" that belongs to
      // "1 Cor.". Resume one character in so the real reference is still
      // found.
      SCRIPTURE_RE.lastIndex = m.index + 1;
      continue;
    }
    const chapter = Number(m[3]);
    const verse = m[4] === undefined ? null : Number(m[4]);
    out.push({ start: m.index, end: m.index + m[0].length, ref: { kind: 'scripture', book, chapter, verse } });

    // Continuations chain off the end of the reference just matched.
    let pos = m.index + m[0].length;
    let curChapter = chapter;
    for (;;) {
      const rest = text.slice(pos);
      const ch = CHAPTER_CONT_RE.exec(rest);
      if (ch) {
        curChapter = Number(ch[1]);
        out.push({
          start: pos, end: pos + ch[0].length,
          ref: { kind: 'scripture', book, chapter: curChapter, verse: Number(ch[2]) },
        });
        pos += ch[0].length;
        continue;
      }
      const v = VERSE_CONT_RE.exec(rest);
      if (v) {
        out.push({
          start: pos, end: pos + v[0].length,
          ref: { kind: 'scripture', book, chapter: curChapter, verse: Number(v[1]) },
        });
        pos += v[0].length;
        continue;
      }
      break;
    }
    SCRIPTURE_RE.lastIndex = pos;
  }
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
