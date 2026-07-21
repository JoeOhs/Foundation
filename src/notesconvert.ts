import { stripRtf } from './importer';
import type { Note } from './types';

function anchorLabel(n: Note): string {
  if (n.anchor_book && n.anchor_verse != null) return `${n.anchor_book} ${n.anchor_chapter}:${n.anchor_verse}`;
  if (n.anchor_book && n.anchor_chapter != null) return `${n.anchor_book} ${n.anchor_chapter} (chapter)`;
  if (n.anchor_book) return `${n.anchor_book} (book)`;
  return 'Freeform';
}

// One human-readable, re-importable markdown document for all notes: each
// note is a section headed by its anchor reference, `---` between them.
export function notesToMarkdownExport(notes: Note[]): string {
  const date = new Date().toISOString().slice(0, 10);
  const header = `# Foundation Notes\n\n_Exported ${date} · ${notes.length} note${notes.length === 1 ? '' : 's'}_\n`;
  const body = notes
    .map((n) => {
      const title = n.title ? `### ${n.title}\n\n` : '';
      return `## ${anchorLabel(n)}\n\n${title}${n.content.trim()}\n`;
    })
    .join('\n---\n\n');
  return `${header}\n${body}`;
}

// Minimal HTML→Markdown for legacy note imports. Uses DOMParser (available
// in the webview), walking common block/inline tags; anything unrecognized
// contributes its text content, so nothing is silently dropped.
export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const inner = Array.from(el.childNodes).map(walk).join('');
    switch (el.tagName) {
      case 'H1': return `\n# ${inner.trim()}\n\n`;
      case 'H2': return `\n## ${inner.trim()}\n\n`;
      case 'H3': return `\n### ${inner.trim()}\n\n`;
      case 'H4': case 'H5': case 'H6': return `\n#### ${inner.trim()}\n\n`;
      case 'P': return `${inner.trim()}\n\n`;
      case 'BR': return '\n';
      case 'STRONG': case 'B': return inner.trim() ? `**${inner.trim()}**` : '';
      case 'EM': case 'I': return inner.trim() ? `*${inner.trim()}*` : '';
      case 'A': {
        const href = el.getAttribute('href');
        return href ? `[${inner.trim()}](${href})` : inner;
      }
      case 'LI': {
        const ordered = el.parentElement?.tagName === 'OL';
        return `${ordered ? '1.' : '-'} ${inner.trim()}\n`;
      }
      case 'UL': case 'OL': return `${inner}\n`;
      case 'BLOCKQUOTE':
        return `${inner.trim().split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
      case 'CODE': return `\`${inner}\``;
      case 'PRE': return `\n\`\`\`\n${inner.trim()}\n\`\`\`\n\n`;
      case 'HR': return `\n---\n\n`;
      default: return inner;
    }
  };
  return walk(doc.body).replace(/\n{3,}/g, '\n\n').trim();
}

// Convert one imported legacy file to a markdown note body, by extension.
export function legacyToMarkdown(filename: string, raw: string): { title: string; content: string } {
  const base = filename.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
  const ext = (filename.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  let content: string;
  if (ext === 'rtf') content = stripRtf(raw);
  else if (ext === 'html' || ext === 'htm') content = htmlToMarkdown(raw);
  else content = raw; // md, markdown, txt, or unknown — treat as markdown
  return { title: base, content: content.trim() };
}
