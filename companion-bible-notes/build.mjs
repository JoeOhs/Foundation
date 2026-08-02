// Standalone transcription compiler (run with `node build.mjs`, outside the
// Tauri app): converts the hand-written notation in this directory into
// ../public/library/companion-bible-notes.json, the single bundle that
// src/companionNotesImport.ts installs.
//
// Notation is documented in README.md. Zero dependencies; does not touch
// src-tauri/, src/db.ts or src/importer.ts, and is not wired into the app's
// import pipeline.
//
// Source text: The Companion Bible (E. W. Bullinger, 1913). Public domain —
// Bullinger died in 1913.
//
// Usage:
//   node build.mjs --book=philemon   compile one book (per-book testing)
//   node build.mjs --all             compile every transcribed book into
//                                    the single bundle the app deploys

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'library');
// Scanned page PDFs are copied here so the app can serve them offline; the
// originals stay put under thecompanionbible_202504_pdf/.
const ASSET_DIR = path.join(OUT_DIR, 'companion-bible-notes');
const ASSET_URL_BASE = '/library/companion-bible-notes/';
// One deployable bundle for the whole work, whichever books are in it.
const BUNDLE_PATH = path.join(OUT_DIR, 'companion-bible-notes.json');
const PDF_SOURCE_DIR = path.join(__dirname, 'thecompanionbible_202504_pdf');

const INDENT_UNIT = 2;
const REF_RANGE_RE = /^-?\d+(\s*[,-]\s*\d+)*-?$/;
const ANCHOR_RE = /^(.+?)\s+(\d+):(\d+)(?:\s*-\s*(\d+))?$/;

// A transcription typo must stop the build, never be guessed at — the input
// is read off a scan by eye, so a silent misparse is worse than a crash.
class TranscriptionError extends Error {
  constructor(file, lineNo, message) {
    super(`${path.basename(file)}:${lineNo}: ${message}`);
    this.name = 'TranscriptionError';
  }
}

function parseAnchor(file, lineNo, raw) {
  const m = ANCHOR_RE.exec(raw.trim());
  if (!m) {
    throw new TranscriptionError(file, lineNo, `malformed anchor "${raw.trim()}" — expected "Book C:V-V", e.g. "Philemon 1:1-25"`);
  }
  const [, book, chapter, start, end] = m;
  return {
    anchor_book: book.trim(),
    anchor_chapter: Number(chapter),
    anchor_verse_start: Number(start),
    anchor_verse_end: end === undefined ? Number(start) : Number(end),
  };
}

function parseStructure(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const diagrams = [];
  let current = null;
  // lines of the open diagram not yet claimed by a [[group:]] marker
  let ungrouped = [];

  const requireDiagram = (lineNo, what) => {
    if (!current) throw new TranscriptionError(file, lineNo, `${what} appears before any [[diagram: ...]]`);
    return current;
  };

  raw.split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;
    if (line.trim() === '' || line.trim().startsWith('#')) return;

    const directive = /^\s*\[\[([\w-]+)\s*:\s*(.*?)\]\]\s*$/.exec(line);
    if (directive) {
      const [, kind, value] = directive;
      if (kind === 'diagram') {
        if (current) closeDiagram(file, lineNo, current, ungrouped);
        current = { title: value.trim(), anchor: null, pdfSource: null, reference_pdf_path: null,
                    reference_pdf_page: null, lines: [], groups: new Map() };
        ungrouped = [];
        diagrams.push(current);
        if (!current.title) throw new TranscriptionError(file, lineNo, 'empty diagram title');
        return;
      }
      if (kind === 'anchor') {
        const d = requireDiagram(lineNo, '[[anchor:]]');
        if (d.anchor) throw new TranscriptionError(file, lineNo, `diagram "${d.title}" already has an anchor`);
        d.anchor = parseAnchor(file, lineNo, value);
        return;
      }
      if (kind === 'pdf') {
        const d = requireDiagram(lineNo, '[[pdf:]]');
        const name = value.trim();
        if (!name) throw new TranscriptionError(file, lineNo, 'empty pdf filename');
        const src = path.join(PDF_SOURCE_DIR, name);
        if (!fs.existsSync(src)) {
          throw new TranscriptionError(file, lineNo, `no such PDF: ${path.relative(__dirname, src)}`);
        }
        d.pdfSource = src;
        return;
      }
      if (kind === 'pdf-page') {
        const d = requireDiagram(lineNo, '[[pdf-page:]]');
        const n = Number(value.trim());
        if (!Number.isInteger(n) || n < 1) {
          throw new TranscriptionError(file, lineNo, `pdf page must be a positive whole number, got "${value.trim()}"`);
        }
        d.reference_pdf_page = n;
        return;
      }
      if (kind === 'group') {
        const d = requireDiagram(lineNo, '[[group:]]');
        const label = value.trim();
        if (!label) throw new TranscriptionError(file, lineNo, 'empty group label');
        if (ungrouped.length === 0) {
          throw new TranscriptionError(file, lineNo, `[[group: ${label}]] claims no lines — every line before it already belongs to an earlier group`);
        }
        // Re-using a label merges: Bullinger's correspondence pairs sit at
        // opposite ends of the outline, so a group is often non-contiguous.
        const members = d.groups.get(label) ?? [];
        d.groups.set(label, members.concat(ungrouped));
        ungrouped = [];
        return;
      }
      throw new TranscriptionError(file, lineNo, `unknown directive [[${kind}: ...]]`);
    }

    if (/^\s*\[\[/.test(line)) {
      throw new TranscriptionError(file, lineNo, 'malformed directive — expected [[name: value]]');
    }

    // ---- content line ----
    const d = requireDiagram(lineNo, 'an outline line');
    const indent = line.length - line.trimStart().length;
    if (/^\t/.test(line)) throw new TranscriptionError(file, lineNo, 'tab indentation — use exactly 2 spaces per level');
    if (indent % INDENT_UNIT !== 0) {
      throw new TranscriptionError(file, lineNo, `indent of ${indent} space(s) is not a multiple of ${INDENT_UNIT}`);
    }
    const depth = indent / INDENT_UNIT;

    const parts = line.trim().split('|');
    if (parts.length !== 3) {
      throw new TranscriptionError(file, lineNo, `expected exactly 2 "|" separators (LABEL | REF_RANGE | TEXT), found ${parts.length - 1}`);
    }
    const label = parts[0].trim();
    const refRange = parts[1].trim();
    const text = parts[2].trim();
    if (!label) throw new TranscriptionError(file, lineNo, 'missing LABEL');
    if (refRange && !REF_RANGE_RE.test(refRange)) {
      throw new TranscriptionError(file, lineNo, `malformed REF_RANGE "${refRange}" — expected forms like "3", "1, 2", "4-6", "7-", "-19", "18, 19-"`);
    }
    if (!text && refRange) {
      throw new TranscriptionError(file, lineNo, `line has a REF_RANGE but no TEXT — a bracket line spans members and carries neither`);
    }

    const prev = d.lines[d.lines.length - 1];
    if (depth > 0 && !prev) {
      throw new TranscriptionError(file, lineNo, `line starts at depth ${depth}; the first line of a diagram must be at depth 0`);
    }
    // Indentation may normally only step in one level at a time — a bigger
    // jump is the signature of a mis-transcribed indent. The exception is a
    // bracket line, where the page itself steps several levels in to open a
    // block (Bullinger prints a correspondence as a staircase).
    if (prev && depth > prev.depth + 1 && prev.text !== null) {
      throw new TranscriptionError(file, lineNo, `depth jumps from ${prev.depth} to ${depth} — indentation may only increase one level at a time, except directly after a bracket line`);
    }
    // Nearest preceding shallower line. Under the staircase this follows the
    // page's printed nesting rather than a flat sibling grouping — see the
    // "Depth and the staircase" section of README.md.
    let parent = null;
    if (depth > 0) {
      for (let k = d.lines.length - 1; k >= 0; k--) {
        if (d.lines[k].depth < depth) { parent = d.lines[k].idx; break; }
      }
      if (parent === null) {
        throw new TranscriptionError(file, lineNo, `no shallower line precedes this line to act as its parent`);
      }
    }

    const entry = {
      idx: d.lines.length,
      lineNo,
      depth,
      parent,
      label,
      ref_range: refRange || null,
      text: text || null,
    };
    d.lines.push(entry);
    ungrouped.push(entry.idx);
  });

  if (current) closeDiagram(file, raw.split(/\r?\n/).length, current, ungrouped);
  if (diagrams.length === 0) throw new TranscriptionError(file, 1, 'no [[diagram: ...]] found');
  return diagrams;
}

function closeDiagram(file, lineNo, d, ungrouped) {
  if (!d.anchor) throw new TranscriptionError(file, lineNo, `diagram "${d.title}" has no [[anchor: ...]]`);
  if (d.lines.length === 0) throw new TranscriptionError(file, lineNo, `diagram "${d.title}" has no outline lines`);
  // Lines left ungrouped are fine — not every diagram has brace groups.
  // A bracket line exists only to nest members under it; one with no
  // children is a transcription slip (usually a missed indent below it).
  const hasChild = new Set(d.lines.map((l) => l.parent).filter((p) => p !== null));
  for (const l of d.lines) {
    if (l.text === null && !hasChild.has(l.idx)) {
      throw new TranscriptionError(file, l.lineNo, `bracket line "${l.label}" has no TEXT and no child lines`);
    }
  }
}

function parseProse(file) {
  if (!fs.existsSync(file)) return { notes: [], heading: null };
  const notes = [];
  let heading = null;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const lineNo = i + 1;
    if (line.trim() === '' || line.trim().startsWith('#')) return;
    // The page's own heading over the introductory notes.
    const h = /^\s*\[\[heading\s*:\s*(.*?)\]\]\s*$/.exec(line);
    if (h) {
      if (heading) throw new TranscriptionError(file, lineNo, 'more than one [[heading: ...]]');
      heading = h[1].trim();
      if (!heading) throw new TranscriptionError(file, lineNo, 'empty heading');
      return;
    }
    const sep = line.indexOf('|');
    if (sep === -1) throw new TranscriptionError(file, lineNo, 'expected "VERSE | TEXT"');
    const verseRaw = line.slice(0, sep).trim();
    const text = line.slice(sep + 1).trim();
    if (!/^\d+$/.test(verseRaw)) throw new TranscriptionError(file, lineNo, `malformed verse number "${verseRaw}"`);
    if (!text) throw new TranscriptionError(file, lineNo, `note for verse ${verseRaw} has no text`);
    // Verse 0 is a book-level introductory note — Bullinger prints a few
    // before the text itself. Carried through as verse null.
    const verse = Number(verseRaw);
    notes.push({ verse: verse === 0 ? null : verse, text });
  });
  return { notes, heading };
}

// Parses one book's transcription and returns its compiled shape, copying
// any referenced page scan into the bundle directory on the way.
function compileBook(slug) {
  const structureFile = path.join(__dirname, `${slug}.structure.txt`);
  const notesFile = path.join(__dirname, `${slug}.notes.txt`);

  if (!fs.existsSync(structureFile)) {
    console.error(`No structure file at ${structureFile}`);
    process.exit(1);
  }

  let diagrams;
  let prose;
  try {
    diagrams = parseStructure(structureFile);
    prose = parseProse(notesFile);
  } catch (err) {
    if (err instanceof TranscriptionError) {
      console.error(`\n  ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }

  const compiled = {
    book: diagrams[0].anchor.anchor_book,
    slug,
    diagrams: diagrams.map((d) => ({
      title: d.title,
      ...d.anchor,
      reference_pdf_path: d.reference_pdf_path,
      reference_pdf_page: d.reference_pdf_page,
      lines: d.lines.map((l) => ({
        idx: l.idx,
        parent: l.parent,
        depth: l.depth,
        label: l.label,
        ref_range: l.ref_range,
        text: l.text,
      })),
      groups: [...d.groups.entries()].map(([label, members]) => ({ label, members })),
    })),
    prose: prose.notes,
    prose_heading: prose.heading,
  };

  // Copy each referenced page scan in beside the bundle, under a slug the
  // app can put in a URL — the archive's own filenames carry spaces and
  // leading numbers. Done here so the app ships everything it needs.
  for (let i = 0; i < diagrams.length; i++) {
    const d = diagrams[i];
    if (!d.pdfSource) continue;
    fs.mkdirSync(ASSET_DIR, { recursive: true });
    const asset = `${slug}-pages.pdf`;
    fs.copyFileSync(d.pdfSource, path.join(ASSET_DIR, asset));
    compiled.diagrams[i].reference_pdf_path = ASSET_URL_BASE + asset;
  }
  return compiled;
}

function report(compiled) {
  console.log(`\n  ${compiled.book}`);
  for (const d of compiled.diagrams) {
    const withText = d.lines.filter((l) => l.text !== null).length;
    console.log(`    ${d.title}`);
    console.log(`      ${d.anchor_book} ${d.anchor_chapter}:${d.anchor_verse_start}-${d.anchor_verse_end}`);
    console.log(`      ${d.lines.length} lines (${withText} with text, ${d.lines.length - withText} bracket)`);
    for (const g of d.groups) console.log(`      group "${g.label}": ${g.members.length} lines`);
    console.log(`      page scan: ${d.reference_pdf_path ? `${d.reference_pdf_path} p.${d.reference_pdf_page ?? 1}` : '(none)'}`);
  }
  const verses = compiled.prose.filter((p) => p.verse !== null).length;
  console.log(`    ${verses} verse notes, ${compiled.prose.length - verses} introductory`
    + ` (heading: ${compiled.prose_heading ?? 'none'})`);
}

// Every book that has been transcribed, in the order their .structure.txt
// files appear — canonical order is imposed later, by the importer.
function transcribedSlugs() {
  return fs.readdirSync(__dirname)
    .filter((f) => f.endsWith('.structure.txt'))
    .map((f) => f.slice(0, -'.structure.txt'.length))
    .sort();
}

function main() {
  const args = process.argv.slice(2);
  const bookArg = args.find((a) => a.startsWith('--book='));
  const all = args.includes('--all');

  const slugs = all ? transcribedSlugs() : [bookArg ? bookArg.slice('--book='.length) : 'philemon'];
  if (slugs.length === 0) {
    console.error('No *.structure.txt files found — nothing to compile.');
    process.exit(1);
  }

  const books = slugs.map(compileBook);

  const bundle = {
    provenance: {
      work: 'The Companion Bible',
      author: 'E. W. Bullinger',
      published: 1913,
      license: 'Public domain (author died 1913).',
      transcribedFrom:
        'Internet Archive scan thecompanionbible_202504 (page image, HOCR, PDF and EPUB '
        + 'renderings), transcribed by hand. See companion-bible-notes/README.md.',
    },
    books,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(BUNDLE_PATH, JSON.stringify(bundle, null, 2) + '\n', 'utf8');

  books.forEach(report);
  const totalNotes = books.reduce((n, b) => n + b.prose.length, 0);
  const totalLines = books.reduce((n, b) => n + b.diagrams.reduce((m, d) => m + d.lines.length, 0), 0);
  console.log(`\n  ${books.length} book(s), ${totalLines} outline lines, ${totalNotes} notes`);
  if (!all) console.log('  (single-book build — run with --all to compile the deployable bundle)');
  console.log(`  wrote ${path.relative(path.join(__dirname, '..'), BUNDLE_PATH)}\n`);
}

main();
