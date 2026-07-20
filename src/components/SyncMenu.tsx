import { useEffect, useRef, useState } from 'react';
import type { Source } from '../types';

// 'A' = synced with Pane 1 (which always leads group A); 'B' = second sync
// group with its own leader; 'solo' = fully independent navigation.
export type PaneGroup = 'A' | 'B' | 'solo';

interface SyncMenuProps {
  paneSourceIds: number[];
  sources: Source[];
  groups: PaneGroup[];
  onAssign: (paneIndex: number, group: PaneGroup) => void;
}

// The toolbar 🔗 menu: one place to manage how panes sync. Pane 1 is fixed
// as the navigation controller of group A (notes and search navigation
// follow it); every other pane can sync with it, join a second combination
// (group B — needs at least 3 panes to mean anything), or go solo.
export default function SyncMenu({ paneSourceIds, sources, groups, onAssign }: SyncMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const paneCount = paneSourceIds.length;
  const groupBAllowed = paneCount >= 3;

  const titleOf = (sourceId: number) =>
    sources.find((s) => s.id === sourceId)?.title ?? '?';

  return (
    <div className="sync-menu" ref={rootRef}>
      <button onClick={() => setOpen((v) => !v)} disabled={paneCount < 2} title="Pane sync options">
        🔗 Sync
      </button>
      {open && (
        <div className="theme-pop sync-pop">
          <div className="theme-section-label">Pane sync</div>
          <div className="sync-row">
            <span className="sync-pane-name">1 · {titleOf(paneSourceIds[0])}</span>
            <span className="sync-leader-tag">leads · notes anchor</span>
          </div>
          {paneSourceIds.slice(1).map((sid, idx) => {
            const i = idx + 1;
            const g = groups[i] ?? 'A';
            return (
              <div className="sync-row" key={i}>
                <span className="sync-pane-name">{i + 1} · {titleOf(sid)}</span>
                <span className="sync-choices">
                  <button
                    className={`sync-choice${g === 'A' ? ' active' : ''}`}
                    onClick={() => onAssign(i, 'A')}
                    title="Follow Pane 1"
                  >
                    Synced
                  </button>
                  <button
                    className={`sync-choice${g === 'B' ? ' active' : ''}`}
                    disabled={!groupBAllowed}
                    onClick={() => onAssign(i, 'B')}
                    title={groupBAllowed
                      ? 'Second sync group — its lowest pane leads it'
                      : 'Needs at least 3 panes to form a second combination'}
                  >
                    Group B
                  </button>
                  <button
                    className={`sync-choice${g === 'solo' ? ' active' : ''}`}
                    onClick={() => onAssign(i, 'solo')}
                    title="Navigate this pane independently"
                  >
                    Solo
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
