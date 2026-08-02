// How a source behaves in the UI. These were one test (`type !== 'bible'`)
// until the Companion Bible's verse-keyed notes arrived, which needs the two
// halves separately: it reads alongside a translation like a Bible, but its
// annotations attach to its own entries like an imported text.
//
// Kept together so the three call sites (Pane, SyncMenu, App) can't drift.

import type { Source } from './types';

// Navigates by book/chapter: gets the source/book/chapter selectors, appears
// in a pane's source picker, and may join a sync group. True for Bible
// translations and for verse-keyed commentaries.
export function isNavigable(source: Source): boolean {
  return source.type === 'bible' || source.is_verse_keyed === 1;
}

// Highlights/links/notes attach to a specific entries row rather than to a
// canonical verse. True for everything that isn't a Bible translation.
//
// This is what keeps a commentary's marks off the KJV: deleteSource only
// removes entry-anchored rows, so a verse-anchored commentary highlight
// would outlive its source and show up on every translation.
export function isEntryAnchored(source: Source): boolean {
  return source.type !== 'bible';
}

// Freeform imports (EPUB and similar) get their own dedicated, always-solo
// pane pinned to the right, rather than being picked in a Bible pane.
export function isDedicatedPane(source: Source): boolean {
  return !isNavigable(source);
}
