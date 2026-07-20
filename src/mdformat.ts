// Pure markdown string-manipulation helpers for the editor toolbar. Kept
// free of any DOM/library dependency (marked, DOMPurify) so they're trivial
// to test and cheap to import.

export interface WrapResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
}

// Wrap the current selection with before/after markers (bold, italic,
// code…). With no selection, inserts the markers around a placeholder and
// selects it so the user can type over it.
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after: string,
  placeholder = 'text',
): WrapResult {
  const selected = value.slice(start, end) || placeholder;
  const text = value.slice(0, start) + before + selected + after + value.slice(end);
  return {
    text,
    selectionStart: start + before.length,
    selectionEnd: start + before.length + selected.length,
  };
}

// Prefix each line of the selection (or the current line) with a marker,
// optionally numbering for ordered lists.
export function prefixLines(
  value: string,
  start: number,
  end: number,
  marker: string | ((i: number) => string),
): WrapResult {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = value.indexOf('\n', end);
  const blockEnd = lineEnd === -1 ? value.length : lineEnd;
  const block = value.slice(lineStart, blockEnd);
  const prefixed = block
    .split('\n')
    .map((line, i) => (typeof marker === 'function' ? marker(i) : marker) + line)
    .join('\n');
  const text = value.slice(0, lineStart) + prefixed + value.slice(blockEnd);
  return { text, selectionStart: lineStart, selectionEnd: lineStart + prefixed.length };
}
