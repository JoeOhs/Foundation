import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { insertParsedSource } from '../db';
import { parseFile } from '../importer';
import type { ParsedSource, SourceType } from '../types';

interface ImportWizardProps {
  onDone: (imported: boolean) => void;
}

const TYPE_OPTIONS: { value: SourceType; label: string }[] = [
  { value: 'bible', label: 'Bible translation' },
  { value: 'commentary', label: 'Commentary' },
  { value: 'extra-biblical', label: 'Extra-biblical text' },
  { value: 'reference', label: 'Reference work' },
];

export default function ImportWizard({ onDone }: ImportWizardProps) {
  const [parsed, setParsed] = useState<ParsedSource | null>(null);
  const [fileName, setFileName] = useState('');
  const [title, setTitle] = useState('');
  const [type, setType] = useState<SourceType>('extra-biblical');
  const [licenseNote, setLicenseNote] = useState('personal use');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const pickFile = async () => {
    setError('');
    const path = await open({
      multiple: false,
      title: 'Import a text',
      filters: [
        { name: 'Importable texts', extensions: ['txt', 'md', 'markdown', 'json', 'csv', 'tsv', 'xml', 'bblx', 'cmtx', 'dctx', 'topx', 'db', 'sqlite'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (typeof path !== 'string') return;
    setBusy(true);
    setProgress('Reading file…');
    try {
      const b64 = await invoke<string>('read_file_base64', { path });
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      setProgress('Analyzing structure…');
      const result = await parseFile(path, bytes);
      setParsed(result);
      setFileName(path.replace(/^.*[\\/]/, ''));
      setTitle(result.suggestedTitle);
      setType(result.suggestedType);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const doImport = async () => {
    if (!parsed || !title.trim()) return;
    setBusy(true);
    setError('');
    try {
      await insertParsedSource(
        parsed,
        { title: title.trim(), type, license_note: licenseNote.trim() || null },
        (done, total) => setProgress(`Importing… ${Math.round((done / total) * 100)}%`),
      );
      onDone(true);
    } catch (e) {
      setError(String(e));
      setBusy(false);
      setProgress('');
    }
  };

  const entryCount = parsed?.books.reduce((n, b) => n + b.entries.length, 0) ?? 0;
  const previewEntries = parsed?.books[0]?.entries.slice(0, 8) ?? [];

  return (
    <div className="modal-overlay" onClick={() => !busy && onDone(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Import a text</h2>
          <button className="icon" onClick={() => onDone(false)} disabled={busy}>✕</button>
        </div>
        <div className="modal-body">
          {!parsed && (
            <div className="pane-empty" style={{ padding: 40 }}>
              <p>Import plain text, Markdown, JSON, CSV/TSV, or XML.<br />
              Verse-keyed texts map onto book/chapter/verse; anything else is kept as page/section entries.<br />
              Legacy SQLite-based files you own can also be read as a one-time migration.</p>
              <button className="primary" onClick={pickFile} disabled={busy}>
                {busy ? progress || 'Working…' : 'Choose a file…'}
              </button>
              {error && <div className="import-warning">{error}</div>}
            </div>
          )}
          {parsed && (
            <>
              <div className="import-field">
                <label>File</label>
                <div>{fileName} — {parsed.books.length} book/section container(s), {entryCount} entries, detected as <strong>{parsed.structure}</strong></div>
              </div>
              {parsed.warnings.map((w, i) => (
                <div className="import-warning" key={i}>⚠ {w}</div>
              ))}
              <div className="import-field">
                <label>Title</label>
                <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="import-field">
                <label>Type</label>
                <select value={type} onChange={(e) => setType(e.target.value as SourceType)}>
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="import-field">
                <label>License note</label>
                <input type="text" value={licenseNote} onChange={(e) => setLicenseNote(e.target.value)} placeholder="e.g. public domain, personal use only" />
              </div>
              <div className="import-field">
                <label>Preview — {parsed.books[0]?.name}</label>
                <div className="import-preview">
                  {previewEntries.map((e, i) => {
                    const ref = e.verse != null ? `${e.chapter}:${e.verse}` : e.position_ref ?? `#${i + 1}`;
                    return `[${ref}] ${e.text.slice(0, 160)}${e.text.length > 160 ? '…' : ''}`;
                  }).join('\n\n')}
                </div>
              </div>
              {error && <div className="import-warning">{error}</div>}
            </>
          )}
        </div>
        {parsed && (
          <div className="modal-footer">
            <button onClick={pickFile} disabled={busy}>Choose a different file</button>
            <button className="primary" onClick={doImport} disabled={busy || !title.trim()}>
              {busy ? progress || 'Importing…' : 'Import'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
