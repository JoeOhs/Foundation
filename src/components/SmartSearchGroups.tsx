import { useEffect, useState } from 'react';
import { getStrongsWordsForEntries } from '../db';
import StrongsVerseText from './StrongsWords';
import type { StrongsSearchGroup, StrongsSearchHit, StrongsWordRow } from '../types';

export function groupHeader(g: StrongsSearchGroup): string {
  const d = g.dict;
  const parts = [g.strongs_number];
  if (d?.transliteration) parts.push(d.transliteration);
  const gloss = d?.short_def || d?.full_def;
  return parts.join(' — ') + (gloss ? ` — “${gloss}”` : '') + ` (${g.hits.length})`;
}

interface SmartSearchGroupsProps {
  groups: StrongsSearchGroup[];
  onNavigate: (hit: StrongsSearchHit) => void;
  // The docked concordance pane hides this label (its whole body is the
  // grouped view); the search modal shows it to separate the section from
  // the plain full-text results below.
  showSectionLabel?: boolean;
}

// The grouped-by-original-word concordance view, shared between the search
// modal (as an additive section) and the docked Concordance pane.
export default function SmartSearchGroups({ groups, onNavigate, showSectionLabel = true }: SmartSearchGroupsProps) {
  const [wordsByEntry, setWordsByEntry] = useState<Map<number, StrongsWordRow[]>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const entryIds = [...new Set(groups.flatMap((g) => g.hits.map((h) => h.entry_id)))];
    getStrongsWordsForEntries(entryIds).then((rows) => {
      const map = new Map<number, StrongsWordRow[]>();
      for (const r of rows) {
        if (!map.has(r.entry_id)) map.set(r.entry_id, []);
        map.get(r.entry_id)!.push(r);
      }
      setWordsByEntry(map);
    });
  }, [groups]);

  const toggle = (number: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  };

  return (
    <div>
      {showSectionLabel && <div className="search-group-label">Grouped by original word (KJV)</div>}
      {groups.map((g) => (
        <div key={g.strongs_number} className="strongs-group">
          <div className="strongs-group-header" onClick={() => toggle(g.strongs_number)}>
            {groupHeader(g)}
          </div>
          {expanded.has(g.strongs_number) && g.dict?.full_def && (
            <div className="strongs-full-def">{g.dict.full_def}</div>
          )}
          {g.hits.map((h) => (
            <div
              className="search-hit"
              key={`${h.entry_id}-${h.word_index}`}
              onClick={() => onNavigate(h)}
            >
              <div className="hit-ref">
                {h.book} {h.chapter}:{h.verse} <span style={{ color: 'var(--text-dim)' }}>· {h.source_title}</span>
              </div>
              <div className="hit-text">
                <StrongsVerseText
                  text={h.entry_text}
                  words={wordsByEntry.get(h.entry_id) ?? []}
                  highlightWordIndex={h.word_index}
                />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
