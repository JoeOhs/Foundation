import { marked } from 'marked';
import DOMPurify from 'dompurify';

export { wrapSelection, prefixLines, type WrapResult } from './mdformat';

// GFM plus `breaks` so a single newline becomes <br> — this makes both
// note-taking natural and legacy plain-text notes (which used raw line
// breaks) render as written without needing double newlines everywhere.
marked.setOptions({ gfm: true, breaks: true });

// Notes are the user's own local content, but they can also be imported
// from legacy files, so render through DOMPurify before injecting. marked
// parses synchronously with these options; cast covers its string|Promise
// signature.
export function renderMarkdown(md: string): string {
  const html = marked.parse(md ?? '', { async: false }) as string;
  return DOMPurify.sanitize(html);
}
