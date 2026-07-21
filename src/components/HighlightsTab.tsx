import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addHighlighter, deleteHighlighter, listHighlighters, listHighlights, removeHighlight, updateHighlighter,
} from '../db';
import { emitHighlightsChanged } from '../notesbus';
import { highlightBackground } from './Pane';
import { versesToMarkdown } from '../scripture';
import type { Highlighter, HighlightRow } from '../types';

interface HighlightsTabProps {
  // navigate the reader to a highlighted verse
  onNavigate: (book: string, chapter: number, verse: number) => void;
  // bumped externally when highlights change elsewhere (reader, other window)
  version: number;
  onChanged: () => void;
}

// The palette colors offered when adding/recoloring a highlighter.
const PALETTE = ['#f2c200', '#4caf50', '#4a90d9', '#e0669e', '#ef8b3b', '#9b6cd8', '#e5533c', '#20b2aa'];

export default function HighlightsTab({ onNavigate, version, onChanged }: HighlightsTabProps) {
  const [highlighters, setHighlighters] = useState<Highlighter[]>([]);
  const [rows, setRows] = useState<(HighlightRow & { text: string })[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editColor, setEditColor] = useState('');

  const reload = useCallback(async () => {
    setHighlighters(await listHighlighters());
    setRows(await listHighlights());
  }, []);

  useEffect(() => { reload(); }, [reload, version]);

  const changed = () => { emitHighlightsChanged(); onChanged(); reload(); };

  const startEdit = (h: Highlighter) => {
    setEditingId(h.id);
    setEditLabel(h.label);
    setEditColor(h.color);
  };
  const saveEdit = async () => {
    if (editingId === null) return;
    await updateHighlighter(editingId, editLabel.trim() || 'Highlighter', editColor);
    setEditingId(null);
    changed();
  };
  const removeHighlighter = async (h: Highlighter) => {
    if (!window.confirm(`Delete the "${h.label}" highlighter and all verses highlighted with it?`)) return;
    await deleteHighlighter(h.id);
    if (editingId === h.id) setEditingId(null);
    changed();
  };
  const addNew = async () => {
    const used = new Set(highlighters.map((h) => h.color));
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[0];
    await addHighlighter('New highlighter', color);
    changed();
  };

  const unhighlight = async (r: HighlightRow) => {
    await removeHighlight(r.book, r.chapter, r.verse);
    changed();
  };

  const addToNote = (r: HighlightRow & { text: string }) => {
    const md = versesToMarkdown([{ book: r.book, chapter: r.chapter, verse: r.verse, text: r.text, sourceTitle: '' }]);
    window.dispatchEvent(new CustomEvent('foundation:insert-note-md', { detail: md }));
  };

  // group highlighted verses under their highlighter
  const groups = useMemo(() => {
    return highlighters
      .map((h) => ({ highlighter: h, verses: rows.filter((r) => r.highlighter_id === h.id) }))
      .filter((g) => g.verses.length > 0);
  }, [highlighters, rows]);

  return (
    <div className="highlights-tab">
      <div className="hl-manager">
        <div className="hl-manager-head">
          <span className="search-group-label" style={{ padding: 0 }}>Highlighters</span>
          <button className="icon" onClick={addNew} title="Add a highlighter">＋</button>
        </div>
        {highlighters.map((h) => (
          <div className="hl-manager-row" key={h.id}>
            {editingId === h.id ? (
              <>
                <span className="hl-palette">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      className={`hl-swatch${editColor === c ? ' picked' : ''}`}
                      style={{ background: highlightBackground(c), borderColor: c }}
                      onClick={() => setEditColor(c)}
                    />
                  ))}
                </span>
                <input
                  className="hl-label-input"
                  value={editLabel}
                  autoFocus
                  onChange={(e) => setEditLabel(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditingId(null); }}
                />
                <button onClick={saveEdit}>Save</button>
              </>
            ) : (
              <>
                <span className="hl-swatch" style={{ background: highlightBackground(h.color), borderColor: h.color }} />
                <span className="hl-manager-label">{h.label}</span>
                <button className="icon" onClick={() => startEdit(h)} title="Edit">✎</button>
                <button className="icon danger" onClick={() => removeHighlighter(h)} title="Delete">🗑</button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="hl-list">
        {rows.length === 0 && (
          <div className="pane-empty">
            No highlights yet. Select verses in the reader and pick a highlighter color.
          </div>
        )}
        {groups.map(({ highlighter, verses }) => (
          <div key={highlighter.id} className="hl-group">
            <div className="hl-group-head">
              <span className="hl-swatch" style={{ background: highlightBackground(highlighter.color), borderColor: highlighter.color }} />
              {highlighter.label} · {verses.length}
            </div>
            {verses.map((r) => (
              <div className="hl-item" key={r.id}>
                <div
                  className="hl-item-main"
                  style={{ background: highlightBackground(r.color) }}
                  onClick={() => onNavigate(r.book, r.chapter, r.verse)}
                  title="Go to verse"
                >
                  <div className="hl-item-ref">{r.book} {r.chapter}:{r.verse}</div>
                  {r.text && <div className="hl-item-text">{r.text}</div>}
                </div>
                <div className="hl-item-actions">
                  <button onClick={() => addToNote(r)} title="Add to the open note">✎ Note</button>
                  <button className="danger" onClick={() => unhighlight(r)} title="Remove highlight">Remove</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
