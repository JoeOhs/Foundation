import { insertParsedSource, insertTocEntries } from './db';
import type { ParsedEntry, ParsedSource, ParsedTocEntry } from './types';

// Dedicated, fixed-schema importer for E.W. Bullinger's 198 Companion Bible
// Appendixes — not routed through the general importer.ts sniffer, since
// the bundled file's shape is fixed and known (produced by the standalone
// scraper in companion-bible-appendix/scrape.mjs). Bundled with the app
// under public/library/ and installed from local disk, same trick as
// src/seed.ts's bundled KJV/BBE — no network call, unlike every other
// Library entry in src/library.ts.
const BUNDLE_URL = '/library/companion-bible-appendixes.json';

export const COMPANION_APPENDIX_TITLE = 'The Companion Bible Appendixes';

// `references` and `source_url` describe the bundle's shape but aren't
// consumed by this import yet — see ROADMAP.md's Companion Bible Appendixes
// entry for the planned follow-up (rendering `references` as in-app jump
// links between appendixes).
interface BundledAppendix {
  number: number;
  title: string;
  body_markdown: string;
  references: number[];
  source_url: string;
}

interface BundledAppendixFile {
  metadata: {
    scrape_date: string;
    source_site: string;
    author: string;
    license_note: string;
    total_appendixes_expected: number;
    total_appendixes_scraped: number;
    failed_appendixes: number[];
  };
  appendixes: BundledAppendix[];
}

// Renders the bundled archival Markdown down to the plain, pre-wrapped text
// every freeform entry already gets (see Pane.tsx's `.section-text` — plain
// text, no Markdown rendering, same as EPUB imports today). Structure
// survives as indentation/plain rows rather than as real formatting:
// nested blockquotes become indent levels, and table rows (54 of the 198
// appendixes use them, e.g. #3's Genesis/Apocalypse parallel) become
// pipe-free "cell — cell" lines instead of leaking literal `|` characters
// (the reader fonts are proportional-width serif faces, so padded ASCII
// columns wouldn't line up on screen regardless).
function flattenTableRow(line: string): string {
  const cells = line.trim().slice(1, -1).split('|').map((c) => c.trim()).filter(Boolean);
  return cells.join('  —  ');
}

function flattenMarkdown(md: string): string {
  const lines = md.split('\n').map((line) => {
    const m = line.match(/^((?:>\s?)+)(.*)$/);
    if (!m) return line;
    const level = (m[1].match(/>/g) ?? []).length;
    return '  '.repeat(level) + m[2];
  });
  let text = lines.join('\n');
  // A handful of appendixes (e.g. 197's chiastic outline) open a nested
  // blockquote mid-line, with no line break before it — the per-line pass
  // above only catches "> " at the true start of a line, so a stray marker
  // like "...: > B. | ..." survives; strip those too.
  text = text.replace(/(?<=[^\n])>\s*/g, '');
  // Drop table separator rows (|---|---|) entirely, then flatten content
  // rows (order matters — a separator row would otherwise also match the
  // generic table-row pattern below). `[ \t]` (not `\s`), and no `$`, on
  // purpose: `\s*$` is greedy enough to swallow the newline(s) separating
  // adjacent table rows into the match itself, silently collapsing
  // consecutive rows onto one line when replaced.
  text = text.replace(/^[ \t]*\|(?:[ \t]*-{3,}[ \t]*\|)+[ \t]*$/gm, '');
  text = text.replace(/^[ \t]*(\|.*\|)[ \t]*$/gm, (_m, row) => flattenTableRow(row));
  // [\s\S] (not `.`) so bold/italic spans that wrap across a `<br>`-driven
  // line break (e.g. a three-line section header) still get stripped.
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, '$1');
  text = text.replace(/\*([^*\n]+)\*/g, '$1');
  text = text.replace(/^#{1,6}\s+/gm, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

async function loadCompanionAppendixSource(): Promise<{ parsed: ParsedSource; licenseNote: string }> {
  const res = await fetch(BUNDLE_URL);
  if (!res.ok) throw new Error(`Could not load the bundled Companion Bible Appendixes (${res.status}).`);
  const data: BundledAppendixFile = await res.json();
  if (!data.appendixes || data.appendixes.length === 0) {
    throw new Error('Bundled Companion Bible Appendixes file is empty or malformed.');
  }

  const entries: ParsedEntry[] = [];
  const toc: ParsedTocEntry[] = [];
  for (const a of [...data.appendixes].sort((x, y) => x.number - y.number)) {
    // One entry per line (any run of newlines — blank-line-separated
    // paragraphs and single-newline-separated blockquote/outline items
    // alike), not one giant entry for the whole appendix — otherwise the
    // entire body becomes a single click/select/highlight/note/link unit
    // (same bug the EPUB importer had; see walkEpubBody's per-paragraph
    // split). The label goes on the first paragraph only, like a printed
    // page.
    //
    // `chapter: a.number` — each appendix is its own "chapter" (1-198),
    // not `null` (one giant freeform book). With ~2,600 paragraphs total,
    // loading them all into one pane at once was the actual performance
    // problem and the "endless scroll" — Pane.tsx's getEntries(sourceId,
    // book, chapter) only fetches one appendix's paragraphs at a time when
    // they're chaptered like this, same as it already does for a Bible
    // chapter.
    const paragraphs = flattenMarkdown(a.body_markdown)
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length === 0) continue;
    toc.push({ title: `${a.number}. ${a.title}`, level: 1, entryIndex: entries.length });
    paragraphs.forEach((text, i) => {
      entries.push({
        chapter: a.number,
        verse: null,
        position_ref: i === 0 ? `Appendix ${a.number}` : null,
        text,
      });
    });
  }

  const parsed: ParsedSource = {
    suggestedTitle: COMPANION_APPENDIX_TITLE,
    // 'commentary', not 'reference' — these are Bullinger's notes on the
    // biblical text (the intended reading experience: its own commentary
    // pane), not a lookup-style reference work.
    suggestedType: 'commentary',
    structure: 'freeform',
    books: [{ name: 'Appendixes', entries }],
    warnings: [],
    suggestedAuthor: 'E.W. Bullinger',
    suggestedLanguage: 'English',
    suggestedLicenseNote: data.metadata.license_note,
    toc,
  };
  return { parsed, licenseNote: data.metadata.license_note };
}

// Returns the new source's id so the caller can immediately open it in its
// own dedicated pane (see LibraryPanel's installBundled) — installing this
// should put it in front of you reading, not just add a row to a list.
export async function installCompanionAppendixes(onProgress: (msg: string) => void): Promise<number> {
  onProgress('Loading bundled appendixes…');
  const { parsed, licenseNote } = await loadCompanionAppendixSource();
  const sourceId = await insertParsedSource(
    parsed,
    { title: COMPANION_APPENDIX_TITLE, type: 'commentary', language: 'en', license_note: licenseNote, category: 'commentary' },
    (done, total) => onProgress(`Installing… ${Math.round((done / total) * 100)}%`),
  );
  onProgress('Building table of contents…');
  await insertTocEntries(sourceId, parsed);
  return sourceId;
}
