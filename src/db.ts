import Database from '@tauri-apps/plugin-sql';
import type {
  Book, Entry, EntryNote, HighlightRow, Highlighter, Note, ParsedSource, SearchHit,
  SearchResults, Source, SourceType,
  StrongsBookCount, StrongsDictEntry, StrongsSearchGroup, StrongsSearchHit, StrongsWordRow,
} from './types';

// Connection is lazy and cached on globalThis rather than in module scope:
// Vite HMR re-instantiates this module when it (or an upstream import)
// changes, and a plain module-level `let db` would come back undefined —
// every query then dies until a full window reload. The desktop runtime
// keeps exactly one instance either way.
type DbGlobals = { __foundationDb?: Promise<Database>; __foundationFts?: boolean };
const g = globalThis as DbGlobals;

function ensureDb(): Promise<Database> {
  g.__foundationDb ??= Database.load('sqlite:foundation.db');
  return g.__foundationDb;
}

const ftsAvailable = () => g.__foundationFts ?? false;

// One statement per array element — the SQL plugin prepares a single
// statement per execute() call.
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS sources (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    language TEXT,
    license_note TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id),
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    book_id INTEGER NOT NULL REFERENCES books(id),
    chapter INTEGER,
    verse INTEGER,
    position_ref TEXT,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER REFERENCES entries(id),
    anchor_book TEXT,
    anchor_chapter INTEGER,
    anchor_verse INTEGER,
    title TEXT,
    content TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entries_book_chapter_verse ON entries(book_id, chapter, verse)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_entry ON notes(entry_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notes_anchor ON notes(anchor_book, anchor_chapter, anchor_verse)`,
  `CREATE INDEX IF NOT EXISTS idx_books_source ON books(source_id)`,
  `CREATE TABLE IF NOT EXISTS strongs_words (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    word_index INTEGER NOT NULL,
    surface_text TEXT NOT NULL,
    strongs_number TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_strongs_words_entry ON strongs_words(entry_id)`,
  `CREATE INDEX IF NOT EXISTS idx_strongs_words_number ON strongs_words(strongs_number)`,
  `CREATE INDEX IF NOT EXISTS idx_strongs_words_surface ON strongs_words(surface_text COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS strongs_dict (
    strongs_number TEXT PRIMARY KEY,
    lemma TEXT,
    transliteration TEXT,
    pronunciation TEXT,
    short_def TEXT,
    full_def TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS entry_notes (
    id INTEGER PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    word_index INTEGER,
    note_text TEXT NOT NULL,
    note_type TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entry_notes_entry ON entry_notes(entry_id)`,
  `CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS highlighters (
    id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS highlights (
    id INTEGER PRIMARY KEY,
    highlighter_id INTEGER NOT NULL REFERENCES highlighters(id),
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  // one highlighter per verse — applying another replaces it
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_highlights_ref ON highlights(book, chapter, verse)`,
];

const FTS_SCHEMA: string[] = [
  `CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(text, content='entries', content_rowid='id')`,
  `CREATE TRIGGER IF NOT EXISTS entries_fts_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, text) VALUES (new.id, new.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS entries_fts_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END`,
  `CREATE TRIGGER IF NOT EXISTS entries_fts_au AFTER UPDATE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO entries_fts(rowid, text) VALUES (new.id, new.text);
  END`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, content, content='notes', content_rowid='id')`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
  END`,
  `CREATE TRIGGER IF NOT EXISTS notes_fts_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
    INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
  END`,
];

export async function initDb(): Promise<void> {
  const db = await ensureDb();
  for (const stmt of SCHEMA) {
    await db.execute(stmt);
  }
  try {
    for (const stmt of FTS_SCHEMA) {
      await db.execute(stmt);
    }
    g.__foundationFts = true;
  } catch (e) {
    console.warn('FTS5 unavailable, falling back to LIKE search', e);
    g.__foundationFts = false;
  }
}

export async function listSources(): Promise<Source[]> {
  const db = await ensureDb();
  return db.select<Source[]>('SELECT id, title, type, language, license_note FROM sources ORDER BY id');
}

export async function listBooks(sourceId: number): Promise<Book[]> {
  const db = await ensureDb();
  return db.select<Book[]>(
    'SELECT id, source_id, name, sort_order FROM books WHERE source_id = ? ORDER BY sort_order',
    [sourceId],
  );
}

export async function getChapters(sourceId: number, bookName: string): Promise<number[]> {
  const db = await ensureDb();
  const rows = await db.select<{ chapter: number }[]>(
    `SELECT DISTINCT e.chapter AS chapter FROM entries e
     JOIN books b ON b.id = e.book_id
     WHERE b.source_id = ? AND b.name = ? AND e.chapter IS NOT NULL
     ORDER BY e.chapter`,
    [sourceId, bookName],
  );
  return rows.map((r) => r.chapter);
}

// Entries for a book+chapter. For freeform sources (no chapters) pass
// chapter = null to get the whole book/section container in order.
export async function getEntries(
  sourceId: number,
  bookName: string,
  chapter: number | null,
): Promise<Entry[]> {
  const db = await ensureDb();
  if (chapter === null) {
    return db.select<Entry[]>(
      `SELECT e.* FROM entries e JOIN books b ON b.id = e.book_id
       WHERE b.source_id = ? AND b.name = ? ORDER BY e.sort_order`,
      [sourceId, bookName],
    );
  }
  return db.select<Entry[]>(
    `SELECT e.* FROM entries e JOIN books b ON b.id = e.book_id
     WHERE b.source_id = ? AND b.name = ? AND e.chapter = ? ORDER BY e.sort_order`,
    [sourceId, bookName, chapter],
  );
}

// ---------- notes ----------

export async function notesForChapter(book: string, chapter: number): Promise<Note[]> {
  const db = await ensureDb();
  return db.select<Note[]>(
    `SELECT * FROM notes WHERE anchor_book = ? AND (anchor_chapter = ? OR anchor_chapter IS NULL)
     ORDER BY anchor_verse IS NULL, anchor_verse, updated_at DESC`,
    [book, chapter],
  );
}

export async function freeNotes(): Promise<Note[]> {
  const db = await ensureDb();
  return db.select<Note[]>(
    `SELECT * FROM notes WHERE anchor_book IS NULL AND entry_id IS NULL ORDER BY updated_at DESC`,
  );
}

export async function notesForEntry(entryId: number): Promise<Note[]> {
  const db = await ensureDb();
  return db.select<Note[]>('SELECT * FROM notes WHERE entry_id = ? ORDER BY updated_at DESC', [entryId]);
}

// All notes, ordered by canonical anchor then recency — used for export.
export async function allNotes(): Promise<Note[]> {
  const db = await ensureDb();
  return db.select<Note[]>(
    `SELECT * FROM notes
     ORDER BY anchor_book IS NULL, anchor_book, anchor_chapter, anchor_verse, updated_at DESC`,
  );
}

export async function addNote(note: {
  entry_id?: number | null;
  anchor_book?: string | null;
  anchor_chapter?: number | null;
  anchor_verse?: number | null;
  title?: string | null;
  content: string;
}): Promise<void> {
  const db = await ensureDb();
  await db.execute(
    `INSERT INTO notes (entry_id, anchor_book, anchor_chapter, anchor_verse, title, content)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      note.entry_id ?? null,
      note.anchor_book ?? null,
      note.anchor_chapter ?? null,
      note.anchor_verse ?? null,
      note.title ?? null,
      note.content,
    ],
  );
}

export async function updateNote(id: number, title: string | null, content: string): Promise<void> {
  const db = await ensureDb();
  await db.execute(
    `UPDATE notes SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?`,
    [title, content, id],
  );
}

export async function deleteNote(id: number): Promise<void> {
  const db = await ensureDb();
  await db.execute('DELETE FROM notes WHERE id = ?', [id]);
}

// ---------- highlighters + highlights ----------

const DEFAULT_HIGHLIGHTERS: { label: string; color: string }[] = [
  { label: 'Yellow', color: '#f2c200' },
  { label: 'Green', color: '#4caf50' },
  { label: 'Blue', color: '#4a90d9' },
  { label: 'Pink', color: '#e0669e' },
  { label: 'Orange', color: '#ef8b3b' },
];

// Seed the starter palette once (idempotent via a meta flag). Labels and
// colors are fully editable afterward.
export async function seedHighlightersIfEmpty(): Promise<void> {
  const db = await ensureDb();
  const rows = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM highlighters');
  if (rows[0].n > 0) return;
  for (let i = 0; i < DEFAULT_HIGHLIGHTERS.length; i++) {
    const h = DEFAULT_HIGHLIGHTERS[i];
    await db.execute('INSERT INTO highlighters (label, color, sort_order) VALUES (?, ?, ?)', [h.label, h.color, i]);
  }
}

export async function listHighlighters(): Promise<Highlighter[]> {
  const db = await ensureDb();
  return db.select<Highlighter[]>('SELECT id, label, color, sort_order FROM highlighters ORDER BY sort_order, id');
}

export async function addHighlighter(label: string, color: string): Promise<void> {
  const db = await ensureDb();
  const max = await db.select<{ m: number }[]>('SELECT COALESCE(MAX(sort_order), -1) AS m FROM highlighters');
  await db.execute('INSERT INTO highlighters (label, color, sort_order) VALUES (?, ?, ?)', [label, color, max[0].m + 1]);
}

export async function updateHighlighter(id: number, label: string, color: string): Promise<void> {
  const db = await ensureDb();
  await db.execute('UPDATE highlighters SET label = ?, color = ? WHERE id = ?', [label, color, id]);
}

// Deleting a highlighter removes every highlight that used it.
export async function deleteHighlighter(id: number): Promise<void> {
  const db = await ensureDb();
  await db.execute('DELETE FROM highlights WHERE highlighter_id = ?', [id]);
  await db.execute('DELETE FROM highlighters WHERE id = ?', [id]);
}

// Apply (or re-color) a highlighter on a verse — one highlight per verse.
export async function setHighlight(highlighterId: number, book: string, chapter: number, verse: number): Promise<void> {
  const db = await ensureDb();
  await db.execute(
    `INSERT INTO highlights (highlighter_id, book, chapter, verse) VALUES (?, ?, ?, ?)
     ON CONFLICT(book, chapter, verse) DO UPDATE SET highlighter_id = excluded.highlighter_id`,
    [highlighterId, book, chapter, verse],
  );
}

export async function removeHighlight(book: string, chapter: number, verse: number): Promise<void> {
  const db = await ensureDb();
  await db.execute('DELETE FROM highlights WHERE book = ? AND chapter = ? AND verse = ?', [book, chapter, verse]);
}

// verse -> highlighter color for one chapter (reader rendering)
export async function highlightsForChapter(book: string, chapter: number): Promise<Map<number, { color: string; highlighterId: number }>> {
  const db = await ensureDb();
  const rows = await db.select<{ verse: number; color: string; highlighter_id: number }[]>(
    `SELECT h.verse AS verse, hl.color AS color, h.highlighter_id AS highlighter_id
     FROM highlights h JOIN highlighters hl ON hl.id = h.highlighter_id
     WHERE h.book = ? AND h.chapter = ?`,
    [book, chapter],
  );
  return new Map(rows.map((r) => [r.verse, { color: r.color, highlighterId: r.highlighter_id }]));
}

// All highlighted verses, joined with their highlighter, in canonical order
// — for the Highlights list. Text is looked up from the KJV (or any bible)
// so the list is readable without loading each chapter.
export async function listHighlights(): Promise<(HighlightRow & { text: string })[]> {
  const db = await ensureDb();
  return db.select<(HighlightRow & { text: string })[]>(
    `SELECT h.id AS id, h.highlighter_id AS highlighter_id, h.book AS book, h.chapter AS chapter,
            h.verse AS verse, h.created_at AS created_at, hl.label AS label, hl.color AS color,
            COALESCE((
              SELECT e.text FROM entries e
              JOIN books b ON b.id = e.book_id
              JOIN sources s ON s.id = b.source_id
              WHERE s.type = 'bible' AND b.name = h.book AND e.chapter = h.chapter AND e.verse = h.verse
              ORDER BY s.id LIMIT 1
            ), '') AS text
     FROM highlights h JOIN highlighters hl ON hl.id = h.highlighter_id
     ORDER BY hl.sort_order, hl.id, h.book, h.chapter, h.verse`,
  );
}

// ---------- search ----------

function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}

// Per-source display cap for full-text results. Applied per source via a
// window function — a global LIMIT would let the first source (KJV) eat
// the whole budget and hide every later source entirely for common words.
const FTS_PER_SOURCE = 200;

export async function searchAll(q: string): Promise<SearchResults> {
  const query = q.trim();
  if (!query) return { hits: [], entryTotals: [] };
  const db = await ensureDb();
  const entryHits = ftsAvailable()
    ? await db.select<SearchHit[]>(
        `SELECT kind, id, source_id, source_title, source_type, book, chapter, verse, position_ref, snippet FROM (
           SELECT 'entry' AS kind, e.id AS id, s.id AS source_id, s.title AS source_title,
                  s.type AS source_type, b.name AS book, e.chapter AS chapter, e.verse AS verse,
                  e.position_ref AS position_ref,
                  snippet(entries_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet,
                  ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY b.sort_order, e.sort_order) AS rn
           FROM entries_fts
           JOIN entries e ON e.id = entries_fts.rowid
           JOIN books b ON b.id = e.book_id
           JOIN sources s ON s.id = b.source_id
           WHERE entries_fts MATCH ?
         ) WHERE rn <= ${FTS_PER_SOURCE}
         ORDER BY source_id, rn`,
        [ftsQuery(query)],
      )
    : await db.select<SearchHit[]>(
        `SELECT kind, id, source_id, source_title, source_type, book, chapter, verse, position_ref, snippet FROM (
           SELECT 'entry' AS kind, e.id AS id, s.id AS source_id, s.title AS source_title,
                  s.type AS source_type, b.name AS book, e.chapter AS chapter, e.verse AS verse,
                  e.position_ref AS position_ref, e.text AS snippet,
                  ROW_NUMBER() OVER (PARTITION BY s.id ORDER BY b.sort_order, e.sort_order) AS rn
           FROM entries e
           JOIN books b ON b.id = e.book_id
           JOIN sources s ON s.id = b.source_id
           WHERE e.text LIKE ?
         ) WHERE rn <= ${FTS_PER_SOURCE}
         ORDER BY source_id, rn`,
        [`%${query}%`],
      );
  // True per-source totals, independent of the display cap.
  const entryTotals = ftsAvailable()
    ? await db.select<{ source_title: string; total: number }[]>(
        `SELECT s.title AS source_title, COUNT(*) AS total
         FROM entries_fts
         JOIN entries e ON e.id = entries_fts.rowid
         JOIN books b ON b.id = e.book_id
         JOIN sources s ON s.id = b.source_id
         WHERE entries_fts MATCH ?
         GROUP BY s.id`,
        [ftsQuery(query)],
      )
    : await db.select<{ source_title: string; total: number }[]>(
        `SELECT s.title AS source_title, COUNT(*) AS total
         FROM entries e
         JOIN books b ON b.id = e.book_id
         JOIN sources s ON s.id = b.source_id
         WHERE e.text LIKE ?
         GROUP BY s.id`,
        [`%${query}%`],
      );
  const noteHits = ftsAvailable()
    ? await db.select<SearchHit[]>(
        `SELECT 'note' AS kind, n.id AS id, NULL AS source_id, 'My Notes' AS source_title,
                'notes' AS source_type, n.anchor_book AS book, n.anchor_chapter AS chapter,
                n.anchor_verse AS verse, NULL AS position_ref,
                snippet(notes_fts, 1, '<mark>', '</mark>', '…', 16) AS snippet
         FROM notes_fts
         JOIN notes n ON n.id = notes_fts.rowid
         WHERE notes_fts MATCH ?
         ORDER BY n.updated_at DESC LIMIT 100`,
        [ftsQuery(query)],
      )
    : await db.select<SearchHit[]>(
        `SELECT 'note' AS kind, n.id AS id, NULL AS source_id, 'My Notes' AS source_title,
                'notes' AS source_type, n.anchor_book AS book, n.anchor_chapter AS chapter,
                n.anchor_verse AS verse, NULL AS position_ref, n.content AS snippet
         FROM notes n
         WHERE n.content LIKE ? OR n.title LIKE ?
         ORDER BY n.updated_at DESC LIMIT 100`,
        [`%${query}%`, `%${query}%`],
      );
  return { hits: [...noteHits, ...entryHits], entryTotals };
}

// ---------- inserting sources (seed + import share this path) ----------

const INSERT_BATCH = 400;

export async function insertParsedSource(
  parsed: ParsedSource,
  meta: { title: string; type: SourceType; language?: string | null; license_note?: string | null },
  onProgress?: (done: number, total: number) => void,
): Promise<number> {
  const db = await ensureDb();
  const res = await db.execute(
    'INSERT INTO sources (title, type, language, license_note) VALUES (?, ?, ?, ?)',
    [meta.title, meta.type, meta.language ?? null, meta.license_note ?? null],
  );
  const sourceId = res.lastInsertId as number;
  const total = parsed.books.reduce((n, b) => n + b.entries.length, 0);
  let done = 0;
  for (let bi = 0; bi < parsed.books.length; bi++) {
    const book = parsed.books[bi];
    const bres = await db.execute(
      'INSERT INTO books (source_id, name, sort_order) VALUES (?, ?, ?)',
      [sourceId, book.name, bi],
    );
    const bookId = bres.lastInsertId as number;
    for (let i = 0; i < book.entries.length; i += INSERT_BATCH) {
      const batch = book.entries.slice(i, i + INSERT_BATCH);
      const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
      const params: unknown[] = [];
      batch.forEach((e, j) => {
        params.push(bookId, e.chapter, e.verse, e.position_ref, e.text, i + j);
      });
      await db.execute(
        `INSERT INTO entries (book_id, chapter, verse, position_ref, text, sort_order) VALUES ${placeholders}`,
        params,
      );
      done += batch.length;
      onProgress?.(done, total);
    }
  }
  return sourceId;
}

export async function deleteSource(sourceId: number): Promise<void> {
  const db = await ensureDb();
  await db.execute(
    'DELETE FROM entries WHERE book_id IN (SELECT id FROM books WHERE source_id = ?)',
    [sourceId],
  );
  await db.execute('DELETE FROM books WHERE source_id = ?', [sourceId]);
  await db.execute('DELETE FROM sources WHERE id = ?', [sourceId]);
}

export async function sourceCount(): Promise<number> {
  const db = await ensureDb();
  const rows = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM sources');
  return rows[0].n;
}

// ---------- Strong's numbers ----------

export async function findSourceByTitle(title: string): Promise<Source | null> {
  const db = await ensureDb();
  const rows = await db.select<Source[]>(
    'SELECT id, title, type, language, license_note FROM sources WHERE title = ? LIMIT 1',
    [title],
  );
  return rows[0] ?? null;
}

// book/chapter/verse -> entry id, for matching an external verse-keyed
// dataset (e.g. the Strong's-tagged OSIS file) onto already-seeded entries.
export async function getEntryRefMap(sourceId: number): Promise<Map<string, number>> {
  const db = await ensureDb();
  const rows = await db.select<{ id: number; name: string; chapter: number; verse: number }[]>(
    `SELECT e.id AS id, b.name AS name, e.chapter AS chapter, e.verse AS verse
     FROM entries e JOIN books b ON b.id = e.book_id
     WHERE b.source_id = ? AND e.chapter IS NOT NULL AND e.verse IS NOT NULL`,
    [sourceId],
  );
  const map = new Map<string, number>();
  for (const r of rows) map.set(`${r.name}|${r.chapter}|${r.verse}`, r.id);
  return map;
}

export async function hasStrongsData(): Promise<boolean> {
  const db = await ensureDb();
  const rows = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM strongs_dict');
  return rows[0].n > 0;
}

// Makes re-running the Strong's import safe: clears any previously
// attached word tags and translator's notes for this source's entries,
// plus the whole dictionary (which isn't source-specific), before
// re-inserting.
export async function clearStrongsData(kjvSourceId: number): Promise<void> {
  const db = await ensureDb();
  await db.execute(
    `DELETE FROM strongs_words WHERE entry_id IN (
       SELECT e.id FROM entries e JOIN books b ON b.id = e.book_id WHERE b.source_id = ?
     )`,
    [kjvSourceId],
  );
  await db.execute(
    `DELETE FROM entry_notes WHERE entry_id IN (
       SELECT e.id FROM entries e JOIN books b ON b.id = e.book_id WHERE b.source_id = ?
     )`,
    [kjvSourceId],
  );
  await db.execute('DELETE FROM strongs_dict');
}

// ---------- meta flags (one-time migrations/repairs) ----------

export async function getMeta(key: string): Promise<string | null> {
  const db = await ensureDb();
  const rows = await db.select<{ value: string }[]>('SELECT value FROM meta WHERE key = ?', [key]);
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await ensureDb();
  await db.execute('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
}

// ---------- entry text repair ----------

// id + current text for every verse-keyed entry of a source, keyed by
// canonical reference — used to diff against a corrected seed conversion.
export async function getEntryTexts(sourceId: number): Promise<Map<string, { id: number; text: string }>> {
  const db = await ensureDb();
  const rows = await db.select<{ id: number; name: string; chapter: number; verse: number; text: string }[]>(
    `SELECT e.id AS id, b.name AS name, e.chapter AS chapter, e.verse AS verse, e.text AS text
     FROM entries e JOIN books b ON b.id = e.book_id
     WHERE b.source_id = ? AND e.chapter IS NOT NULL AND e.verse IS NOT NULL`,
    [sourceId],
  );
  const map = new Map<string, { id: number; text: string }>();
  for (const r of rows) map.set(`${r.name}|${r.chapter}|${r.verse}`, { id: r.id, text: r.text });
  return map;
}

const UPDATE_BATCH = 200;

// Batched UPDATE of entries.text by id. The FTS sync triggers fire per
// row, so entries_fts stays consistent without extra work here.
export async function updateEntryTexts(rows: { id: number; text: string }[]): Promise<void> {
  const db = await ensureDb();
  for (let i = 0; i < rows.length; i += UPDATE_BATCH) {
    const batch = rows.slice(i, i + UPDATE_BATCH);
    const cases = batch.map(() => 'WHEN ? THEN ?').join(' ');
    const params: unknown[] = [];
    for (const r of batch) params.push(r.id, r.text);
    for (const r of batch) params.push(r.id);
    await db.execute(
      `UPDATE entries SET text = CASE id ${cases} END
       WHERE id IN (${batch.map(() => '?').join(', ')})`,
      params,
    );
  }
}

// ---------- translator's notes (entry_notes) ----------

export async function insertEntryNotesBatch(
  rows: { entry_id: number; word_index: number | null; note_text: string; note_type: string | null }[],
): Promise<void> {
  const db = await ensureDb();
  for (let i = 0; i < rows.length; i += STRONGS_INSERT_BATCH) {
    const batch = rows.slice(i, i + STRONGS_INSERT_BATCH);
    const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const r of batch) params.push(r.entry_id, r.word_index, r.note_text, r.note_type);
    await db.execute(
      `INSERT INTO entry_notes (entry_id, word_index, note_text, note_type) VALUES ${placeholders}`,
      params,
    );
  }
}

export async function getEntryNotesForEntries(entryIds: number[]): Promise<EntryNote[]> {
  if (entryIds.length === 0) return [];
  const db = await ensureDb();
  const placeholders = entryIds.map(() => '?').join(', ');
  return db.select<EntryNote[]>(
    `SELECT id, entry_id, word_index, note_text, note_type FROM entry_notes
     WHERE entry_id IN (${placeholders}) ORDER BY entry_id, word_index`,
    entryIds,
  );
}

const STRONGS_INSERT_BATCH = 400;

export async function insertStrongsWordsBatch(
  rows: { entry_id: number; word_index: number; surface_text: string; strongs_number: string }[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const db = await ensureDb();
  for (let i = 0; i < rows.length; i += STRONGS_INSERT_BATCH) {
    const batch = rows.slice(i, i + STRONGS_INSERT_BATCH);
    const placeholders = batch.map(() => '(?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const r of batch) params.push(r.entry_id, r.word_index, r.surface_text, r.strongs_number);
    await db.execute(
      `INSERT INTO strongs_words (entry_id, word_index, surface_text, strongs_number) VALUES ${placeholders}`,
      params,
    );
    onProgress?.(Math.min(i + batch.length, rows.length), rows.length);
  }
}

export async function insertStrongsDictBatch(rows: StrongsDictEntry[]): Promise<void> {
  const db = await ensureDb();
  for (let i = 0; i < rows.length; i += STRONGS_INSERT_BATCH) {
    const batch = rows.slice(i, i + STRONGS_INSERT_BATCH);
    const placeholders = batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
    const params: unknown[] = [];
    for (const r of batch) {
      params.push(r.strongs_number, r.lemma, r.transliteration, r.pronunciation, r.short_def, r.full_def);
    }
    await db.execute(
      `INSERT OR REPLACE INTO strongs_dict
         (strongs_number, lemma, transliteration, pronunciation, short_def, full_def)
       VALUES ${placeholders}`,
      params,
    );
  }
}

// Flat rows for a set of entries — grouped into render-ready word slots by
// the caller (see src/strongsRender.tsx), since a slot may carry >1 number.
export async function getStrongsWordsForEntries(entryIds: number[]): Promise<StrongsWordRow[]> {
  if (entryIds.length === 0) return [];
  const db = await ensureDb();
  const placeholders = entryIds.map(() => '?').join(', ');
  return db.select<StrongsWordRow[]>(
    `SELECT entry_id, word_index, surface_text, strongs_number FROM strongs_words
     WHERE entry_id IN (${placeholders}) ORDER BY entry_id, word_index`,
    entryIds,
  );
}

// "H2708", "g26", "H02708" → canonical "H2708"/"G26"; null for anything
// that isn't a bare Strong's number. Zero-stripping matches the importer's
// normalization so zero-padded OSIS-style input still finds rows.
export function parseStrongsNumberQuery(term: string): string | null {
  const m = term.trim().match(/^([HGhg])0*([1-9]\d*)$/);
  return m ? `${m[1].toUpperCase()}${m[2]}` : null;
}

// Shared WHERE predicate for smart-search queries: a bare Strong's number
// matches by number; anything else matches the term at a word boundary
// within the (often multi-word) tagged span.
function strongsMatch(term: string): { where: string; params: unknown[] } | null {
  const query = term.trim();
  if (!query) return null;
  const number = parseStrongsNumberQuery(query);
  if (number) return { where: 'sw.strongs_number = ?', params: [number] };
  return {
    where: '(sw.surface_text LIKE ? COLLATE NOCASE OR sw.surface_text LIKE ? COLLATE NOCASE)',
    params: [`${query}%`, `% ${query}%`],
  };
}

// True total of tagged word occurrences matching the term — counted as
// distinct (entry, word slot) pairs so a word carrying two Strong's numbers
// isn't counted twice, and unaffected by the display LIMIT in
// strongsSmartSearch below. Accepts either an English surface-text prefix
// or a bare Strong's number.
export async function strongsOccurrenceCount(term: string): Promise<number> {
  const match = strongsMatch(term);
  if (!match) return 0;
  const db = await ensureDb();
  const rows = await db.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM (
       SELECT DISTINCT sw.entry_id, sw.word_index FROM strongs_words sw WHERE ${match.where}
     )`,
    match.params,
  );
  return rows[0].n;
}

// Smart search, aggregates only: groups matches by Strong's number with
// per-book counts computed entirely in SQL — no row cap, so true totals
// even for 6,000-occurrence words ("LORD"). A bare Strong's number (e.g.
// "H2708", "g26") looks up that exact number. Verse hits are fetched
// separately, per book, by strongsSearchHitsForBook when a book is
// expanded. Returns [] when no Strong's data is installed — callers fall
// back to the regular FTS5 search unchanged.
export async function strongsSmartSearch(term: string): Promise<StrongsSearchGroup[]> {
  const match = strongsMatch(term);
  if (!match) return [];
  const db = await ensureDb();
  const rows = await db.select<{ strongs_number: string; book: string; n: number }[]>(
    `SELECT sw.strongs_number AS strongs_number, b.name AS book, COUNT(*) AS n
     FROM strongs_words sw
     JOIN entries e ON e.id = sw.entry_id
     JOIN books b ON b.id = e.book_id
     WHERE ${match.where}
     GROUP BY sw.strongs_number, b.name
     ORDER BY b.sort_order`,
    match.params,
  );
  if (rows.length === 0) {
    // A number lookup with no verse hits still surfaces the dictionary
    // entry (if one exists) so the definition is reachable directly.
    const number = parseStrongsNumberQuery(term);
    if (number) {
      const dictRows = await db.select<StrongsDictEntry[]>(
        'SELECT * FROM strongs_dict WHERE strongs_number = ?',
        [number],
      );
      if (dictRows.length > 0) return [{ strongs_number: number, dict: dictRows[0], total: 0, books: [] }];
    }
    return [];
  }

  const byNumber = new Map<string, StrongsBookCount[]>();
  for (const r of rows) {
    if (!byNumber.has(r.strongs_number)) byNumber.set(r.strongs_number, []);
    byNumber.get(r.strongs_number)!.push({ book: r.book, count: r.n });
  }

  const numbers = [...byNumber.keys()];
  const placeholders = numbers.map(() => '?').join(', ');
  const dictRows = await db.select<StrongsDictEntry[]>(
    `SELECT * FROM strongs_dict WHERE strongs_number IN (${placeholders})`,
    numbers,
  );
  const dictByNumber = new Map(dictRows.map((d) => [d.strongs_number, d]));

  return [...byNumber.entries()]
    .map(([strongs_number, books]) => ({
      strongs_number,
      books,
      total: books.reduce((a, b) => a + b.count, 0),
      dict: dictByNumber.get(strongs_number) ?? null,
    }))
    .sort((a, b) => b.total - a.total);
}

// Verse hits for one (search term, Strong's number, book) — fetched when a
// book header is expanded in the results. Bounded per book, which no book
// exceeds in practice (Psalms' H3068 is the max at ~700).
export const STRONGS_HITS_PER_BOOK = 800;

export async function strongsSearchHitsForBook(
  term: string,
  strongsNumber: string,
  book: string,
): Promise<StrongsSearchHit[]> {
  const match = strongsMatch(term);
  if (!match) return [];
  const db = await ensureDb();
  return db.select<StrongsSearchHit[]>(
    `SELECT sw.entry_id AS entry_id, sw.word_index AS word_index,
            e.text AS entry_text, b.name AS book, e.chapter AS chapter, e.verse AS verse,
            s.id AS source_id, s.title AS source_title
     FROM strongs_words sw
     JOIN entries e ON e.id = sw.entry_id
     JOIN books b ON b.id = e.book_id
     JOIN sources s ON s.id = b.source_id
     WHERE ${match.where} AND sw.strongs_number = ? AND b.name = ?
     ORDER BY e.chapter, e.verse, sw.word_index
     LIMIT ${STRONGS_HITS_PER_BOOK}`,
    [...match.params, strongsNumber, book],
  );
}
