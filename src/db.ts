import Database from '@tauri-apps/plugin-sql';
import type { Book, Entry, Note, ParsedSource, SearchHit, Source, SourceType } from './types';

let db: Database;
let ftsAvailable = false;

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
  db = await Database.load('sqlite:foundation.db');
  for (const stmt of SCHEMA) {
    await db.execute(stmt);
  }
  try {
    for (const stmt of FTS_SCHEMA) {
      await db.execute(stmt);
    }
    ftsAvailable = true;
  } catch (e) {
    console.warn('FTS5 unavailable, falling back to LIKE search', e);
    ftsAvailable = false;
  }
}

export async function listSources(): Promise<Source[]> {
  return db.select<Source[]>('SELECT id, title, type, language, license_note FROM sources ORDER BY id');
}

export async function listBooks(sourceId: number): Promise<Book[]> {
  return db.select<Book[]>(
    'SELECT id, source_id, name, sort_order FROM books WHERE source_id = ? ORDER BY sort_order',
    [sourceId],
  );
}

export async function getChapters(sourceId: number, bookName: string): Promise<number[]> {
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
  return db.select<Note[]>(
    `SELECT * FROM notes WHERE anchor_book = ? AND (anchor_chapter = ? OR anchor_chapter IS NULL)
     ORDER BY anchor_verse IS NULL, anchor_verse, updated_at DESC`,
    [book, chapter],
  );
}

export async function freeNotes(): Promise<Note[]> {
  return db.select<Note[]>(
    `SELECT * FROM notes WHERE anchor_book IS NULL AND entry_id IS NULL ORDER BY updated_at DESC`,
  );
}

export async function notesForEntry(entryId: number): Promise<Note[]> {
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
  await db.execute(
    `UPDATE notes SET title = ?, content = ?, updated_at = datetime('now') WHERE id = ?`,
    [title, content, id],
  );
}

export async function deleteNote(id: number): Promise<void> {
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
  const entryHits = ftsAvailable
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
  const noteHits = ftsAvailable
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
  await db.execute(
    'DELETE FROM entries WHERE book_id IN (SELECT id FROM books WHERE source_id = ?)',
    [sourceId],
  );
  await db.execute('DELETE FROM books WHERE source_id = ?', [sourceId]);
  await db.execute('DELETE FROM sources WHERE id = ?', [sourceId]);
}

export async function sourceCount(): Promise<number> {
  const rows = await db.select<{ n: number }[]>('SELECT COUNT(*) AS n FROM sources');
  return rows[0].n;
}
