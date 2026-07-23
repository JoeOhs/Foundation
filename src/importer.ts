import initSqlJs from 'sql.js';
import { unzipSync } from 'fflate';
import { CANONICAL_BOOKS, bookNameFromNumber, canonicalBookName } from './bibleMeta';
import type { ParsedBook, ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

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
  if (ext === 'epub' || isEpubFile(bytes)) {
    return parseEpub(bytes, baseName);
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

// ---------------------------------------------------------------------------
// EPUB: unzip, follow the manifest/spine for reading order, extract each
// chapter's text (heading-sectioned, like Markdown), and capture the
// nav.xhtml/toc.ncx table of contents pointing back at those sections.
// Always freeform — no book/chapter/verse detection.
// ---------------------------------------------------------------------------

export function isEpubFile(bytes: Uint8Array): boolean {
  // EPUB is a zip whose first entry must be an uncompressed "mimetype" file
  // (the format's self-identifying signature, per the OCF spec).
  if (bytes.length < 31 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    return false;
  }
  const nameLen = bytes[26] | (bytes[27] << 8);
  if (bytes.length < 30 + nameLen) return false;
  const name = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(30, 30 + nameLen));
  return name === 'mimetype';
}

function readZipText(files: Record<string, Uint8Array>, path: string): string | null {
  const bytes = files[path] ?? files[path.replace(/^\//, '')];
  if (!bytes) return null;
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

function parseXmlStrict(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Malformed XML');
  return doc;
}

// EPUB/OPF/NCX documents use namespaced tags (dc:title, opf:item, ...); a
// plain CSS selector won't match those, so compare local names directly.
function localName(el: Element): string {
  const t = el.tagName.toLowerCase();
  return t.includes(':') ? t.slice(t.indexOf(':') + 1) : t;
}

function byLocalName(root: ParentNode, name: string): Element[] {
  return Array.from(root.querySelectorAll('*')).filter((el) => localName(el) === name);
}

// Joins a manifest-relative href onto the OPF/nav file's directory and
// resolves "../" segments — hrefs in the wild are frequently one directory
// up from where they're referenced.
function resolveHref(dir: string, href: string): string {
  const parts = (dir + href.split('#')[0]).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p === '.' || p === '') continue;
    else out.push(p);
  }
  return out.join('/');
}

function dirOf(path: string): string {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
}

// One paragraph-level unit of chapter text. `title` is the heading it falls
// directly under, set only on the FIRST paragraph after that heading (so
// the heading prints once, like a printed book) — null everywhere else.
// Each one becomes its own selectable/highlightable/notable entry, rather
// than merging a whole chapter into a single unwieldy block.
interface EpubParagraph {
  title: string | null;
  text: string;
}

// Walks a chapter's <body>, splitting it into paragraph-level units and
// recording which paragraph every `id` attribute resolves to (fragment
// targets referenced by the TOC — the first paragraph at/after that id) —
// block elements (p, div, li, ...) become paragraph breaks; inline
// formatting is flattened to plain text.
function walkEpubBody(root: Element): { paragraphs: EpubParagraph[]; idToParagraph: Map<string, number> } {
  const paragraphs: EpubParagraph[] = [];
  const idToParagraph = new Map<string, number>();
  let pendingHeading: string | null = null;
  let currentText = '';
  const flush = () => {
    const t = currentText.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    if (t) {
      paragraphs.push({ title: pendingHeading, text: t });
      pendingHeading = null;
    }
    currentText = '';
  };
  const HEADING = /^h[1-6]$/;
  const BLOCK = new Set(['p', 'div', 'li', 'blockquote', 'section', 'article', 'pre', 'tr', 'td']);

  function visit(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      currentText += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') return;
    if (HEADING.test(tag)) {
      flush();
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text) pendingHeading = text;
      const idx = paragraphs.length; // index of the paragraph this heading will label
      const id = el.getAttribute('id');
      if (id) idToParagraph.set(id, idx);
      el.querySelectorAll('[id]').forEach((d) => idToParagraph.set(d.getAttribute('id')!, idx));
      return;
    }
    const id = el.getAttribute('id');
    if (id) idToParagraph.set(id, paragraphs.length);
    if (tag === 'br') currentText += '\n';
    for (const child of Array.from(el.childNodes)) visit(child);
    if (BLOCK.has(tag)) flush();
  }
  visit(root);
  flush();
  return { paragraphs, idToParagraph };
}

// Resolves a TOC target ("chapter1.html#anchor") onto a flattened entry
// index via the href[#id] -> entry-index map built while extracting
// chapters. Falls back to the chapter's first entry if the exact fragment
// wasn't captured as a section boundary.
function resolveTocTarget(src: string, dir: string, anchorToEntry: Map<string, number>): number {
  const [pathPart, frag] = src.split('#');
  const href = resolveHref(dir, pathPart);
  if (frag && anchorToEntry.has(`${href}#${frag}`)) return anchorToEntry.get(`${href}#${frag}`)!;
  return anchorToEntry.get(href) ?? -1;
}

function parseNcxToc(xml: string, dir: string, anchorToEntry: Map<string, number>): ParsedTocEntry[] {
  const doc = parseXmlStrict(xml);
  const out: ParsedTocEntry[] = [];
  const navMap = byLocalName(doc, 'navmap')[0];
  function walk(parent: Element, level: number) {
    const points = Array.from(parent.children).filter((c) => localName(c) === 'navpoint');
    for (const np of points) {
      const label = byLocalName(np, 'text')[0]?.textContent?.trim() ?? '';
      const src = byLocalName(np, 'content')[0]?.getAttribute('src');
      if (label) out.push({ title: label, level, entryIndex: src ? resolveTocTarget(src, dir, anchorToEntry) : -1 });
      walk(np, level + 1);
    }
  }
  if (navMap) walk(navMap, 0);
  return out;
}

function parseNavToc(html: string, dir: string, anchorToEntry: Map<string, number>): ParsedTocEntry[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const navs = Array.from(doc.querySelectorAll('nav'));
  const tocNav = navs.find((n) => (n.getAttribute('epub:type') ?? '').includes('toc')) ?? navs[0];
  const out: ParsedTocEntry[] = [];
  const topOl = tocNav?.querySelector('ol');
  if (!topOl) return out;
  function walk(ol: Element, level: number) {
    Array.from(ol.children)
      .filter((c) => c.tagName.toLowerCase() === 'li')
      .forEach((li) => {
        const a = li.querySelector('a');
        const label = a?.textContent?.trim() ?? '';
        const href = a?.getAttribute('href');
        if (label) out.push({ title: label, level, entryIndex: href ? resolveTocTarget(href, dir, anchorToEntry) : -1 });
        const childOl = Array.from(li.children).find((c) => c.tagName.toLowerCase() === 'ol');
        if (childOl) walk(childOl, level + 1);
      });
  }
  walk(topOl, 0);
  return out;
}

export async function parseEpub(bytes: Uint8Array, baseName: string): Promise<ParsedSource> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (e) {
    return fallbackSource('', baseName, [`Couldn't open this EPUB (${String(e)}); imported as an empty document.`]);
  }

  try {
    const containerXml = readZipText(files, 'META-INF/container.xml');
    if (!containerXml) throw new Error('Missing META-INF/container.xml');
    const opfPath = byLocalName(parseXmlStrict(containerXml), 'rootfile')[0]?.getAttribute('full-path');
    if (!opfPath) throw new Error('No OPF rootfile declared');
    const opfText = readZipText(files, opfPath);
    if (!opfText) throw new Error(`OPF file not found: ${opfPath}`);
    const opfDoc = parseXmlStrict(opfText);
    const opfDir = dirOf(opfPath);

    const metaEl = byLocalName(opfDoc, 'metadata')[0];
    const firstText = (name: string): string | null =>
      (metaEl ? byLocalName(metaEl, name)[0]?.textContent?.trim() : null) || null;
    const suggestedTitle = firstText('title') || baseName;
    const suggestedAuthor = firstText('creator');
    const suggestedLanguage = firstText('language');
    const suggestedLicenseNote = firstText('rights');

    const manifestEl = byLocalName(opfDoc, 'manifest')[0];
    const manifestItems = manifestEl ? byLocalName(manifestEl, 'item') : [];
    const manifest = new Map<string, { href: string; mediaType: string }>();
    manifestItems.forEach((item) => {
      const id = item.getAttribute('id');
      const href = item.getAttribute('href');
      if (id && href) {
        manifest.set(id, { href: resolveHref(opfDir, href), mediaType: item.getAttribute('media-type') ?? '' });
      }
    });

    const spineEl = byLocalName(opfDoc, 'spine')[0];
    const spineHrefs: string[] = [];
    if (spineEl) {
      byLocalName(spineEl, 'itemref').forEach((ref) => {
        const idref = ref.getAttribute('idref');
        const item = idref ? manifest.get(idref) : undefined;
        if (item && /html|xml/.test(item.mediaType)) spineHrefs.push(item.href);
      });
    }
    if (spineHrefs.length === 0) throw new Error('EPUB has no readable spine content');

    // EPUB3 points at its nav document via manifest properties="nav";
    // EPUB2 points at its NCX via the spine's toc="<manifest id>" attribute.
    let navHref: string | null = null;
    let navIsNcx = false;
    const navItem = manifestItems.find((i) => (i.getAttribute('properties') ?? '').split(/\s+/).includes('nav'));
    if (navItem) {
      const href = navItem.getAttribute('href');
      if (href) navHref = resolveHref(opfDir, href);
    } else {
      const ncxId = spineEl?.getAttribute('toc');
      const ncxItem = ncxId ? manifest.get(ncxId) : undefined;
      if (ncxItem) {
        navHref = ncxItem.href;
        navIsNcx = true;
      }
    }

    const entries: ParsedEntry[] = [];
    const anchorToEntry = new Map<string, number>();
    for (const href of spineHrefs) {
      const html = readZipText(files, href);
      if (!html) continue;
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const body = doc.body ?? doc.documentElement;
      if (!body) continue;
      const { paragraphs, idToParagraph } = walkEpubBody(body);
      const baseEntryIndex = entries.length;
      anchorToEntry.set(href, baseEntryIndex);
      paragraphs.forEach((p) => {
        entries.push({ chapter: null, verse: null, position_ref: p.title, text: p.text });
      });
      idToParagraph.forEach((idx, id) => {
        // A heading with no following paragraph in this chapter (rare) maps
        // one past the last real entry — fall back to the chapter start.
        const entryIdx = Math.min(idx, paragraphs.length - 1);
        if (entryIdx >= 0) anchorToEntry.set(`${href}#${id}`, baseEntryIndex + entryIdx);
      });
    }
    if (entries.length === 0) {
      return fallbackSource('', suggestedTitle, ['EPUB contained no extractable text.']);
    }

    let toc: ParsedTocEntry[] = [];
    if (navHref) {
      const navText = readZipText(files, navHref);
      if (navText) {
        const navDir = dirOf(navHref);
        toc = navIsNcx ? parseNcxToc(navText, navDir, anchorToEntry) : parseNavToc(navText, navDir, anchorToEntry);
      }
    }

    return {
      suggestedTitle,
      suggestedType: 'extra-biblical',
      structure: 'freeform',
      books: [{ name: suggestedTitle, entries }],
      warnings: toc.length === 0 ? ['No table of contents found in this EPUB.'] : [],
      suggestedAuthor,
      suggestedLanguage,
      suggestedLicenseNote,
      toc,
    };
  } catch (e) {
    return fallbackSource('', baseName, [`Couldn't parse this EPUB (${String(e)}); imported as an empty document.`]);
  }
}
