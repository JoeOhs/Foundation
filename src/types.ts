export type SourceType = 'bible' | 'commentary' | 'extra-biblical' | 'reference';

export interface Source {
  id: number;
  title: string;
  type: SourceType;
  language: string | null;
  license_note: string | null;
  is_verse_keyed: number; // 0/1 — 0 for freeform library imports (e.g. EPUB)
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

// One table-of-contents entry parsed from an EPUB's nav.xhtml/toc.ncx.
// entryIndex indexes into the flattened, in-order list of entries across
// all of ParsedSource.books[0].entries (EPUB imports produce a single
// book) — resolved to a real entries.id at insert time. -1 if the TOC
// pointed at a target no entry could be matched to.
export interface ParsedTocEntry {
  title: string;
  level: number;
  entryIndex: number;
}

// A toc_entries row read back from the DB (future reading-pane TOC dropdown).
export interface TocEntryRow {
  id: number;
  source_id: number;
  entry_id: number | null;
  title: string;
  level: number;
  position_ref: string | null;
  sort_order: number;
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
