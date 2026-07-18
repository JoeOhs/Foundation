import Database from '@tauri-apps/plugin-sql';
import type {
  Book, Entry, EntryNote, Note, ParsedSource, SearchHit, Source, SourceType,
  StrongsDictEntry, StrongsSearchGroup, StrongsSearchHit, StrongsWordRow,
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

// ---------- search ----------

function ftsQuery(q: string): string {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ');
}

export async function searchAll(q: string): Promise<SearchHit[]> {
  const query = q.trim();
  if (!query) return [];
  const db = await ensureDb();
  const entryHits = ftsAvailable()
    ? await db.select<SearchHit[]>(
        `SELECT 'entry' AS kind, e.id AS id, s.id AS source_id, s.title AS source_title,
                s.type AS source_type, b.name AS book, e.chapter AS chapter, e.verse AS verse,
                e.position_ref AS position_ref,
                snippet(entries_fts, 0, '<mark>', '</mark>', '…', 16) AS snippet
         FROM entries_fts
         JOIN entries e ON e.id = entries_fts.rowid
         JOIN books b ON b.id = e.book_id
         JOIN sources s ON s.id = b.source_id
         WHERE entries_fts MATCH ?
         ORDER BY s.id, b.sort_order, e.sort_order LIMIT 200`,
        [ftsQuery(query)],
      )
    : await db.select<SearchHit[]>(
        `SELECT 'entry' AS kind, e.id AS id, s.id AS source_id, s.title AS source_title,
                s.type AS source_type, b.name AS book, e.chapter AS chapter, e.verse AS verse,
                e.position_ref AS position_ref, e.text AS snippet
         FROM entries e
         JOIN books b ON b.id = e.book_id
         JOIN sources s ON s.id = b.source_id
         WHERE e.text LIKE ?
         ORDER BY s.id, b.sort_order, e.sort_order LIMIT 200`,
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
  return [...noteHits, ...entryHits];
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

// True total of tagged word occurrences matching the term — counted as
// distinct (entry, word slot) pairs so a word carrying two Strong's numbers
// isn't counted twice, and unaffected by the display LIMIT in
// strongsSmartSearch below. Accepts either an English surface-text prefix
// or a bare Strong's number.
export async function strongsOccurrenceCount(term: string): Promise<number> {
  const query = term.trim();
  if (!query) return 0;
  const db = await ensureDb();
  const number = parseStrongsNumberQuery(query);
  const rows = number
    ? await db.select<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT entry_id, word_index FROM strongs_words WHERE strongs_number = ?
         )`,
        [number],
      )
    : await db.select<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT entry_id, word_index FROM strongs_words
           WHERE surface_text LIKE ? COLLATE NOCASE OR surface_text LIKE ? COLLATE NOCASE
         )`,
        [`${query}%`, `% ${query}%`],
      );
  return rows[0].n;
}

// Smart search: surface-text prefix match (so love/loved/loveth group
// together as candidates), grouped by which original word they actually
// translate. A bare Strong's number (e.g. "H2708", "g26") instead looks up
// that exact number directly — every verse where it occurs, regardless of
// how it was rendered in English. Returns [] when no Strong's data is
// installed — callers fall back to the regular FTS5 search unchanged.
export async function strongsSmartSearch(term: string): Promise<StrongsSearchGroup[]> {
  const query = term.trim();
  if (!query) return [];
  const db = await ensureDb();
  const number = parseStrongsNumberQuery(query);
  const baseSelect = `
    SELECT sw.entry_id AS entry_id, sw.word_index AS word_index, sw.strongs_number AS strongs_number,
           e.text AS entry_text, b.name AS book, e.chapter AS chapter, e.verse AS verse,
           s.id AS source_id, s.title AS source_title
    FROM strongs_words sw
    JOIN entries e ON e.id = sw.entry_id
    JOIN books b ON b.id = e.book_id
    JOIN sources s ON s.id = b.source_id`;
  type Row = { entry_id: number; word_index: number; strongs_number: string; entry_text: string; book: string; chapter: number; verse: number; source_id: number; source_title: string };
  const rows = number
    ? await db.select<Row[]>(
        `${baseSelect}
         WHERE sw.strongs_number = ?
         ORDER BY b.sort_order, e.chapter, e.verse
         LIMIT 2000`,
        [number],
      )
    : await db.select<Row[]>(
        // Tagged spans are usually multi-word phrases ("my statutes",
        // "a statute"), so the term must match at any word boundary within
        // the span — a bare prefix match would only find spans that BEGIN
        // with the term and silently miss most occurrences.
        `${baseSelect}
         WHERE sw.surface_text LIKE ? COLLATE NOCASE OR sw.surface_text LIKE ? COLLATE NOCASE
         ORDER BY b.sort_order, e.chapter, e.verse
         LIMIT 2000`,
        [`${query}%`, `% ${query}%`],
      );
  if (rows.length === 0) {
    // A number lookup with no verse hits still surfaces the dictionary
    // entry (if one exists) so the definition is reachable directly.
    if (number) {
      const dictRows = await db.select<StrongsDictEntry[]>(
        'SELECT * FROM strongs_dict WHERE strongs_number = ?',
        [number],
      );
      if (dictRows.length > 0) return [{ strongs_number: number, dict: dictRows[0], hits: [] }];
    }
    return [];
  }

  const byNumber = new Map<string, StrongsSearchHit[]>();
  for (const r of rows) {
    if (!byNumber.has(r.strongs_number)) byNumber.set(r.strongs_number, []);
    byNumber.get(r.strongs_number)!.push({
      entry_id: r.entry_id, word_index: r.word_index, entry_text: r.entry_text, book: r.book,
      chapter: r.chapter, verse: r.verse, source_id: r.source_id, source_title: r.source_title,
    });
  }

  const numbers = [...byNumber.keys()];
  const placeholders = numbers.map(() => '?').join(', ');
  const dictRows = await db.select<StrongsDictEntry[]>(
    `SELECT * FROM strongs_dict WHERE strongs_number IN (${placeholders})`,
    numbers,
  );
  const dictByNumber = new Map(dictRows.map((d) => [d.strongs_number, d]));

  return [...byNumber.entries()]
    .map(([strongs_number, hits]) => ({ strongs_number, hits, dict: dictByNumber.get(strongs_number) ?? null }))
    .sort((a, b) => b.hits.length - a.hits.length);
}
