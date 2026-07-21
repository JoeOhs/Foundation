import { useCallback, useEffect, useState } from 'react';
import { deleteLink, listHighlighters, listLinks, setLinkHighlighter } from '../db';
import { emitLinksChanged } from '../notesbus';
import { highlightBackground } from './Pane';
import NoteTargetMenu from './NoteTargetMenu';
import { linkToMarkdown } from '../scripture';
import type { Highlighter, LinkRow } from '../types';

interface LinksTabProps {
  onNavigate: (book: string, chapter: number, verse: number) => void;
  version: number;
  onChanged: () => void;
  onNoteAdded: () => void;
}

export default function LinksTab({ onNavigate, version, onChanged, onNoteAdded }: LinksTabProps) {
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

  const linkMarkdown = (l: LinkRow) =>
    linkToMarkdown(
      { book: l.book_a, chapter: l.chapter_a, verse: l.verse_a, text: l.text_a, sourceTitle: '' },
      { book: l.book_b, chapter: l.chapter_b, verse: l.verse_b, text: l.text_b, sourceTitle: '' },
    );

  return (
    <div className="links-tab">
      {links.length === 0 && (
        <div className="pane-empty">
          No links yet. Select a verse, click 🔗 Link in the action bar, then select another verse and Bind them.
        </div>
      )}
      {links.map((l) => (
        <div className="link-item" key={l.id} style={l.color ? { borderColor: l.color } : undefined}>
          <div className="link-endpoints">
            <button className="link-ref" onClick={() => onNavigate(l.book_a, l.chapter_a, l.verse_a)} title={l.text_a}>
              {l.book_a} {l.chapter_a}:{l.verse_a}
            </button>
            <span className="link-arrow">🔗</span>
            <button className="link-ref" onClick={() => onNavigate(l.book_b, l.chapter_b, l.verse_b)} title={l.text_b}>
              {l.book_b} {l.chapter_b}:{l.verse_b}
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
            <NoteTargetMenu buildMarkdown={() => linkMarkdown(l)} onAdded={onNoteAdded} />
            <button className="danger" onClick={() => loose(l)} title="Remove this link">Loose</button>
          </div>
        </div>
      ))}
    </div>
  );
}
