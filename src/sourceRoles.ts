// How a source behaves in the UI. These were one test (`type !== 'bible'`)
// until the Companion Bible's verse-keyed notes arrived, which needs the two
// halves separately: it reads alongside a translation like a Bible, but its
// annotations attach to its own entries like an imported text.
//
// Kept together so the three call sites (Pane, SyncMenu, App) can't drift.

import type { Source } from './types';

// Navigates by book/chapter: it follows a reference rather than being read
// straight through, so it gets the source/book/chapter selectors and may
// join a sync group. True for Bible translations, for verse-keyed
// commentaries, and for footer commentaries — the last of which follow
// Pane 1's reference from the study footer rather than from a pane of their
// own (see isFooterOnly).
export function isNavigable(source: Source): boolean {
  return source.type === 'bible' || source.is_verse_keyed === 1;
}

// Lives in the study footer and never in a reading pane: excluded from every
// pane's source picker, so it can't be opened as one.
//
// This is the half of "navigable" that JFB does not want. A footer
// commentary tracks Pane 1's book and chapter exactly like a translation
// does — that's why isNavigable stays true — but its home is the
// Commentary tab, a horizontal strip of verse cells under the reading
// panes, not a column beside them. Contrast the Companion Bible's notes,
// which are also verse-keyed but are read in their own pane.
export function isFooterOnly(source: Source): boolean {
  return source.type === 'footer-commentary';
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
//
// The isFooterOnly term is belt-and-braces: a footer commentary is
// verse-keyed, so isNavigable already excludes it. Stated anyway so "footer
// commentaries never occupy a pane" doesn't quietly depend on
// is_verse_keyed staying 1 for them.
export function isDedicatedPane(source: Source): boolean {
  return !isNavigable(source) && !isFooterOnly(source);
}
