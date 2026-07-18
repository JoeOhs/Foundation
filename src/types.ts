export type SourceType = 'bible' | 'commentary' | 'extra-biblical' | 'reference';

export interface Source {
  id: number;
  title: string;
  type: SourceType;
  language: string | null;
  license_note: string | null;
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

export interface StrongsSearchGroup {
  strongs_number: string;
  dict: StrongsDictEntry | null;
  hits: StrongsSearchHit[];
}
