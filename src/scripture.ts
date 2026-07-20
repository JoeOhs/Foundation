import type { SelectedVerse } from './types';

// A human reference for a run of selected verses: "John 3:16", "John
// 3:16-18", or "John 3:16, 18" when the selection has gaps.
export function versesReference(verses: SelectedVerse[]): string {
  if (verses.length === 0) return '';
  const { book, chapter } = verses[0];
  const nums = verses.map((v) => v.verse).sort((a, b) => a - b);
  const runs: string[] = [];
  let runStart = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    if (i < nums.length && nums[i] === prev + 1) {
      prev = nums[i];
      continue;
    }
    runs.push(runStart === prev ? `${runStart}` : `${runStart}-${prev}`);
    if (i < nums.length) {
      runStart = nums[i];
      prev = nums[i];
    }
  }
  return `${book} ${chapter}:${runs.join(', ')}`;
}

// Render selected verses as a markdown blockquote suitable for insertion
// into a note: a bold reference + source, then each verse (numbered when
// more than one). Verses are ordered by number regardless of click order.
export function versesToMarkdown(verses: SelectedVerse[]): string {
  if (verses.length === 0) return '';
  const ordered = [...verses].sort((a, b) => a.verse - b.verse);
  const ref = versesReference(ordered);
  const source = ordered[0].sourceTitle ? ` — ${ordered[0].sourceTitle}` : '';
  const lines = ordered.map((v) => {
    const num = ordered.length > 1 ? `**${v.verse}** ` : '';
    return `> ${num}${v.text.trim()}`;
  });
  return `> **${ref}**${source}\n>\n${lines.join('\n')}`;
}
