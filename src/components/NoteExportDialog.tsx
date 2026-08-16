import { useEffect, useMemo, useState } from 'react';
import { allNotes } from '../db';
import { anchorLabel, notePreview } from '../noteLabels';
import type { Note } from '../types';

interface NoteExportDialogProps {
  onExport: (notes: Note[]) => void;
  onClose: () => void;
}

// Picks which notes go into the Markdown export. Defaults to everything
// selected, so "export all" stays one click (Export) rather than a chore of
// ticking boxes, while any subset is a few clicks away.
export default function NoteExportDialog({ onExport, onClose }: NoteExportDialogProps) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState('');

  useEffect(() => {
    let live = true;
    allNotes()
      .then((rows) => {
        if (!live) return;
        setNotes(rows);
        setSelected(new Set(rows.map((n) => n.id)));
      })
      .catch(() => { if (live) setNotes([]); });
    return () => { live = false; };
  }, []);

  // Grouped by the same anchor label the export file uses as its headings,
  // so what you tick here maps onto what you'll read in the file.
  const groups = useMemo(() => {
    if (!notes) return [];
    const q = filter.trim().toLowerCase();
    const map = new Map<string, Note[]>();
    for (const n of notes) {
      const label = anchorLabel(n);
      if (q && !label.toLowerCase().includes(q) && !notePreview(n).toLowerCase().includes(q)
        && !n.content.toLowerCase().includes(q)) continue;
      if (!map.has(label)) map.set(label, []);
      map.get(label)!.push(n);
    }
    return [...map.entries()];
  }, [notes, filter]);

  const visibleIds = useMemo(() => groups.flatMap(([, ns]) => ns.map((n) => n.id)), [groups]);
  const selectedVisible = visibleIds.filter((id) => selected.has(id)).length;

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const setMany = (ids: number[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  };

  const chosen = notes?.filter((n) => selected.has(n.id)) ?? [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Export notes</h2>
          <input
            type="search"
            placeholder="Filter by reference or text…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: '0 1 260px' }}
          />
        </div>

        <div className="export-toolbar">
          <button onClick={() => setMany(visibleIds, true)} disabled={selectedVisible === visibleIds.length}>
            Select all{filter ? ' shown' : ''}
          </button>
          <button onClick={() => setMany(visibleIds, false)} disabled={selectedVisible === 0}>
            Select none{filter ? ' shown' : ''}
          </button>
          <span className="spacer" />
          <span className="export-count">
            {notes === null ? 'Loading…' : `${selected.size} of ${notes.length} selected`}
          </span>
        </div>

        <div className="modal-body">
          {notes !== null && notes.length === 0 && (
            <div className="pane-empty">No notes to export yet.</div>
          )}
          {notes !== null && notes.length > 0 && groups.length === 0 && (
            <div className="pane-empty">No notes match “{filter}”.</div>
          )}
          {groups.map(([label, groupNotes]) => {
            const ids = groupNotes.map((n) => n.id);
            const allOn = ids.every((id) => selected.has(id));
            return (
              <div key={label} className="export-group">
                <label className="export-group-head">
                  <input
                    type="checkbox"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = !allOn && ids.some((id) => selected.has(id));
                    }}
                    onChange={() => setMany(ids, !allOn)}
                  />
                  <span className="export-group-label">{label}</span>
                  <span className="export-group-count">{groupNotes.length}</span>
                </label>
                {groupNotes.map((n) => (
                  <label key={n.id} className="export-row">
                    <input type="checkbox" checked={selected.has(n.id)} onChange={() => toggle(n.id)} />
                    <span className="export-row-title">
                      {n.pinned ? '📌 ' : ''}{notePreview(n)}
                    </span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>

        <div className="modal-footer">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={chosen.length === 0} onClick={() => onExport(chosen)}>
            Export {chosen.length > 0 ? `${chosen.length} ` : ''}note{chosen.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
