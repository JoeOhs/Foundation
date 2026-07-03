import { useState } from 'react';
import { LIBRARY_MANIFEST, alreadyInstalled, downloadAndInstall, type LibraryEntry } from '../library';
import type { Source } from '../types';

interface LibraryPanelProps {
  sources: Source[];
  onInstalled: () => Promise<void>;
  onClose: () => void;
}

export default function LibraryPanel({ sources, onInstalled, onClose }: LibraryPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const install = async (entry: LibraryEntry) => {
    setBusyId(entry.id);
    setError('');
    try {
      await downloadAndInstall(entry, setProgress);
      await onInstalled();
    } catch (e) {
      setError(`${entry.title}: ${String(e)}`);
    } finally {
      setBusyId(null);
      setProgress('');
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busyId && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Public domain library</h2>
          <button className="icon" onClick={onClose} disabled={!!busyId}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 0 }}>
            Downloads a translation directly into your library — no account, no server, just a
            one-time fetch of a text that has been individually checked for public-domain status.
            This list is curated by hand and ships with the app; it isn't fetched from a remote
            index (see the project roadmap).
          </p>
          {error && <div className="import-warning">⚠ {error}</div>}
          {LIBRARY_MANIFEST.map((entry) => {
            const installed = alreadyInstalled(entry, sources);
            const busy = busyId === entry.id;
            return (
              <div className="note-card" key={entry.id}>
                <div className="note-title">{entry.title}</div>
                <div className="note-anchor" style={{ color: 'var(--text-dim)' }}>
                  {entry.language} · {entry.license}
                </div>
                <div className="note-content" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {entry.licenseDetail}
                </div>
                <div className="note-actions">
                  <button
                    className="primary"
                    disabled={installed || !!busyId}
                    onClick={() => install(entry)}
                  >
                    {installed ? 'Installed' : busy ? progress || 'Working…' : 'Download & install'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} disabled={!!busyId}>Close</button>
        </div>
      </div>
    </div>
  );
}
