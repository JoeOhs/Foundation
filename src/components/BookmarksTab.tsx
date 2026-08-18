import { useCallback, useEffect, useRef, useState } from 'react';
import { addBookmark, listBookmarks, removeBookmark, reorderBookmarks, updateBookmarkLabel } from '../db';
import { requestConfirm } from '../confirmBus';
import type { Bookmark, SelectedEntry, SourceCategory } from '../types';
import type { PaneBookmarkInfo } from './Pane';

type SortMode = 'manual' | 'category' | 'alpha';

const CATEGORY_ORDER: Record<string, number> = {
  bible: 0, commentary: 1, reference: 2, dictionary: 3,
  historical: 4, patristic: 5, devotional: 6, imported: 7,
};

function categoryLabel(cat: SourceCategory | null): string {
  if (!cat) return 'Other';
  switch (cat) {
    case 'bible': return 'Bibles';
    case 'commentary': return 'Commentaries';
    case 'reference': return 'Reference';
    case 'dictionary': return 'Dictionaries';
    case 'historical': return 'Historical';
    case 'patristic': return 'Church Fathers';
    case 'devotional': return 'Devotionals';
    case 'imported': return 'Imported';
    default: return 'Other';
  }
}

interface BookmarksTabProps {
  paneInfos: PaneBookmarkInfo[];
  onNavigateVerse: (book: string, chapter: number, verse: number) => void;
  onNavigateEntry: (sourceId: number, entryId: number, entry?: SelectedEntry) => void;
  onNavigateRef: (book: string, chapter: number) => void;
  version: number;
  onChanged: () => void;
}

export default function BookmarksTab({
  paneInfos,
  onNavigateVerse, onNavigateEntry, onNavigateRef,
  version, onChanged,
}: BookmarksTabProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>('manual');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [picking, setPicking] = useState(false);
  const [status, setStatus] = useState('');
  const editRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setBookmarks(await listBookmarks());
  }, []);

  useEffect(() => { reload(); }, [reload, version]);

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 3000);
  };

  const handleAddFromPane = async (info: PaneBookmarkInfo) => {
    setPicking(false);
    try {
      await addBookmark({
        source_id: info.sourceId,
        entry_id: info.entryId,
        book: info.book,
        chapter: info.chapter,
        position_ref: info.positionRef,
        label: info.label,
      });
      await reload();
      onChanged();
    } catch (e) {
      flash(String(e));
    }
  };

  const handleRemove = async (bm: Bookmark) => {
    if (!await requestConfirm('Delete this bookmark?')) return;
    await removeBookmark(bm.id);
    await reload();
    onChanged();
  };

  const startEdit = (bm: Bookmark) => {
    setEditingId(bm.id);
    setEditLabel(bm.label);
    requestAnimationFrame(() => editRef.current?.focus());
  };

  const saveEdit = async () => {
    if (editingId == null || !editLabel.trim()) return;
    await updateBookmarkLabel(editingId, editLabel.trim());
    setEditingId(null);
    await reload();
    onChanged();
  };

  const cancelEdit = () => { setEditingId(null); };

  const navigate = (bm: Bookmark) => {
    if (bm.entry_id != null && bm.source_id != null) {
      onNavigateEntry(bm.source_id, bm.entry_id, {
        entryId: bm.entry_id,
        sourceId: bm.source_id,
        sourceTitle: bm.source_title ?? '',
        positionRef: bm.position_ref,
        text: '',
      });
    } else if (bm.book && bm.verse != null && bm.chapter != null) {
      onNavigateVerse(bm.book, bm.chapter, bm.verse);
    } else if (bm.book && bm.chapter != null) {
      onNavigateRef(bm.book, bm.chapter);
    }
  };

  // Drag-and-drop reordering
  const dragIdx = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  const onDragStart = (i: number) => { dragIdx.current = i; };
  const onDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    dragOverIdx.current = i;
  };
  const onDrop = async () => {
    const from = dragIdx.current;
    const to = dragOverIdx.current;
    if (from == null || to == null || from === to) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    await reorderBookmarks(reordered.map((b) => b.id));
    setSortMode('manual');
    await reload();
    onChanged();
    dragIdx.current = null;
    dragOverIdx.current = null;
  };

  const sorted = [...bookmarks];
  if (sortMode === 'alpha') {
    // `numeric` so a bookmark on "… Vol. 10" files after "Vol. 9", not
    // between "Vol. 1" and "Vol. 2"
    sorted.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  } else if (sortMode === 'category') {
    sorted.sort((a, b) => {
      const ca = CATEGORY_ORDER[a.source_category ?? ''] ?? 99;
      const cb = CATEGORY_ORDER[b.source_category ?? ''] ?? 99;
      return ca !== cb ? ca - cb : a.sort_order - b.sort_order;
    });
  }

  const groups: { label: string; items: Bookmark[] }[] = [];
  if (sortMode === 'category') {
    const map = new Map<string, Bookmark[]>();
    for (const bm of sorted) {
      const key = bm.source_category ?? 'other';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(bm);
    }
    for (const [key, items] of map) {
      groups.push({ label: categoryLabel(key as SourceCategory), items });
    }
  } else {
    groups.push({ label: '', items: sorted });
  }

  return (
    <div className="bookmarks-tab">
      <div className="bookmarks-toolbar">
        <button className="primary" onClick={() => setPicking(!picking)} title="Bookmark a pane's current location">
          + Bookmark
        </button>
        <span className="spacer" />
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          title="Sort bookmarks"
          className="bookmarks-sort-select"
        >
          <option value="manual">Manual order</option>
          <option value="category">By category</option>
          <option value="alpha">A — Z</option>
        </select>
      </div>
      {picking && (
        <div className="bookmarks-picker">
          <div className="bookmarks-picker-label">Select a pane to bookmark:</div>
          {paneInfos.length === 0 && <div className="pane-empty">No panes open.</div>}
          {paneInfos.map((info, i) => (
            <button key={i} className="bookmarks-picker-option" onClick={() => handleAddFromPane(info)}>
              <span className="bookmark-label">{info.sourceTitle}</span>
              <span className="bookmark-ref">{info.label}</span>
            </button>
          ))}
          <button className="bookmarks-picker-cancel" onClick={() => setPicking(false)}>Cancel</button>
        </div>
      )}
      <div className="bookmarks-count">{bookmarks.length} / 100</div>
      {status && <div className="notes-status">{status}</div>}
      <div className="bookmarks-list">
        {bookmarks.length === 0 && (
          <div className="pane-empty">No bookmarks yet.</div>
        )}
        {groups.map((group) => (
          <div key={group.label}>
            {group.label && <div className="bookmarks-group-label">{group.label}</div>}
            {group.items.map((bm) => {
              const globalIdx = sorted.indexOf(bm);
              return (
                <div
                  key={bm.id}
                  className="bookmark-row"
                  draggable={sortMode === 'manual'}
                  onDragStart={() => onDragStart(globalIdx)}
                  onDragOver={(e) => onDragOver(e, globalIdx)}
                  onDrop={onDrop}
                >
                  {sortMode === 'manual' && <span className="bookmark-drag-handle" title="Drag to reorder">⠿</span>}
                  <div className="bookmark-body" onClick={() => navigate(bm)}>
                    {editingId === bm.id ? (
                      <input
                        ref={editRef}
                        className="bookmark-edit-input"
                        value={editLabel}
                        onChange={(e) => setEditLabel(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                        onBlur={saveEdit}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <span className="bookmark-label">{bm.label}</span>
                        {bm.source_title && <span className="bookmark-ref">{bm.source_title}</span>}
                      </>
                    )}
                  </div>
                  <button
                    className="icon bookmark-action"
                    onClick={(e) => { e.stopPropagation(); startEdit(bm); }}
                    title="Rename"
                  >✏</button>
                  <button
                    className="icon bookmark-action"
                    onClick={(e) => { e.stopPropagation(); handleRemove(bm); }}
                    title="Delete"
                  >✕</button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
