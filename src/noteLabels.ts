import type { Note } from './types';

// Human label for a note's anchor — shown on note cards and in the export
// heading. Single source of truth so the wording can't drift between the
// two call sites (it did once, on the "Freeform" rename).
export function anchorLabel(n: Note): string {
  if (n.anchor_book && n.anchor_verse != null) return `${n.anchor_book} ${n.anchor_chapter}:${n.anchor_verse}`;
  if (n.anchor_book && n.anchor_chapter != null) return `${n.anchor_book} ${n.anchor_chapter} (chapter)`;
  if (n.anchor_book) return `${n.anchor_book} (book)`;
  return 'Freeform';
}
