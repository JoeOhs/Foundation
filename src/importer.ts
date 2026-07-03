import initSqlJs from 'sql.js';
import { CANONICAL_BOOKS, bookNameFromNumber, canonicalBookName } from './bibleMeta';
import type { ParsedBook, ParsedEntry, ParsedSource } from './types';

// ---------------------------------------------------------------------------
// Entry point: sniff the format, parse, and always return *something* —
// unparseable input degrades to a single freeform entry, never a failure.
// ---------------------------------------------------------------------------

export async function parseFile(fileName: string, bytes: Uint8Array): Promise<ParsedSource> {
  const baseName = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const ext = (fileName.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();

  if (isSqliteFile(bytes)) {
    return parseSqliteDb(bytes, baseName);
  }

  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/^﻿/, '');
  try {
    switch (ext) {
      case 'json':
        return parseJson(text, baseName);
      case 'csv':
      case 'tsv':
        return parseCsv(text, baseName, ext === 'tsv' ? '\t' : ',');
      case 'md':
      case 'markdown':
        return parseMarkdown(text, baseName);
      case 'xml':
        return parseXml(text, baseName);
      default:
        return parsePlainText(text, baseName);
    }
  } catch (e) {
    return fallbackSource(text, baseName, [`Parsing failed (${String(e)}); imported as a single freeform document.`]);
  }
}

function fallbackSource(text: string, title: string, warnings: string[]): ParsedSource {
  return {
    suggestedTitle: title,
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books: [{ name: title, entries: [{ chapter: null, verse: null, position_ref: null, text: text.trim() || '(empty file)' }] }],
    warnings,
  };
}

function freeformFromParagraphs(text: string, title: string, warnings: string[] = []): ParsedSource {
  const paragraphs = text
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return fallbackSource(text, title, warnings);
  return {
    suggestedTitle: title,
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books: [
      {
        name: title,
        entries: paragraphs.map((p, i) => ({
          chapter: null,
          verse: null,
          position_ref: `¶ ${i + 1}`,
          text: p,
        })),
      },
    ],
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

// Matches "Genesis 1:1 In the beginning..." style verse-per-line files.
const VERSE_LINE = /^((?:[1-3]\s+)?[A-Za-z][A-Za-z ]+?)\s+(\d+):(\d+)\s+(.+)$/;
// Matches chapter/section markers like "Chapter 5", "CHAPTER V", "Section 2".
const SECTION_LINE = /^\s*(chapter|section|part|book)\s+([IVXLC]+|\d+)\s*[.:—-]?\s*(.*)$/i;

export function parsePlainText(text: string, title: string): ParsedSource {
  const lines = text.split(/\r?\n/);

  // Pass 1: verse-referenced lines ("Book C:V text")
  const verseKeyed: { book: string; chapter: number; verse: number; text: string }[] = [];
  let verseLineCount = 0;
  let totalNonEmpty = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    totalNonEmpty++;
    const m = line.match(VERSE_LINE);
    if (m) {
      const book = canonicalBookName(m[1]) ?? m[1].trim();
      verseKeyed.push({ book, chapter: Number(m[2]), verse: Number(m[3]), text: m[4].trim() });
      verseLineCount++;
    }
  }
  // If most non-empty lines are verse-shaped, treat the file as verse-keyed.
  if (totalNonEmpty > 0 && verseLineCount / totalNonEmpty > 0.6) {
    const bookMap = new Map<string, ParsedEntry[]>();
    for (const v of verseKeyed) {
      if (!bookMap.has(v.book)) bookMap.set(v.book, []);
      bookMap.get(v.book)!.push({ chapter: v.chapter, verse: v.verse, position_ref: null, text: v.text });
    }
    const books: ParsedBook[] = [...bookMap.entries()]
      .sort((a, b) => canonicalIndex(a[0]) - canonicalIndex(b[0]))
      .map(([name, entries]) => ({ name, entries }));
    const skipped = totalNonEmpty - verseLineCount;
    return {
      suggestedTitle: title,
      suggestedType: 'bible',
      structure: 'verse-keyed',
      books,
      warnings: skipped > 0 ? [`${skipped} line(s) didn't match the verse pattern and were skipped.`] : [],
    };
  }

  // Pass 2: chapter/section markers -> sectioned freeform
  const sections: { ref: string; lines: string[] }[] = [];
  let current: { ref: string; lines: string[] } | null = null;
  let sawMarker = false;
  for (const line of lines) {
    const m = line.match(SECTION_LINE);
    if (m) {
      sawMarker = true;
      current = { ref: `${capitalize(m[1])} ${m[2]}${m[3] ? ` — ${m[3].trim()}` : ''}`, lines: [] };
      sections.push(current);
    } else if (line.trim()) {
      if (!current) {
        current = { ref: 'Preface', lines: [] };
        sections.push(current);
      }
      current.lines.push(line.trim());
    } else if (current) {
      current.lines.push(''); // keep paragraph breaks
    }
  }
  if (sawMarker && sections.length > 1) {
    return {
      suggestedTitle: title,
      suggestedType: 'extra-biblical',
      structure: 'freeform',
      books: [
        {
          name: title,
          entries: sections.map((s) => ({
            chapter: null,
            verse: null,
            position_ref: s.ref,
            text: s.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
          })).filter((e) => e.text),
        },
      ],
      warnings: [],
    };
  }

  // Pass 3: paragraphs
  return freeformFromParagraphs(text, title);
}

function canonicalIndex(name: string): number {
  const i = CANONICAL_BOOKS.indexOf(name);
  return i === -1 ? 1000 : i;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Markdown: headings become section anchors
// ---------------------------------------------------------------------------

export function parseMarkdown(text: string, title: string): ParsedSource {
  const lines = text.split(/\r?\n/);
  const sections: { ref: string; depth: number; lines: string[] }[] = [];
  let current: { ref: string; depth: number; lines: string[] } | null = null;
  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (m) {
      current = { ref: m[2], depth: m[1].length, lines: [] };
      sections.push(current);
    } else {
      if (!current) {
        current = { ref: 'Preface', depth: 1, lines: [] };
        sections.push(current);
      }
      current.lines.push(line);
    }
  }
  const entries: ParsedEntry[] = sections
    .map((s) => ({
      chapter: null,
      verse: null,
      position_ref: s.ref,
      text: s.lines.join('\n').trim(),
    }))
    .filter((e) => e.text || e.position_ref !== 'Preface');
  if (entries.length === 0) return fallbackSource(text, title, []);
  return {
    suggestedTitle: sections[0]?.depth === 1 && sections.length > 1 ? sections[0].ref : title,
    suggestedType: 'extra-biblical',
    structure: 'freeform',
    books: [{ name: title, entries }],
    warnings: [],
  };
}

// ---------------------------------------------------------------------------
// JSON: several common shapes, then fallback
// ---------------------------------------------------------------------------

export function parseJson(text: string, title: string): ParsedSource {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fallbackSource(text, title, ['File has a .json extension but is not valid JSON.']);
  }

  // Shape A: [{abbrev|name, chapters: [[...verses]]}]  (bible-per-book)
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null && 'chapters' in (data[0] as object)) {
    const arr = data as { abbrev?: string; name?: string; chapters: string[][] }[];
    const books: ParsedBook[] = arr.map((b, i) => ({
      name:
        (b.name && (canonicalBookName(b.name) ?? b.name)) ||
        (arr.length === 66 ? CANONICAL_BOOKS[i] : b.abbrev ?? `Book ${i + 1}`),
      entries: (b.chapters ?? []).flatMap((verses, ci) =>
        verses.map((t, vi) => ({ chapter: ci + 1, verse: vi + 1, position_ref: null, text: String(t) })),
      ),
    }));
    return { suggestedTitle: title, suggestedType: 'bible', structure: 'verse-keyed', books, warnings: [] };
  }

  // Shape B: flat [{book, chapter, verse, text}]
  if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && data[0] !== null) {
    const rows = data as Record<string, unknown>[];
    const keys = Object.keys(rows[0]).map((k) => k.toLowerCase());
    const findKey = (names: string[]) => Object.keys(rows[0]).find((k) => names.includes(k.toLowerCase()));
    const bookK = findKey(['book', 'book_name', 'bookname']);
    const chK = findKey(['chapter', 'ch']);
    const vK = findKey(['verse', 'v']);
    const tK = findKey(['text', 'content', 'scripture', 'verse_text']);
    if (tK && (bookK || chK)) {
      return rowsToSource(
        rows.map((r) => ({
          book: bookK ? String(r[bookK]) : title,
          chapter: chK ? Number(r[chK]) || null : null,
          verse: vK ? Number(r[vK]) || null : null,
          text: String(r[tK] ?? ''),
        })),
        title,
      );
    }
    void keys;
  }

  // Shape C: {books: [...]} wrapper
  if (data && typeof data === 'object' && Array.isArray((data as { books?: unknown }).books)) {
    return parseJson(JSON.stringify((data as { books: unknown }).books), title);
  }

  return fallbackSource(JSON.stringify(data, null, 2), title, [
    'Unrecognized JSON shape; imported the raw content as one freeform document.',
  ]);
}

// ---------------------------------------------------------------------------
// CSV / TSV
// ---------------------------------------------------------------------------

function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string, title: string, delim: string): ParsedSource {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return fallbackSource(text, title, []);
  const header = splitCsvLine(lines[0], delim).map((h) => h.trim().toLowerCase());
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const bookC = col(['book', 'book_name', 'bookname']);
  const chC = col(['chapter', 'ch']);
  const vC = col(['verse', 'v']);
  const tC = col(['text', 'content', 'scripture', 'verse_text']);

  if (tC !== -1) {
    const rows = lines.slice(1).map((l) => splitCsvLine(l, delim));
    return rowsToSource(
      rows.map((r) => ({
        book: bookC !== -1 ? r[bookC]?.trim() || title : title,
        chapter: chC !== -1 ? Number(r[chC]) || null : null,
        verse: vC !== -1 ? Number(r[vC]) || null : null,
        text: r[tC] ?? '',
      })),
      title,
    );
  }

  // Headerless: guess [book, chapter, verse, text] if 2nd/3rd cols are numeric
  const first = splitCsvLine(lines[0], delim);
  if (first.length >= 4 && !isNaN(Number(first[1])) && !isNaN(Number(first[2]))) {
    const rows = lines.map((l) => splitCsvLine(l, delim));
    return rowsToSource(
      rows.map((r) => ({
        book: /^\d+$/.test(r[0].trim()) ? bookNameFromNumber(Number(r[0])) ?? r[0] : r[0].trim(),
        chapter: Number(r[1]) || null,
        verse: Number(r[2]) || null,
        text: r.slice(3).join(delim),
      })),
      title,
    );
  }

  // Give up on structure: one entry per row
  return {
    suggestedTitle: title,
    suggestedType: 'reference',
    structure: 'freeform',
    books: [
      {
        name: title,
        entries: lines.map((l, i) => ({
          chapter: null,
          verse: null,
          position_ref: `Row ${i + 1}`,
          text: splitCsvLine(l, delim).join(' — '),
        })),
      },
    ],
    warnings: ['No recognizable columns; imported one entry per row.'],
  };
}

function rowsToSource(
  rows: { book: string; chapter: number | null; verse: number | null; text: string }[],
  title: string,
): ParsedSource {
  const bookMap = new Map<string, ParsedEntry[]>();
  let skipped = 0;
  for (const r of rows) {
    const text = r.text.trim();
    if (!text) { skipped++; continue; }
    const name = canonicalBookName(r.book) ?? r.book;
    if (!bookMap.has(name)) bookMap.set(name, []);
    bookMap.get(name)!.push({ chapter: r.chapter, verse: r.verse, position_ref: null, text });
  }
  const books: ParsedBook[] = [...bookMap.entries()]
    .sort((a, b) => canonicalIndex(a[0]) - canonicalIndex(b[0]))
    .map(([name, entries]) => ({ name, entries }));
  const verseKeyed = rows.some((r) => r.verse !== null);
  return {
    suggestedTitle: title,
    suggestedType: verseKeyed ? 'bible' : 'extra-biblical',
    structure: verseKeyed ? 'verse-keyed' : 'freeform',
    books,
    warnings: skipped > 0 ? [`${skipped} empty row(s) skipped.`] : [],
  };
}

// ---------------------------------------------------------------------------
// XML: look for verse-ish elements, else strip tags and re-parse as text
// ---------------------------------------------------------------------------

export function parseXml(text: string, title: string): ParsedSource {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) {
    return parsePlainText(text.replace(/<[^>]+>/g, ' '), title);
  }
  const verseEls = doc.querySelectorAll('verse, v, VERS');
  if (verseEls.length > 0) {
    const rows: { book: string; chapter: number | null; verse: number | null; text: string }[] = [];
    verseEls.forEach((el) => {
      // OSIS-style osisID="Gen.1.1", or bnumber/cnumber/vnumber attrs (Zefania)
      const osis = el.getAttribute('osisID');
      let book = '';
      let chapter: number | null = null;
      let verse: number | null = null;
      if (osis) {
        const parts = osis.split('.');
        book = canonicalBookName(parts[0]) ?? parts[0];
        chapter = Number(parts[1]) || null;
        verse = Number(parts[2]) || null;
      } else {
        verse = Number(el.getAttribute('vnumber') ?? el.getAttribute('number')) || null;
        const chEl = el.closest('chapter, CHAPTER, c');
        chapter = chEl ? Number(chEl.getAttribute('cnumber') ?? chEl.getAttribute('number')) || null : null;
        const bkEl = el.closest('book, BIBLEBOOK, b');
        const bname = bkEl?.getAttribute('bname') ?? bkEl?.getAttribute('name');
        const bnum = bkEl?.getAttribute('bnumber');
        book = bname ? canonicalBookName(bname) ?? bname : bnum ? bookNameFromNumber(Number(bnum)) ?? `Book ${bnum}` : title;
      }
      rows.push({ book: book || title, chapter, verse, text: el.textContent?.trim() ?? '' });
    });
    return rowsToSource(rows, title);
  }
  return parsePlainText(doc.documentElement?.textContent ?? text, title);
}

// ---------------------------------------------------------------------------
// Legacy SQLite-based files (personal data migration): open with sql.js,
// look for known table shapes, extract plain text (stripping RTF markup).
// ---------------------------------------------------------------------------

export function isSqliteFile(bytes: Uint8Array): boolean {
  const magic = 'SQLite format 3';
  if (bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic.charCodeAt(i)) return false;
  }
  return true;
}

// Strips RTF control words/groups down to plain text. Best-effort.
export function stripRtf(input: string): string {
  if (!input.includes('\\')) return input.trim();
  return input
    .replace(/\\par[d]?\b/g, '\n')
    .replace(/\\line\b/g, '\n')
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\u(-?\d+)\??/g, (_, n: string) => String.fromCharCode(((Number(n) % 65536) + 65536) % 65536))
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, '')
    .replace(/[{}]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function parseSqliteDb(bytes: Uint8Array, title: string): Promise<ParsedSource> {
  const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
  const src = new SQL.Database(bytes);
  try {
    const tables = src
      .exec(`SELECT name FROM sqlite_master WHERE type='table'`)[0]
      ?.values.map((v) => String(v[0])) ?? [];

    const columnsOf = (table: string): string[] => {
      const res = src.exec(`PRAGMA table_info("${table.replace(/"/g, '""')}")`);
      return res[0]?.values.map((v) => String(v[1]).toLowerCase()) ?? [];
    };

    // Verse-keyed shape: numeric book/chapter/verse + a text column
    for (const table of tables) {
      const cols = columnsOf(table);
      const bookCol = cols.find((c) => ['book', 'bk'].includes(c));
      const chCol = cols.find((c) => ['chapter', 'ch'].includes(c));
      const vsCol = cols.find((c) => ['verse', 'vs'].includes(c));
      const txtCol = cols.find((c) => ['scripture', 'text', 'content', 'verse_text', 'data'].includes(c));
      if (bookCol && chCol && vsCol && txtCol) {
        const q = src.exec(
          `SELECT "${bookCol}", "${chCol}", "${vsCol}", "${txtCol}" FROM "${table}" ORDER BY 1, 2, 3`,
        );
        const rows = (q[0]?.values ?? []).map((r) => ({
          book:
            typeof r[0] === 'number' || /^\d+$/.test(String(r[0]))
              ? bookNameFromNumber(Number(r[0])) ?? `Book ${r[0]}`
              : canonicalBookName(String(r[0])) ?? String(r[0]),
          chapter: Number(r[1]) || null,
          verse: Number(r[2]) || null,
          text: stripRtf(String(r[3] ?? '')),
        }));
        if (rows.length > 0) {
          const parsed = rowsToSource(rows, title);
          parsed.warnings.push(`Extracted ${rows.length} entries from table "${table}" of a legacy database file.`);
          return parsed;
        }
      }
    }

    // Topic/dictionary shape: a subject/topic column + content column
    for (const table of tables) {
      const cols = columnsOf(table);
      const subjCol = cols.find((c) => ['subject', 'topic', 'word', 'title', 'name'].includes(c));
      const txtCol = cols.find((c) => ['definition', 'data', 'content', 'text', 'entry'].includes(c));
      if (subjCol && txtCol) {
        const q = src.exec(`SELECT "${subjCol}", "${txtCol}" FROM "${table}"`);
        const entries: ParsedEntry[] = (q[0]?.values ?? [])
          .map((r) => ({
            chapter: null,
            verse: null,
            position_ref: String(r[0] ?? ''),
            text: stripRtf(String(r[1] ?? '')),
          }))
          .filter((e) => e.text);
        if (entries.length > 0) {
          return {
            suggestedTitle: title,
            suggestedType: 'reference',
            structure: 'freeform',
            books: [{ name: title, entries }],
            warnings: [`Extracted ${entries.length} entries from table "${table}" of a legacy database file.`],
          };
        }
      }
    }

    return fallbackSource(
      `Tables found: ${tables.join(', ') || '(none)'}`,
      title,
      ['Could not find a recognizable text table in this database file.'],
    );
  } finally {
    src.close();
  }
}
