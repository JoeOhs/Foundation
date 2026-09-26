// ThML/HTML helpers shared by the Knox builds (build.mjs, laing.mjs): turning
// CCEL ThML and Gutenberg HTML into plain paragraphs, finding divisions by
// title, and logging what is left out.

export const exclusions = [];
export function logExclusion(kind, text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t) exclusions.push(`[${kind}] ${t}`);
}

export function decodeEntities(s) {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/gi, '&');
}

export function toText(html) {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' / ')
      .replace(/<pb\b[^>]*\/?>/gi, '')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/(\s*\/\s*)+$/, '')
    .trim();
}

// Drop footnotes, side notes and margin notes, logging each.
export function stripApparatus(xml) {
  return xml
    .replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, (m) => (logExclusion('footnote', toText(m)), ' '))
    .replace(/<div class="sidenote"[^>]*>[\s\S]*?<\/div>/gi, (m) => (logExclusion('side note', toText(m)), ' '))
    .replace(/<span class="mnote1"[^>]*>[\s\S]*?<\/span>/gi, (m) => (logExclusion('margin note', toText(m)), ' '));
}

// The markup of one division, by its exact title, up to the next division of
// the same or a higher level.
export function division(xml, level, title) {
  const open = new RegExp(`<div${level}\\b[^>]*title="${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
  const m = open.exec(xml);
  if (!m) throw new Error(`Division "${title}" (div${level}) not found — refusing to build.`);
  const rest = xml.slice(m.index + m[0].length);
  const end = rest.search(new RegExp(`<div[1-${level}]\\b|</div${level - 1 || 1}>`));
  return end === -1 ? rest : rest.slice(0, end);
}

export function childTitles(chunk, level) {
  return [...chunk.matchAll(new RegExp(`<div${level}\\b[^>]*title="([^"]*)"`, 'g'))].map((m) => m[1]);
}

// Paragraphs of a division in reading order: <p> elements and verse stanzas.
export function paragraphsOf(chunk, label) {
  const out = [];
  for (const m of stripApparatus(chunk).matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>|<div class="stanza"[^>]*>([\s\S]*?)<\/div>/gi)) {
    const text = toText(m[1] ?? m[2]);
    if (text) out.push(text);
  }
  if (out.length === 0) throw new Error(`"${label}" has no paragraphs — refusing to build.`);
  return out;
}
