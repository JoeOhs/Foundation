// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads the ThML XML of Ante-Nicene Fathers, Volume 1 from CCEL
// (ccel.org), parses the div hierarchy, strips editorial footnotes, and writes
// anf01.json — a bundle shaped to feed Foundation's compound-work import
// (one source, many books, a multi-level toc_entries hierarchy).
//
// PROVENANCE — Ante-Nicene Fathers, Vol. 1: The Apostolic Fathers with Justin
// Martyr and Irenaeus. Edited by Alexander Roberts and James Donaldson;
// revised and chronologically arranged with brief prefaces and occasional
// notes by A. Cleveland Coxe. American edition first published 1885 by the
// Christian Literature Publishing Co., Buffalo, NY. Original texts first
// published 1867 (Edinburgh). Public domain — first published in the U.S.
// before 1929. CCEL hosts the text under an open license.
//
// FOOTNOTES: The Roberts/Donaldson translation notes and Coxe's additional
// annotations for the American edition are EXCLUDED from entries.text. ThML
// marks them as <note> elements; they are stripped during extraction. They are
// NOT captured into a separate table for this proof-of-concept — full
// exclusion, not partial leaking.
//
// Resumable: raw XML is cached under raw/, so a re-run skips the download.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const OUTPUT_PATH = path.join(__dirname, 'anf01.json');
const DEPLOY_PATH = path.join(__dirname, '..', 'public', 'library', 'anf01.json');

const THML_URL = 'https://ccel.org/ccel/s/schaff/anf01.xml';
const USER_AGENT =
  'FoundationANFBuilder/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

// ---------- download ----------

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadRaw(refetch) {
  const cachePath = path.join(RAW_DIR, 'anf01.xml');
  if (!refetch) {
    try {
      const cached = await fs.readFile(cachePath, 'utf8');
      if (cached.length > 10_000) return cached;
    } catch { /* not cached */ }
  }
  console.log('Downloading ThML XML from CCEL…');
  const text = await fetchText(THML_URL);
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(cachePath, text, 'utf8');
  return text;
}

// ---------- ThML parsing ----------

// Strip all <note> elements (editorial footnotes). Notes can contain nested
// tags but never nest other <note> elements, so a non-greedy match works.
function stripNotes(xml) {
  return xml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, '');
}

// Strip <index> elements (CCEL subject-index markers, not visible content).
function stripIndexes(xml) {
  return xml.replace(/<index\b[^>]*\/>/gi, '');
}

// Strip <pb> page-break elements.
function stripPageBreaks(xml) {
  return xml.replace(/<pb\b[^>]*\/?>/gi, '');
}

// Extract an attribute value from an XML tag string.
function attr(tag, name) {
  const re = new RegExp(`${name}="([^"]*)"`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

// Convert ThML inline markup to plain text. Preserves paragraph boundaries.
function stripTags(html) {
  return html
    // <scripRef> → just the text inside
    .replace(/<scripRef\b[^>]*>([\s\S]*?)<\/scripRef>/gi, '$1')
    // <span> of any class → just text inside
    .replace(/<span\b[^>]*>([\s\S]*?)<\/span>/gi, '$1')
    // <i>, <b>, <em>, <strong> → just text
    .replace(/<\/?(i|b|em|strong|sup|sub|u)\b[^>]*>/gi, '')
    // <br/> → newline
    .replace(/<br\s*\/?>/gi, '\n')
    // Any remaining self-closing tags
    .replace(/<[^>]+\/>/g, '')
    // Any remaining opening/closing tags
    .replace(/<\/?\w[^>]*>/g, '')
    // HTML entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&\w+;/g, '') // remaining entities → drop
    .trim();
}

// Normalize whitespace within a paragraph: collapse runs of spaces/tabs,
// but preserve intentional double-newlines as paragraph separators.
function normalizeParagraph(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\x00PP\x00')
    .replace(/\n/g, ' ')
    .replace(/\x00PP\x00/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// Split XML into div elements at a given level (1, 2, or 3).
// Returns an array of { tag, title, shorttitle, id, content }.
function splitDivs(xml, level) {
  const openRe = new RegExp(`<div${level}\\b([^>]*)>`, 'gi');
  const closeTag = `</div${level}>`;
  const results = [];
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    const start = m.index + m[0].length;
    // Find the matching close tag. divN elements don't nest the SAME level,
    // so the first </divN> after this open is our close.
    const end = xml.indexOf(closeTag, start);
    if (end === -1) continue;
    const content = xml.slice(start, end);
    results.push({
      tag: m[0],
      attrs: m[1],
      title: attr(m[1], 'title') || '',
      shorttitle: attr(m[1], 'shorttitle') || '',
      id: attr(m[1], 'id') || '',
      content,
    });
  }
  return results;
}

// Extract paragraphs from a chunk of ThML content (the content inside a div).
// Returns an array of plain-text paragraph strings.
function extractParagraphs(content) {
  const paragraphs = [];
  // Match <p ...>...</p> and <li ...>...</li> blocks.
  const pRe = /<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi;
  let pm;
  while ((pm = pRe.exec(content)) !== null) {
    const text = normalizeParagraph(stripTags(pm[1]));
    if (text.length > 0) paragraphs.push(text);
  }
  // If no <p> elements found, try extracting text directly (some sections
  // have bare text between heading tags).
  if (paragraphs.length === 0) {
    // Remove any nested div tags first
    const bare = content.replace(/<div\d\b[\s\S]*$/gi, '');
    const text = normalizeParagraph(stripTags(bare));
    if (text.length > 10) paragraphs.push(text);
  }
  return paragraphs;
}

// Clean up a title string: strip ThML tags, normalize whitespace.
function cleanTitle(raw) {
  return stripTags(raw).replace(/\s+/g, ' ').trim();
}

// ---------- structure extraction ----------

// Front-matter div1 IDs to skip (title page, preface, etc.).
// We keep author-group div1 sections and their content only.
const SKIP_DIV1_PATTERNS = [/^i$/i]; // div1 id="i" is the title page

function isSkippableDiv1(div) {
  // Skip if id matches known front-matter patterns
  if (SKIP_DIV1_PATTERNS.some((re) => re.test(div.id))) return true;
  // Skip if title suggests front matter (title page, not an author)
  const t = div.title.toLowerCase();
  if (t === 'title page' || t === '') return true;
  return false;
}

// Detect whether a div2 is an introductory/editorial note (keep it, but
// mark it so the TOC labels it correctly).
function isIntroNote(div2) {
  const t = div2.title.toLowerCase();
  return t.includes('introductory note') || t.includes('preface')
    || t.includes('prefatory note') || t.includes('general note');
}

function buildBundle(xml) {
  // Pre-process: strip notes, indexes, page breaks
  let clean = stripNotes(xml);
  clean = stripIndexes(clean);
  clean = stripPageBreaks(clean);

  const div1s = splitDivs(clean, 1);
  const authors = [];
  let totalSections = 0;

  for (const div1 of div1s) {
    if (isSkippableDiv1(div1)) continue;

    const authorName = cleanTitle(div1.shorttitle || div1.title);
    if (!authorName) continue;

    const div2s = splitDivs(div1.content, 2);
    const works = [];

    for (const div2 of div2s) {
      const workTitle = cleanTitle(div2.title);
      if (!workTitle) continue;

      const div3s = splitDivs(div2.content, 3);

      if (div3s.length > 0) {
        // This work has chapters/sub-sections (div3 elements).
        const chapters = [];
        for (const div3 of div3s) {
          const chTitle = cleanTitle(div3.title);
          const paragraphs = extractParagraphs(div3.content);
          if (paragraphs.length > 0) {
            chapters.push({
              number: chapters.length + 1,
              title: chTitle,
              paragraphs,
            });
            totalSections += paragraphs.length;
          }
        }
        if (chapters.length > 0) {
          works.push({ title: workTitle, chapters });
        }
      } else {
        // No div3 subdivision — this is a short work. All paragraphs
        // go into a single "chapter" (loading unit).
        const paragraphs = extractParagraphs(div2.content);
        if (paragraphs.length > 0) {
          works.push({
            title: workTitle,
            chapters: [{
              number: 1,
              title: workTitle,
              paragraphs,
            }],
          });
          totalSections += paragraphs.length;
        }
      }
    }

    // If this div1 has no div2 children but has direct content (rare),
    // treat the whole div1 as one work.
    if (div2s.length === 0) {
      const paragraphs = extractParagraphs(div1.content);
      if (paragraphs.length > 0) {
        works.push({
          title: authorName,
          chapters: [{
            number: 1,
            title: authorName,
            paragraphs,
          }],
        });
        totalSections += paragraphs.length;
      }
    }

    if (works.length > 0) {
      authors.push({ name: authorName, works });
    }
  }

  return {
    metadata: {
      title: 'Ante-Nicene Fathers, Vol. 1: The Apostolic Fathers with Justin Martyr and Irenaeus',
      series: 'Ante-Nicene Fathers',
      volume: 1,
      editors: 'Alexander Roberts, James Donaldson; rev. A. Cleveland Coxe',
      source_url: 'https://ccel.org/ccel/schaff/anf01',
      source_format: 'ThML XML',
      license_note:
        'Public domain. Edited by Alexander Roberts and James Donaldson (first published 1867, ' +
        'Edinburgh); revised for the American edition by A. Cleveland Coxe (first published 1885, ' +
        'Buffalo, NY; reprinted 1897). All editors deceased before 1930; text in the public domain ' +
        'in the United States.',
      footnotes: 'excluded',
      build_date: new Date().toISOString().slice(0, 10),
      total_paragraphs: totalSections,
    },
    authors,
  };
}

// ---------- validation ----------

function validate(bundle) {
  const { authors, metadata } = bundle;
  if (authors.length < 4) {
    throw new Error(
      `Expected at least 4 author groups (Clement, Ignatius/Polycarp/Barnabas/Papias, ` +
      `Justin Martyr, Irenaeus); got ${authors.length}. The ThML structure may have changed.`,
    );
  }
  if (metadata.total_paragraphs < 1500) {
    throw new Error(
      `Expected at least 1,500 paragraphs; got ${metadata.total_paragraphs}. ` +
      `Something went wrong with extraction.`,
    );
  }
  // Check that Irenaeus's Against Heresies is present and has multiple books.
  const irenaeus = authors.find((a) => /irenaeus|iren/i.test(a.name));
  if (!irenaeus) throw new Error('Irenaeus author group not found.');
  const ahWorks = irenaeus.works.filter((w) => /against heresies/i.test(w.title));
  if (ahWorks.length < 3) {
    throw new Error(
      `Expected multiple "Against Heresies" books for Irenaeus; found ${ahWorks.length}.`,
    );
  }
  // Check a short work exists (e.g. Clement or Polycarp)
  let hasShortWork = false;
  for (const a of authors) {
    for (const w of a.works) {
      if (w.chapters.length <= 2) hasShortWork = true;
    }
  }
  // Spot-check: no HTML/XML tags leaked into paragraph text
  let tagLeaks = 0;
  for (const a of authors) {
    for (const w of a.works) {
      for (const ch of w.chapters) {
        for (const p of ch.paragraphs) {
          if (/<[a-z]\w*[\s>]/i.test(p)) tagLeaks++;
        }
      }
    }
  }
  if (tagLeaks > 10) {
    throw new Error(
      `Found ${tagLeaks} paragraphs with leaked HTML/XML tags. ` +
      `The tag-stripping logic needs work.`,
    );
  }

  // Summary
  let totalWorks = 0;
  let totalChapters = 0;
  for (const a of authors) {
    totalWorks += a.works.length;
    for (const w of a.works) totalChapters += w.chapters.length;
  }
  console.log(`  ${authors.length} author groups`);
  console.log(`  ${totalWorks} works`);
  console.log(`  ${totalChapters} chapters/sections`);
  console.log(`  ${metadata.total_paragraphs} paragraphs`);
  if (tagLeaks > 0) console.log(`  ⚠ ${tagLeaks} paragraphs with minor tag leaks`);
}

// ---------- main ----------

async function main() {
  const refetch = process.argv.includes('--refetch');
  const raw = await loadRaw(refetch);
  console.log(`Loaded ${(raw.length / 1024 / 1024).toFixed(1)} MB of ThML XML`);

  console.log('Parsing ThML structure…');
  const bundle = buildBundle(raw);

  console.log('Validating…');
  validate(bundle);

  const json = JSON.stringify(bundle, null, 0);
  await fs.writeFile(OUTPUT_PATH, json, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);

  await fs.copyFile(OUTPUT_PATH, DEPLOY_PATH);
  console.log(`Copied to ${DEPLOY_PATH}`);
  console.log('Done.');
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
