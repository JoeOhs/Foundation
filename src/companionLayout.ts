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

function sameLines(d: InstalledDiagram, b: BundledDiagram): boolean {
  return d.lines.length === b.lines.length && d.lines.every(
    (l, i) => (l.label ?? '') === b.lines[i].label && (l.ref_range ?? '') === (b.lines[i].ref_range ?? ''),
  );
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
    if (d === undefined || !sameLines(d, b)) {
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

export interface InstalledBraceMember {
  id: number;
  diagram_id: number;
  label: string;
  structure_line_id: number;
}

// Lines a brace should give up, as the bundle now leaves leading bracket lines
// out. Only ever removes a line from a brace, and only in a diagram that
// matches the bundle line for line, with no label the bundle lacks.
export function planBraceTrims(
  installed: (InstalledDiagram & { id: number })[],
  members: InstalledBraceMember[],
  bundled: (BundledDiagram & { groups: { label: string; members: number[] }[] })[],
): { groupId: number; lineId: number }[] {
  const trims: { groupId: number; lineId: number }[] = [];
  const queue = new Map<string, (InstalledDiagram & { id: number })[]>();
  for (const d of installed) queue.set(d.title, [...(queue.get(d.title) ?? []), d]);
  for (const b of bundled) {
    const d = queue.get(b.title)?.shift();
    if (d === undefined || !sameLines(d, b)) continue;
    const wanted = new Map(b.groups.map((g) => [g.label, new Set(g.members.map((i) => d.lines[i].id))]));
    for (const m of members) {
      if (m.diagram_id !== d.id) continue;
      if (wanted.get(m.label)?.has(m.structure_line_id) === false) {
        trims.push({ groupId: m.id, lineId: m.structure_line_id });
      }
    }
  }
  return trims;
}
