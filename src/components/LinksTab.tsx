import { useCallback, useEffect, useState } from 'react';
import { deleteLink, listHighlighters, listLinks, setLinkHighlighter } from '../db';
import { emitLinksChanged } from '../notesbus';
import { highlightBackground } from './Pane';
import NoteTargetMenu from './NoteTargetMenu';
import { linkRowToMarkdown } from '../scripture';
import type { Highlighter, LinkRow, SelectedEntry } from '../types';

interface LinksTabProps {
  onNavigate: (book: string, chapter: number, verse: number) => void;
  onNavigateEntry: (sourceId: number, entryId: number, entry?: SelectedEntry) => void;
  version: number;
  onChanged: () => void;
  onNoteAdded: () => void;
}

// A link endpoint's display label and navigation target, dispatching on
// whether it's a canonical verse or an imported entry.
function endpointLabel(l: LinkRow, kind: 'a' | 'b'): string {
  const entryId = kind === 'a' ? l.entry_id_a : l.entry_id_b;
  if (entryId !== null) {
    const positionRef = kind === 'a' ? l.position_ref_a : l.position_ref_b;
    const sourceTitle = kind === 'a' ? l.source_title_a : l.source_title_b;
    return positionRef ?? sourceTitle ?? '';
  }
  const book = kind === 'a' ? l.book_a : l.book_b;
  const chapter = kind === 'a' ? l.chapter_a : l.chapter_b;
  const verse = kind === 'a' ? l.verse_a : l.verse_b;
  return `${book} ${chapter}:${verse}`;
}

export default function LinksTab({ onNavigate, onNavigateEntry, version, onChanged, onNoteAdded }: LinksTabProps) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [highlighters, setHighlighters] = useState<Highlighter[]>([]);

  const reload = useCallback(async () => {
    setLinks(await listLinks());
    setHighlighters(await listHighlighters());
  }, []);
  useEffect(() => { reload(); }, [reload, version]);

  const changed = () => { emitLinksChanged(); onChanged(); reload(); };

  const loose = async (l: LinkRow) => {
    try {
      await deleteLink(l.id);
      changed();
    } catch (e) {
      window.alert(`Couldn't remove this link: ${String(e)}`);
    }
  };

  const associate = async (l: LinkRow, highlighterId: number | null) => {
    try {
      await setLinkHighlighter(l.id, l.highlighter_id === highlighterId ? null : highlighterId);
      changed();
    } catch (e) {
      window.alert(`Couldn't update this link: ${String(e)}`);
    }
  };

  const navigateEndpoint = (l: LinkRow, kind: 'a' | 'b') => {
    const entryId = kind === 'a' ? l.entry_id_a : l.entry_id_b;
    if (entryId !== null) {
      const sourceId = (kind === 'a' ? l.source_id_a : l.source_id_b) as number;
      const text = kind === 'a' ? l.text_a : l.text_b;
      const positionRef = kind === 'a' ? l.position_ref_a : l.position_ref_b;
      const sourceTitle = kind === 'a' ? l.source_title_a : l.source_title_b;
      onNavigateEntry(sourceId, entryId, { entryId, sourceId, sourceTitle: sourceTitle ?? '', positionRef, text });
    } else {
      const book = kind === 'a' ? l.book_a : l.book_b;
      const chapter = kind === 'a' ? l.chapter_a : l.chapter_b;
      const verse = kind === 'a' ? l.verse_a : l.verse_b;
      onNavigate(book as string, chapter as number, verse as number);
    }
  };

  return (
    <div className="links-tab">
      {links.length === 0 && (
        <div className="pane-empty">
          No links yet. Select a verse or an imported section, click 🔗 Link in the action bar, then select another and Bind them.
        </div>
      )}
      {links.map((l) => (
        <div className="link-item" key={l.id} style={l.color ? { borderColor: l.color } : undefined}>
          <div className="link-endpoints">
            <button className="link-ref" onClick={() => navigateEndpoint(l, 'a')} title={l.text_a}>
              {endpointLabel(l, 'a')}
            </button>
            <span className="link-arrow">🔗</span>
            <button className="link-ref" onClick={() => navigateEndpoint(l, 'b')} title={l.text_b}>
              {endpointLabel(l, 'b')}
            </button>
          </div>
          {(l.text_a || l.text_b) && (
            <div className="link-texts">
              {l.text_a && <div className="link-text-snippet">{l.text_a}</div>}
              {l.text_b && <div className="link-text-snippet">{l.text_b}</div>}
            </div>
          )}
          <div className="link-actions">
            <span className="link-associate" title="Associate a highlighter color">
              {highlighters.map((h) => (
                <button
                  key={h.id}
                  className={`hl-swatch${l.highlighter_id === h.id ? ' picked' : ''}`}
                  style={{ background: highlightBackground(h.color), borderColor: h.color }}
                  onClick={() => associate(l, h.id)}
                  title={h.label}
                />
              ))}
            </span>
            <span className="spacer" />
            <NoteTargetMenu buildMarkdown={() => linkRowToMarkdown(l)} onAdded={onNoteAdded} />
            <button className="danger" onClick={() => loose(l)} title="Remove this link">Loose</button>
          </div>
        </div>
      ))}
    </div>
  );
}
