import { useEffect, useMemo, useState } from 'react';
import { hasStrongsData } from '../db';
import { languageName } from '../language';
import {
  BUNDLED_LIBRARY, LIBRARY_ADDONS, LIBRARY_MANIFEST, SERIES_NOTES, addonRequirementMet, downloadAndInstall,
  type BundledLibraryEntry, type LibraryAddon, type LibraryEntry,
} from '../library';
import type { Source, SourceCategory } from '../types';

interface LibraryPanelProps {
  sources: Source[];
  onInstalled: () => Promise<void>;
  // Bring an imported (freeform) source into a reading pane.
  onOpenImported: (sourceId: number) => void;
  // Delete an imported source (with its highlights/notes/links).
  onDeleteImported: (sourceId: number) => void;
  // Install (or reinstall/repair) a bundled work — handles removing any
  // previous copy and opening the fresh one.
  onInstallBundled: (entry: BundledLibraryEntry, onProgress: (msg: string) => void) => Promise<void>;
  onClose: () => void;
}

// Section order and headings. Driven by SourceCategory so a new category
// can't be added without deciding where it appears.
const CATEGORY_LABELS: { category: SourceCategory; label: string }[] = [
  { category: 'bible', label: 'Bibles' },
  { category: 'commentary', label: 'Commentaries' },
  { category: 'reference', label: 'Reference works' },
  { category: 'historical', label: 'Historical works' },
  { category: 'patristic', label: 'Church Fathers' },
  { category: 'imported', label: 'Imported' },
];

// Footer works (dictionaries, devotionals) file under the Add-ons section
// rather than getting category sections of their own: like the Strong's
// add-on, they augment the study experience around the text instead of
// adding a readable pane work.
const ADDON_CATEGORIES: SourceCategory[] = ['dictionary', 'devotional'];

// Below this, a section opens expanded — a two-item list costs nothing to
// show, while the Bibles section (already a dozen, and the category the
// project expects to grow most) would otherwise fill the panel on open.
const AUTO_EXPAND_MAX = 3;

// One row in the panel, normalised across the three things that can appear
// in a category section: a downloadable manifest entry, a bundled work, and
// a source that only exists in the database (a user's own import). Add-ons
// are not rows — they attach data to an existing source rather than adding
// one, so they render in their own section below.
interface Row {
  key: string;
  title: string;
  category: SourceCategory;
  language: string | null;
  license: string;
  licenseDetail: string;
  series?: string;
  // Present once the row exists in the database.
  source?: Source;
  manifest?: LibraryEntry;
  bundled?: BundledLibraryEntry;
}

// Everything a row can be matched against by the filter box: title,
// language (both the code and its English name, so "spanish" and "es" both
// work), and the section it sits in.
function rowHaystack(row: Row, label: string): string {
  return [
    row.title,
    row.language ?? '',
    languageName(row.language),
    row.series ?? '',
    label,
  ].join(' ').toLowerCase();
}

export default function LibraryPanel({
  sources, onInstalled, onOpenImported, onDeleteImported, onInstallBundled, onClose,
}: LibraryPanelProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [strongsInstalled, setStrongsInstalled] = useState(false);
  const [filter, setFilter] = useState('');
  // Explicit user toggles; sections not named here fall back to the
  // size-based default in `isOpen`.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  useEffect(() => { hasStrongsData().then(setStrongsInstalled); }, []);

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

  const installAddon = async (addon: LibraryAddon) => {
    setBusyId(addon.id);
    setError('');
    try {
      await addon.install(setProgress);
      setStrongsInstalled(await hasStrongsData());
      await onInstalled();
    } catch (e) {
      setError(`${addon.title}: ${String(e)}`);
    } finally {
      setBusyId(null);
      setProgress('');
    }
  };

  const installBundled = async (entry: BundledLibraryEntry) => {
    setBusyId(entry.id);
    setError('');
    try {
      await onInstallBundled(entry, setProgress);
    } catch (e) {
      setError(`${entry.title}: ${String(e)}`);
    } finally {
      setBusyId(null);
      setProgress('');
    }
  };

  // Every catalogue entry plus every installed source, folded into one list
  // keyed by title so a work that is both (installed *and* in the manifest)
  // appears once, with its install state attached. A compound work —
  // Josephus, the Companion Bible commentary — is a single manifest entry
  // covering many books, so it is naturally one row here; its internal
  // structure is reached through the pane's TOC dropdown, not this panel.
  const rows = useMemo<Row[]>(() => {
    const byTitle = new Map<string, Row>();

    for (const entry of LIBRARY_MANIFEST) {
      byTitle.set(entry.title, {
        key: entry.id,
        title: entry.title,
        category: entry.category,
        language: entry.language,
        license: entry.license,
        licenseDetail: entry.licenseDetail,
        manifest: entry,
      });
    }
    for (const entry of BUNDLED_LIBRARY) {
      byTitle.set(entry.title, {
        key: entry.id,
        title: entry.title,
        category: entry.category,
        language: entry.language,
        license: entry.license,
        licenseDetail: entry.licenseDetail,
        series: entry.series,
        bundled: entry,
      });
    }
    // Attach the database row to whichever catalogue entry it matches, and
    // add anything the catalogue doesn't know about — the user's own
    // imports, which only ever exist in the database.
    for (const source of sources) {
      const existing = byTitle.get(source.title);
      if (existing) {
        existing.source = source;
        continue;
      }
      byTitle.set(source.title, {
        key: `source-${source.id}`,
        title: source.title,
        category: source.category ?? 'imported',
        language: source.language,
        license: source.license_note ?? '',
        licenseDetail: '',
        source,
      });
    }
    return [...byTitle.values()];
  }, [sources]);

  const query = filter.trim().toLowerCase();

  // Sections, each already filtered. Bibles additionally split by language,
  // since that's the category expected to grow most; the rest stay flat.
  const sections = useMemo(() => {
    return CATEGORY_LABELS.map(({ category, label }) => {
      const matching = rows
        .filter((r) => r.category === category)
        .filter((r) => !query || rowHaystack(r, label).includes(query))
        .sort((a, b) => a.title.localeCompare(b.title));

      let groups: { key: string; label: string | null; rows: Row[] }[];
      if (category === 'bible') {
        const byLanguage = new Map<string, Row[]>();
        for (const r of matching) {
          const code = r.language ?? '';
          if (!byLanguage.has(code)) byLanguage.set(code, []);
          byLanguage.get(code)!.push(r);
        }
        groups = [...byLanguage.entries()]
          .sort((a, b) => languageName(a[0]).localeCompare(languageName(b[0])))
          .map(([code, rs]) => ({
            key: `${category}-${code}`,
            label: `${languageName(code)} (${rs.length})`,
            rows: rs,
          }));
      } else if (category === 'patristic') {
        const bySeries = new Map<string, Row[]>();
        for (const r of matching) {
          const s = r.series ?? 'Other';
          if (!bySeries.has(s)) bySeries.set(s, []);
          bySeries.get(s)!.push(r);
        }
        groups = [...bySeries.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([series, rs]) => ({
            key: `${category}-${series}`,
            label: `${series} (${rs.length})`,
            rows: rs,
          }));
      } else {
        groups = matching.length > 0
          ? [{ key: category, label: null, rows: matching }]
          : [];
      }
      return { category, label, count: matching.length, groups };
    });
  }, [rows, query]);

  // A filter implies you want to see what matched, so searching expands
  // everything; otherwise small sections open and large ones stay folded.
  const isOpen = (key: string, count: number): boolean => {
    if (query) return true;
    return toggled[key] ?? count <= AUTO_EXPAND_MAX;
  };
  const toggle = (key: string, count: number) => {
    setToggled((prev) => ({ ...prev, [key]: !isOpen(key, count) }));
  };

  const renderRow = (row: Row) => {
    const busy = busyId === row.key;
    const installed = !!row.source;
    // A verse-keyed work is picked in an ordinary Bible pane, so pushing it
    // into a dedicated pane would be wrong; only freeform works get "Open".
    const canOpen = installed && row.source && row.source.is_verse_keyed === 0;
    return (
      <div className="note-card library-row" key={row.key}>
        <div className="note-title">{row.title}</div>
        <div className="note-anchor" style={{ color: 'var(--text-dim)' }}>
          {[row.language ? languageName(row.language) : null, row.license]
            .filter(Boolean).join(' · ')}
        </div>
        {row.licenseDetail && (
          <div className="note-content" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            {row.licenseDetail}
          </div>
        )}
        <div className="note-actions">
          {canOpen && row.source && (
            <button onClick={() => onOpenImported(row.source!.id)}>
              {row.category === 'dictionary' || row.category === 'devotional'
                ? 'Open in the study footer'
                : 'Open in a pane'}
            </button>
          )}
          {row.manifest && (
            <button
              className="primary"
              disabled={installed || !!busyId}
              onClick={() => install(row.manifest!)}
            >
              {installed ? 'Installed' : busy ? progress || 'Working…' : 'Download & install'}
            </button>
          )}
          {row.bundled && (
            <button
              className="primary"
              disabled={!!busyId}
              onClick={() => installBundled(row.bundled!)}
              title={installed ? 'Re-install and rebuild this work’s data (safe to re-run)' : undefined}
            >
              {busy ? progress || 'Working…' : installed ? 'Reinstall / repair' : 'Install'}
            </button>
          )}
          {installed && row.source && (
            <button
              className="icon danger"
              onClick={() => onDeleteImported(row.source!.id)}
              title="Delete this source"
            >
              🗑
            </button>
          )}
        </div>
      </div>
    );
  };

  const visibleSections = sections.filter((s) => s.count > 0);
  const addonRows = rows
    .filter((r) => ADDON_CATEGORIES.includes(r.category))
    .filter((r) => !query || rowHaystack(r, 'Add-ons').includes(query))
    .sort((a, b) => a.title.localeCompare(b.title));

  return (
    <div className="modal-overlay" onClick={() => !busyId && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Public domain library</h2>
          <button className="icon" onClick={onClose} disabled={!!busyId}>✕</button>
        </div>
        <div className="library-filter">
          <input
            type="search"
            placeholder="Filter by name or language…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        <div className="modal-body">
          {error && <div className="import-warning">⚠ {error}</div>}

          {visibleSections.length === 0 && (
            <div className="pane-empty">No works match “{filter}”.</div>
          )}

          {visibleSections.map((section) => {
            const open = isOpen(section.category, section.count);
            return (
              <div className="library-section" key={section.category}>
                <button
                  className="library-section-head"
                  aria-expanded={open}
                  onClick={() => toggle(section.category, section.count)}
                >
                  <span className="library-caret">{open ? '▾' : '▸'}</span>
                  <span className="library-section-title">{section.label}</span>
                  <span className="library-count">{section.count}</span>
                </button>
                {open && section.groups.map((group) => (
                  group.label === null
                    ? <div key={group.key}>{group.rows.map(renderRow)}</div>
                    : (() => {
                        const gOpen = isOpen(group.key, group.rows.length);
                        return (
                          <div className="library-subsection" key={group.key}>
                            <button
                              className="library-subsection-head"
                              aria-expanded={gOpen}
                              onClick={() => toggle(group.key, group.rows.length)}
                            >
                              <span className="library-caret">{gOpen ? '▾' : '▸'}</span>
                              {group.label}
                            </button>
                            {gOpen && group.rows.map(renderRow)}
                            {gOpen && (() => {
                              const seriesName = group.key.replace(/^[^-]+-/, '');
                              const note = SERIES_NOTES[seriesName];
                              return note ? <div className="library-series-note">{note}</div> : null;
                            })()}
                          </div>
                        );
                      })()
                ))}
              </div>
            );
          })}

          {/* Add-ons sit outside the category sections: the Strong's add-on
              attaches data to a translation that's already installed, and
              footer works (dictionaries, devotionals) augment study around
              the text rather than adding a pane work. */}
          {(!query || addonRows.length > 0) && (
            <div className="library-section">
              <div className="search-group-label">Add-ons</div>
              {addonRows.map(renderRow)}
              {!query && LIBRARY_ADDONS.map((addon) => {
                const ready = addonRequirementMet(addon, sources);
                const installed = addon.id === 'kjv_strongs' ? strongsInstalled : false;
                const busy = busyId === addon.id;
                return (
                  <div className="note-card" key={addon.id}>
                    <div className="note-title">{addon.title}</div>
                    <div className="note-anchor" style={{ color: 'var(--text-dim)' }}>{addon.license}</div>
                    <div className="note-content" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      {addon.licenseDetail}
                    </div>
                    {!ready && (
                      <div className="import-warning" style={{ margin: '6px 0 0 0' }}>
                        Install “{addon.requiresSourceTitle}” first.
                      </div>
                    )}
                    <div className="note-actions">
                      <button
                        className="primary"
                        disabled={!ready || !!busyId}
                        onClick={() => installAddon(addon)}
                        title={installed ? 'Re-download and rebuild this add-on’s data (safe to re-run)' : undefined}
                      >
                        {busy ? progress || 'Working…' : installed ? 'Reinstall / repair' : 'Download & install'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onClose} disabled={!!busyId}>Close</button>
        </div>
      </div>
    </div>
  );
}
