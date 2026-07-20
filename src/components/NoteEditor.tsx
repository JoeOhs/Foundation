import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { renderMarkdown } from '../markdown';
import { prefixLines, wrapSelection, type WrapResult } from '../mdformat';

export interface NoteEditorHandle {
  insertAtCursor: (text: string) => void;
  focus: () => void;
}

interface NoteEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
}

// A lightweight markdown editor: a formatting toolbar over a textarea, with
// a Write/Preview toggle. Stores plain markdown; the toolbar inserts syntax
// rather than doing WYSIWYG, which keeps it small and predictable.
const NoteEditor = forwardRef<NoteEditorHandle, NoteEditorProps>(
  ({ value, onChange, placeholder, minHeight = 160 }, ref) => {
    const taRef = useRef<HTMLTextAreaElement>(null);
    const [tab, setTab] = useState<'write' | 'preview'>('write');

    const apply = (fn: (v: string, s: number, e: number) => WrapResult) => {
      const ta = taRef.current;
      if (!ta) return;
      const { text, selectionStart, selectionEnd } = fn(ta.value, ta.selectionStart, ta.selectionEnd);
      onChange(text);
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(selectionStart, selectionEnd);
      });
    };

    const wrap = (before: string, after: string, ph?: string) =>
      apply((v, s, e) => wrapSelection(v, s, e, before, after, ph));
    const prefix = (marker: string | ((i: number) => string)) =>
      apply((v, s, e) => prefixLines(v, s, e, marker));

    useImperativeHandle(ref, () => ({
      insertAtCursor: (text: string) => {
        const ta = taRef.current;
        if (!ta) {
          // editor not mounted on the write tab — append instead of losing it
          onChange((value ? `${value}\n\n` : '') + text);
          return;
        }
        const s = ta.selectionStart;
        const e = ta.selectionEnd;
        const needsGap = s > 0 && ta.value[s - 1] !== '\n';
        const insert = (needsGap ? '\n\n' : '') + text;
        const next = ta.value.slice(0, s) + insert + ta.value.slice(e);
        onChange(next);
        requestAnimationFrame(() => {
          ta.focus();
          const pos = s + insert.length;
          ta.setSelectionRange(pos, pos);
        });
      },
      focus: () => taRef.current?.focus(),
    }));

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.ctrlKey || e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); wrap('**', '**', 'bold'); }
        else if (k === 'i') { e.preventDefault(); wrap('*', '*', 'italic'); }
        else if (k === 'k') { e.preventDefault(); wrap('[', '](url)', 'link text'); }
      }
    };

    return (
      <div className="md-editor">
        <div className="md-toolbar">
          <button type="button" title="Bold (Ctrl+B)" onClick={() => wrap('**', '**', 'bold')}><b>B</b></button>
          <button type="button" title="Italic (Ctrl+I)" onClick={() => wrap('*', '*', 'italic')}><i>I</i></button>
          <button type="button" title="Heading" onClick={() => prefix('## ')}>H</button>
          <button type="button" title="Quote" onClick={() => prefix('> ')}>❝</button>
          <button type="button" title="Bulleted list" onClick={() => prefix('- ')}>•</button>
          <button type="button" title="Numbered list" onClick={() => prefix((i) => `${i + 1}. `)}>1.</button>
          <button type="button" title="Link (Ctrl+K)" onClick={() => wrap('[', '](url)', 'link text')}>🔗</button>
          <button type="button" title="Inline code" onClick={() => wrap('`', '`', 'code')}>{'</>'}</button>
          <span className="md-toolbar-spacer" />
          <button
            type="button"
            className={`md-tab${tab === 'write' ? ' active' : ''}`}
            onClick={() => setTab('write')}
          >
            Write
          </button>
          <button
            type="button"
            className={`md-tab${tab === 'preview' ? ' active' : ''}`}
            onClick={() => setTab('preview')}
          >
            Preview
          </button>
        </div>
        {tab === 'write' ? (
          <textarea
            ref={taRef}
            className="md-textarea"
            style={{ minHeight }}
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
        ) : (
          <div
            className="md-preview note-md"
            style={{ minHeight }}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(value || '_Nothing to preview yet._') }}
          />
        )}
      </div>
    );
  },
);

NoteEditor.displayName = 'NoteEditor';
export default NoteEditor;
