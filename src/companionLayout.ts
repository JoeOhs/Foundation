// Works out which Structure lines need a new depth or parent, comparing an
// installed Companion Bible with the bundle. Pure, so it can be tested
// without a database. A diagram is only touched if every line still matches
// the bundle by label and reference; otherwise it is left exactly as it is.

export interface InstalledDiagram {
  title: string;
  lines: { id: number; parent_id: number | null; depth: number; label: string | null; ref_range: string | null }[];
}

export interface BundledDiagram {
  title: string;
  lines: { parent: number | null; depth: number; label: string; ref_range: string | null }[];
}

export interface LayoutChange {
  id: number;
  depth: number;
  parentId: number | null;
}

export function planLayoutChanges(
  installed: InstalledDiagram[],
  bundled: BundledDiagram[],
): { changes: LayoutChange[]; skipped: string[] } {
  const changes: LayoutChange[] = [];
  const skipped: string[] = [];
  const queue = new Map<string, InstalledDiagram[]>();
  for (const d of installed) queue.set(d.title, [...(queue.get(d.title) ?? []), d]);
  for (const b of bundled) {
    const d = queue.get(b.title)?.shift();
    const matches = d !== undefined && d.lines.length === b.lines.length && d.lines.every(
      (l, i) => (l.label ?? '') === b.lines[i].label && (l.ref_range ?? '') === (b.lines[i].ref_range ?? ''),
    );
    if (!matches) {
      skipped.push(b.title);
      continue;
    }
    d.lines.forEach((l, i) => {
      const parentIndex = b.lines[i].parent;
      const parentId = parentIndex === null ? null : d.lines[parentIndex].id;
      if (l.depth !== b.lines[i].depth || l.parent_id !== parentId) {
        changes.push({ id: l.id, depth: b.lines[i].depth, parentId });
      }
    });
  }
  return { changes, skipped };
}
