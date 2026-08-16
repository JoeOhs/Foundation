import type { Note } from './types';

// Human label for a note's anchor — shown on note cards and in the export
// heading. Single source of truth so the wording can't drift between the
// two call sites (it did once, on the "Freeform" rename).
export function anchorLabel(n: Note): string {
  if (n.anchor_book && n.anchor_verse != null) return `${n.anchor_book} ${n.anchor_chapter}:${n.anchor_verse}`;
  if (n.anchor_book && n.anchor_chapter != null) return `${n.anchor_book} ${n.anchor_chapter} (chapter)`;
  if (n.anchor_book) return `${n.anchor_book} (book)`;
  if (n.entry_id != null) return 'Imported text';
  return 'Freeform';
}

// Collapsed one-line summary: the title, or the first meaningful line of
// content with its Markdown syntax stripped. Shared by the note list and
// the export picker so a note reads the same in both.
export function notePreview(n: Note): string {
  if (n.title) return n.title;
  const line = n.content.split('\n').find((l) => l.trim()) ?? '';
  return line.replace(/[#>*_`~]/g, '').replace(/^\s*[-+]\s+/, '').trim().slice(0, 60) || '(empty note)';
}
