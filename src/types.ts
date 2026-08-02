export type SourceType = 'bible' | 'commentary' | 'extra-biblical' | 'reference';

// How a source is filed in the Library panel. Deliberately separate from
// `type`, which is *behavioural* — `type === 'bible'` drives pane roles,
// sync eligibility and search scoping (see sourceRoles.ts), and changing it
// would move a source between panes. `category` is purely organisational,
// and carries distinctions `type` cannot: Josephus ('historical') and an
// EPUB ('imported') both have to be `type: 'extra-biblical'` to behave
// correctly, yet belong in different Library sections.
export type SourceCategory =
  | 'bible'
  | 'commentary'
  | 'reference'
  | 'historical'
  // Dictionaries and devotionals live in the study footer (FooterPanel),
  // not in a reading pane — the category is what routes them there.
  | 'dictionary'
  | 'devotional'
  // Church Fathers collections (Ante-Nicene, Nicene and Post-Nicene).
  | 'patristic'
  | 'imported';

export interface Source {
  id: number;
  title: string;
  type: SourceType;
  // ISO 639-1 code ('en', 'ar', 'ru', 'zh') — never a display name. Required
  // for a 'bible' category source, since the Library groups Bibles by
  // language; optional elsewhere. Render via languageName() in language.ts.
  language: string | null;
  license_note: string | null;
  is_verse_keyed: number; // 0/1 — 0 for freeform library imports (e.g. EPUB)
  category: SourceCategory;
}

export interface Book {
  id: number;
  source_id: number;
  name: string;
  sort_order: number;
}

export interface Entry {
  id: number;
  book_id: number;
  chapter: number | null;
  verse: number | null;
  position_ref: string | null;
  text: string;
  sort_order: number;
}

// Notes anchor by canonical reference (book/chapter/verse) so a verse note
// shows up in every translation, not just the one it was created in.
// entry_id is used for notes on imported, non-canonical entries.
export interface Note {
  id: number;
  entry_id: number | null;
  anchor_book: string | null;
  anchor_chapter: number | null;
  anchor_verse: number | null;
  title: string | null;
  content: string;
  pinned: number; // 0/1 — pinned notes sort to the top of their list
  created_at: string;
  updated_at: string;
}

export interface Reference {
  book: string;
  chapter: number;
}

export interface VerseSelection {
  book: string;
  chapter: number;
  verse: number;
}

// A selected verse carrying enough to render it into a note without a
// re-query — text + which translation it came from.
export interface SelectedVerse extends VerseSelection {
  text: string;
  sourceTitle: string;
}

export interface SearchHit {
  kind: 'entry' | 'note';
  id: number;
  source_id: number | null;
  source_title: string;
  source_type: string;
  source_category: SourceCategory | null;
  book: string | null;
  chapter: number | null;
  verse: number | null;
  position_ref: string | null;
  snippet: string;
}

// Intermediate shape produced by the import parsers before DB insertion.
export interface ParsedBook {
  name: string;
  // verse-keyed: entries carry chapter/verse; freeform: position_ref instead
  entries: ParsedEntry[];
}

export interface ParsedEntry {
  chapter: number | null;
  verse: number | null;
  position_ref: string | null;
  text: string;
}

export interface ParsedSource {
  suggestedTitle: string;
  suggestedType: SourceType;
  structure: 'verse-keyed' | 'freeform';
  books: ParsedBook[];
  warnings: string[];
  suggestedAuthor?: string | null;
  suggestedLanguage?: string | null;
  suggestedLicenseNote?: string | null;
  toc?: ParsedTocEntry[];
}

// One table-of-contents row, resolved to a real entries.id at insert time.
//
// `entryIndex` indexes into the entries of ParsedSource.books[bookIndex],
// in their declared order. `bookIndex` defaults to 0, which is the whole
// story for a single-book source like an EPUB; a compound work (Josephus:
// one source, ~30 books) sets it per row so a TOC can span every book.
// -1 as entryIndex means "no target" — a grouping heading (the "Work"
// level of Work → Book → Chapter) that labels its children without being
// jumpable itself.
//
// `level` is a 0-based nesting depth with no fixed ceiling: EPUB produces
// 1-2 levels, a compound work produces 3.
export interface ParsedTocEntry {
  title: string;
  level: number;
  entryIndex: number;
  bookIndex?: number;
}

// A toc_entries row read back from the DB, for the reading-pane TOC
// dropdown. `chapter` mirrors the target entry's own chapter (null if the
// source doesn't chapter its entries) — carried here so a jump can load
// just that chapter instead of requiring the whole source already loaded.
export interface TocEntryRow {
  id: number;
  source_id: number;
  entry_id: number | null;
  title: string;
  level: number;
  position_ref: string | null;
  sort_order: number;
  chapter: number | null;
  // Joined from the target entry's book. Needed because a compound work
  // restarts chapter numbering per book, so chapter alone can't identify
  // where to jump. NULL for a grouping heading (no target entry).
  book_name: string | null;
}

// The reference under the cursor, shared across panes so each can mark the
// same verse. `verses` is a list because a Structure outline line covers a
// range ("18, 19-") rather than a single verse.
export interface HoveredVerses {
  book: string;
  chapter: number;
  verses: number[];
}

// ---------- structure diagrams (Companion Bible outlines) ----------

export interface StructureDiagramRow {
  id: number;
  source_id: number;
  anchor_book: string;
  anchor_chapter: number;
  anchor_verse_start: number | null;
  anchor_verse_end: number | null;
  title: string;
  reference_pdf_path: string | null;
  reference_pdf_page: number | null;
}

// entry_id is null for a "bracket" line — one of Bullinger's bold letters
// spanning a block of members without text of its own, so there's nothing
// to read, highlight or annotate.
export interface StructureLineRow {
  id: number;
  entry_id: number | null;
  diagram_id: number;
  parent_id: number | null;
  sort_order: number;
  depth: number;
  label: string | null;
  ref_range: string | null;
}

// One row per (group, member line) pair, as returned by the join in
// getStructureForSource — a group repeats across its member lines.
export interface StructureGroupRow {
  id: number;
  diagram_id: number;
  label: string;
  structure_line_id: number;
}

export interface StructureData {
  diagrams: StructureDiagramRow[];
  lines: StructureLineRow[];
  groups: StructureGroupRow[];
}

// ---------- Strong's numbers (KJV word-level tagging) ----------

// One row per (entry, word slot, Strong's number). A word slot usually has
// exactly one number, but occasionally two (e.g. an untranslated Hebrew
// particle folded into the following word's rendering) — those share the
// same entry_id/word_index and are grouped back together at render time.
export interface StrongsWordRow {
  entry_id: number;
  word_index: number;
  surface_text: string;
  strongs_number: string;
}

export interface StrongsDictEntry {
  strongs_number: string;
  lemma: string | null;
  transliteration: string | null;
  pronunciation: string | null;
  short_def: string | null;
  full_def: string | null;
}

// A single visible word slot in a verse, after grouping StrongsWordRow by
// word_index — one span to render, possibly tagged with more than one number.
export interface StrongsWordSlot {
  word_index: number;
  surface_text: string;
  strongs_numbers: string[];
}

// A labeled highlighter color. `color` is a base hex; the reader renders
// it translucent (color-mix) so text stays legible on any theme.
export interface Highlighter {
  id: number;
  label: string;
  color: string;
  sort_order: number;
}

// A highlight applied to a verse (canonical reference, so it shows across
// every translation) or to a specific imported entry (a freeform text's
// section) — exactly one of (book/chapter/verse) or entry_id is set. At
// most one highlighter per verse, and separately at most one per entry.
export interface Highlight {
  id: number;
  highlighter_id: number;
  book: string | null;
  chapter: number | null;
  verse: number | null;
  entry_id: number | null;
  created_at: string;
}

// A highlighted verse or entry joined with its highlighter and display
// text, for the Highlights list. entry_source_id/entry_source_title/
// entry_position_ref are only populated for entry-anchored rows.
export interface HighlightRow extends Highlight {
  label: string;
  color: string;
  entry_source_id: number | null;
  text: string;
  entry_source_title: string | null;
  entry_position_ref: string | null;
}

// One endpoint of a binding: a canonical verse, or a specific imported entry.
export type LinkEndpoint =
  | { kind: 'verse'; book: string; chapter: number; verse: number }
  | { kind: 'entry'; entryId: number };

// A binding between two endpoints (each a verse or an imported entry),
// optionally associated with a highlighter for color/category. Both
// endpoints show a dashed outline.
export interface Link {
  id: number;
  book_a: string | null;
  chapter_a: number | null;
  verse_a: number | null;
  entry_id_a: number | null;
  book_b: string | null;
  chapter_b: number | null;
  verse_b: number | null;
  entry_id_b: number | null;
  highlighter_id: number | null;
  created_at: string;
}

// A link joined with each endpoint's display text + associated highlighter.
// source_id_a/b, source_title_a/b, and position_ref_a/b are only populated
// for entry-anchored endpoints (an entry has no book/chapter/verse label).
export interface LinkRow extends Link {
  text_a: string;
  text_b: string;
  source_id_a: number | null;
  source_id_b: number | null;
  source_title_a: string | null;
  source_title_b: string | null;
  position_ref_a: string | null;
  position_ref_b: string | null;
  color: string | null;
  label: string | null;
}

// A clicked paragraph/section in an imported (freeform) pane — the
// entry-anchored counterpart to SelectedVerse, used to build notes,
// highlights, and links from imported text.
export interface SelectedEntry {
  entryId: number;
  sourceId: number;
  sourceTitle: string;
  positionRef: string | null;
  text: string;
}

// A translator's note (alternate reading, literal Hebrew/Greek rendering,
// explanation) captured from the OSIS source. Anchored after a specific
// tagged word via word_index, or verse-level when word_index is NULL.
// Additive like strongs_words — never part of entries.text.
export interface EntryNote {
  id: number;
  entry_id: number;
  word_index: number | null;
  note_text: string;
  note_type: string | null;
}

// A smart-search hit: a verse where the searched surface text (e.g. "love",
// "loved") was tagged with this particular Strong's number.
export interface StrongsSearchHit {
  entry_id: number;
  word_index: number;
  entry_text: string;
  book: string;
  chapter: number;
  verse: number;
  source_id: number;
  source_title: string;
}

export interface StrongsBookCount {
  book: string;
  count: number;
}

// A concordance group is pure aggregates — true totals computed in SQL with
// no row cap, so 6,000-occurrence words report correctly. The actual verse
// hits are fetched lazily per book when a book header is expanded
// (strongsSearchHitsForBook), never all at once.
export interface StrongsSearchGroup {
  strongs_number: string;
  dict: StrongsDictEntry | null;
  total: number;
  books: StrongsBookCount[];
}

// Full-text search results: hits are capped per source (not globally, so
// one dominant source can't crowd the others out) alongside each source's
// true total for honest header counts.
export interface SearchResults {
  hits: SearchHit[];
  entryTotals: { source_title: string; total: number }[];
}
