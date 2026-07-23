import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  addHighlighter, deleteHighlighter, listHighlighters, listHighlights,
  removeHighlight, removeHighlightEntry, updateHighlighter,
} from '../db';
import { emitHighlightsChanged } from '../notesbus';
import { requestConfirm } from '../confirmBus';
import { highlightBackground } from './Pane';
import NoteTargetMenu from './NoteTargetMenu';
import { entryToMarkdown, versesToMarkdown } from '../scripture';
import type { Highlighter, HighlightRow, SelectedEntry } from '../types';

interface HighlightsTabProps {
  // navigate the reader to a highlighted verse
  onNavigate: (book: string, chapter: number, verse: number) => void;
  // navigate the reader to a highlighted imported entry
  onNavigateEntry: (sourceId: number, entryId: number, entry?: SelectedEntry) => void;
  // bumped externally when highlights change elsewhere (reader, other window)
  version: number;
  onChanged: () => void;
  // a note was created/appended from here — refresh the Notes tab + dots
  onNoteAdded: () => void;
}

// The palette colors offered when adding/recoloring a highlighter.
const PALETTE = ['#f2c200', '#4caf50', '#4a90d9', '#e0669e', '#ef8b3b', '#9b6cd8', '#e5533c', '#20b2aa'];

// An entry-anchored HighlightRow reshaped into a SelectedEntry, for
// building note markdown / navigating the reader to it.
function rowToSelectedEntry(r: HighlightRow): SelectedEntry {
  return {
    entryId: r.entry_id as number,
    sourceId: r.entry_source_id as number,
    sourceTitle: r.entry_source_title ?? '',
    positionRef: r.entry_position_ref,
    text: r.text,
  };
}

export default function HighlightsTab({ onNavigate, onNavigateEntry, version, onChanged, onNoteAdded }: HighlightsTabProps) {
  const [highlighters, setHighlighters] = useState<Highlighter[]>([]);
  const [rows, setRows] = useState<HighlightRow[]>([]);
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
    try {
      await updateHighlighter(editingId, editLabel.trim() || 'Highlighter', editColor);
      setEditingId(null);
      changed();
    } catch (e) {
      window.alert(`Couldn't save the highlighter: ${String(e)}`);
    }
  };
  const removeHighlighter = async (h: Highlighter) => {
    if (!await requestConfirm(`Delete the "${h.label}" highlighter and all verses highlighted with it?`)) return;
    try {
      await deleteHighlighter(h.id);
      if (editingId === h.id) setEditingId(null);
      changed();
    } catch (e) {
      window.alert(`Couldn't delete the highlighter: ${String(e)}`);
    }
  };
  const addNew = async () => {
    try {
      const used = new Set(highlighters.map((h) => h.color));
      const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[0];
      await addHighlighter('New highlighter', color);
      changed();
    } catch (e) {
      window.alert(`Couldn't add a highlighter: ${String(e)}`);
    }
  };

  const unhighlight = async (r: HighlightRow) => {
    try {
      if (r.entry_id !== null) await removeHighlightEntry(r.entry_id);
      else await removeHighlight(r.book as string, r.chapter as number, r.verse as number);
      changed();
    } catch (e) {
      window.alert(`Couldn't remove the highlight: ${String(e)}`);
    }
  };

  const rowMarkdown = (r: HighlightRow) =>
    r.entry_id !== null
      ? entryToMarkdown(rowToSelectedEntry(r))
      : versesToMarkdown([{ book: r.book as string, chapter: r.chapter as number, verse: r.verse as number, text: r.text, sourceTitle: '' }]);

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
                  onClick={() => r.entry_id !== null
                    ? onNavigateEntry(r.entry_source_id as number, r.entry_id, rowToSelectedEntry(r))
                    : onNavigate(r.book as string, r.chapter as number, r.verse as number)}
                  title={r.entry_id !== null ? 'Go to section' : 'Go to verse'}
                >
                  <div className="hl-item-ref">
                    {r.entry_id !== null ? (r.entry_position_ref ?? r.entry_source_title) : `${r.book} ${r.chapter}:${r.verse}`}
                  </div>
                  {r.text && <div className="hl-item-text">{r.text}</div>}
                </div>
                <div className="hl-item-actions">
                  <NoteTargetMenu buildMarkdown={() => rowMarkdown(r)} onAdded={onNoteAdded} />
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
