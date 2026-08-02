// Standalone scraper (run with `node scrape.mjs`, outside the Tauri app):
// pulls E.W. Bullinger's 198 Companion Bible Appendixes from levendwater.org
// and writes companion_bible_appendixes.json — a clean bundle shaped to feed
// Foundation's freeform-entry + toc_entries import model. Scrape-and-clean
// only; does not touch src-tauri/, src/db.ts, or src/importer.ts, and is not
// wired into the app's import pipeline.
//
// Resumable: raw HTML is cached under raw/, and manifest.json tracks per-
// appendix fetch status, so a re-run skips pages already downloaded and only
// retries ones that previously failed.
//
// Usage:
//   node scrape.mjs                  full run, appendixes 1-198
//   node scrape.mjs --only=1,3,50     just these appendix numbers (testing)
//   node scrape.mjs --limit=10        first N appendixes only (testing)

import { JSDOM } from 'jsdom';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = 'https://levendwater.org/companion/';
const INDEX_URL = new URL('index_companion.html', BASE).toString();
const RAW_DIR = path.join(__dirname, 'raw');
const MANIFEST_PATH = path.join(__dirname, 'manifest.json');
const OUTPUT_PATH = path.join(__dirname, 'companion_bible_appendixes.json');
const REQUEST_DELAY_MS = 800;
const USER_AGENT =
  'FoundationBibleAppendixScraper/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, { retries = 2, timeoutMs = 20000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return await res.text();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) await sleep(1000 * (attempt + 1));
    }
  }
  throw lastErr;
}

async function fetchCached(key, url) {
  const file = path.join(RAW_DIR, `${key}.html`);
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    const text = await fetchText(url);
    await fs.writeFile(file, text, 'utf8');
    await sleep(REQUEST_DELAY_MS + Math.floor(Math.random() * 300));
    return text;
  }
}

async function loadManifest() {
  try {
    return JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  } catch {
    return {};
  }
}

async function saveManifest(manifest) {
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

// The index page lists all 198 appendixes as <li><a href="/companion/appendN.html">
// Title</a></li>, except Appendix 179, whose entry is split into three
// in-page-fragment links (append179.html#times/#begetting/#abia) plus a
// separate map sub-page (append179a.html) with no number of its own. Detect
// that pattern generically (any href with a trailing letter after the number)
// rather than hardcoding it, in case the source ever restructures further.
function parseIndex(html) {
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const anchors = Array.from(doc.querySelectorAll('ol a[href]'));
  const list = new Map(); // number -> title
  const subpages = new Map(); // number -> Set(absolute url)
  const order = [];
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    const m = href.match(/append(\d+)([a-z]?)\.html/i);
    if (!m) continue;
    const num = parseInt(m[1], 10);
    const suffix = m[2].toLowerCase();
    if (suffix) {
      const url = new URL(href, BASE).toString();
      if (!subpages.has(num)) subpages.set(num, new Set());
      subpages.get(num).add(url);
      continue;
    }
    if (!list.has(num)) {
      list.set(num, a.textContent.replace(/\s+/g, ' ').trim());
      order.push(num);
    }
  }
  if (list.has(179)) list.set(179, 'Parallel Datings of the Times of our Lord');
  order.sort((x, y) => x - y);
  return { list, order, subpages };
}

// Extracts the real appendix content from a page's single content <TD>,
// stripping the leading title banner (a top-level <CENTER> with the
// rechtstitel/subkop spans) and the trailing site chrome (Print button,
// Home/About/Site Map footer) that starts at the "Appendix List" link.
// A handful of sub-pages (e.g. append179a.html) have no separate footer and
// nest their entire real content inside that same title <CENTER> — detected
// generically by checking whether anything meaningful follows it.
function extractContentContainer(dom) {
  const doc = dom.window.document;
  const td = doc.querySelector('td');
  if (!td) return doc.createElement('div');
  const children = Array.from(td.childNodes);
  const isMeaningful = (n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim() !== '');
  const centerIdx = children.findIndex((n) => n.nodeType === 1 && n.tagName === 'CENTER');
  const footerAnchor = Array.from(td.querySelectorAll('a[href]')).find(
    (a) => (a.getAttribute('href') || '').toLowerCase() === 'index_companion.html'
  );
  let endIdx = children.length;
  if (footerAnchor) {
    const i = children.findIndex((c) => c === footerAnchor || (c.nodeType === 1 && c.contains(footerAnchor)));
    if (i !== -1) endIdx = i;
  }
  let startIdx = 0;
  if (centerIdx !== -1 && children.slice(centerIdx + 1, endIdx).some(isMeaningful)) {
    startIdx = centerIdx + 1;
  }
  const container = doc.createElement('div');
  for (const node of children.slice(startIdx, endIdx)) container.appendChild(node.cloneNode(true));
  return container;
}

function renderTable(tableEl) {
  const tbody = tableEl.querySelector(':scope > tbody') || tableEl;
  const rowEls = Array.from(tbody.children).filter((c) => c.tagName === 'TR');
  if (!rowEls.length) return '';
  const rows = rowEls.map((tr) =>
    Array.from(tr.children)
      .filter((c) => c.tagName === 'TD' || c.tagName === 'TH')
      .map((cell) =>
        Array.from(cell.childNodes)
          .map(walk)
          .join('')
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/\|/g, '\\|')
      )
  );
  const colCount = Math.max(...rows.map((r) => r.length));
  const consistent = colCount > 0 && rows.every((r) => r.length === colCount);
  if (!consistent) {
    // Ragged table (merged/rowspan cells) — a strict Markdown table would
    // misalign columns, so fall back to one plain line per row.
    return `\n\n${rows.map((r) => r.join(' | ')).join('\n')}\n\n`;
  }
  const lines = [
    `| ${rows[0].join(' | ')} |`,
    `| ${rows[0].map(() => '---').join(' | ')} |`,
    ...rows.slice(1).map((r) => `| ${r.join(' | ')} |`),
  ];
  return `\n\n${lines.join('\n')}\n\n`;
}

// Ported from src/notesconvert.ts's htmlToMarkdown walker (same tag
// conventions: heading levels, blockquote/list handling, bold/italic), with
// three deliberate additions for this source:
//  - TABLE: Bullinger's chronology charts render as HTML tables with no
//    Markdown equivalent in the notes importer.
//  - IMG: a few appendixes (diagrams, one map) embed illustrations; images
//    aren't fetched, so a plain-text placeholder marks where one was.
//  - SPAN.subkop/.rechtstitel: the source has no real <h1>-<h6> tags, so
//    these site-specific classes are the only signal of an in-body section
//    header — bolded so structure survives instead of reading as one block.
//  - A (anchors) is intentionally NOT special-cased the way notesconvert
//    does: every link here is either a footer/chrome link (already
//    stripped) or a cross-appendix reference, and per this project's
//    "no levendwater.org URLs in body_markdown" rule, none should survive
//    as a Markdown link — cross-references are captured separately
//    (extractLinkRefs) and the link's inner text is kept in place instead.
function walk(node) {
  if (node.nodeType === 3) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== 1) return '';
  const el = node;
  const inner = Array.from(el.childNodes).map(walk).join('');
  switch (el.tagName) {
    case 'H1':
      return `\n# ${inner.trim()}\n\n`;
    case 'H2':
      return `\n## ${inner.trim()}\n\n`;
    case 'H3':
      return `\n### ${inner.trim()}\n\n`;
    case 'H4':
    case 'H5':
    case 'H6':
      return `\n#### ${inner.trim()}\n\n`;
    case 'P':
      return `${inner.trim()}\n\n`;
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B':
      return inner.trim() ? `**${inner.trim()}**` : '';
    case 'EM':
    case 'I':
      return inner.trim() ? `*${inner.trim()}*` : '';
    case 'LI': {
      const ordered = el.parentElement?.tagName === 'OL';
      return `${ordered ? '1.' : '-'} ${inner.trim()}\n`;
    }
    case 'UL':
    case 'OL':
      return `${inner}\n`;
    case 'BLOCKQUOTE':
      return `${inner
        .trim()
        .split('\n')
        .map((l) => `> ${l}`)
        .join('\n')}\n\n`;
    case 'CODE':
      return `\`${inner}\``;
    case 'PRE':
      return `\n\`\`\`\n${inner.trim()}\n\`\`\`\n\n`;
    case 'HR':
      return `\n---\n\n`;
    case 'IMG': {
      const alt = (el.getAttribute('alt') || '').trim();
      const label = alt ? `Illustration: ${alt}` : 'Illustration omitted';
      return `\n\n*[${label} — not reproduced in this text-only import]*\n\n`;
    }
    case 'SPAN':
    case 'CENTER':
    case 'DIV': {
      // The source has no real <h1>-<h6> tags; these site classes (seen on
      // SPAN, CENTER, and DIV alike — including the "subkop_bruin" variant)
      // are the only signal of an in-body section header.
      const cls = el.getAttribute('class') || '';
      if (/subkop|rechtstitel/i.test(cls)) {
        const t = inner.trim();
        if (!t) return '';
        // Don't double-wrap content that already carries its own emphasis
        // (e.g. an IMG placeholder), which would otherwise stack into `***`.
        if (t.startsWith('*') && t.endsWith('*')) return `\n\n${t}\n\n`;
        return `\n\n**${t}**\n\n`;
      }
      return inner;
    }
    case 'TABLE':
      return renderTable(el);
    default:
      return inner;
  }
}

function nodeToMarkdown(node) {
  return walk(node).replace(/\n{3,}/g, '\n\n').trim();
}

function extractLinkRefs(container) {
  const nums = new Set();
  for (const a of container.querySelectorAll('a[href]')) {
    const m = (a.getAttribute('href') || '').match(/append(\d+)[a-z]?\.html/i);
    if (m) nums.add(parseInt(m[1], 10));
  }
  return nums;
}

// Best-effort textual cross-reference scan for mentions that aren't
// hyperlinked in the source, e.g. "Ap. 50" or "Appendix 10". Anything
// ambiguous (out-of-range number, or a number immediately followed by
// ":<digit>" — which usually means a chapter:verse citation rather than an
// appendix number) is logged for manual review instead of guessed at.
function extractTextRefs(text, ownNumber) {
  const refs = new Set();
  const review = [];
  const re = /\bAppendix(?:es)?\.?\s+(\d{1,3})\b|\bAps?\.\s*(\d{1,3})\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[1] || m[2];
    const num = parseInt(raw, 10);
    const matchEnd = m.index + m[0].length;
    const after = text.slice(matchEnd, matchEnd + 3);
    const context = text.slice(Math.max(0, m.index - 25), matchEnd + 25).replace(/\s+/g, ' ');
    if (/^:\d/.test(after)) {
      review.push({ appendix: ownNumber, match: m[0], context, reason: 'looks like a scripture chapter:verse citation' });
      continue;
    }
    if (num < 1 || num > 198) {
      review.push({ appendix: ownNumber, match: m[0], context, reason: `number ${num} out of valid appendix range 1-198` });
      continue;
    }
    refs.add(num);
  }
  return { refs, review };
}

function buildAppendix(number, title, sourceUrl, containers) {
  const linkRefs = new Set();
  const bodies = [];
  for (const container of containers) {
    for (const n of extractLinkRefs(container)) linkRefs.add(n);
    bodies.push(nodeToMarkdown(container));
  }
  const body_markdown = bodies
    .map((b) => b.trim())
    .filter(Boolean)
    .join('\n\n---\n\n');
  const { refs: textRefs, review } = extractTextRefs(body_markdown, number);
  const references = Array.from(new Set([...linkRefs, ...textRefs]))
    .filter((n) => n >= 1 && n <= 198 && n !== number)
    .sort((a, b) => a - b);
  return { appendix: { number, title, body_markdown, references, source_url: sourceUrl }, review };
}

function parseArgs(argv) {
  const only = argv.find((a) => a.startsWith('--only='));
  const limit = argv.find((a) => a.startsWith('--limit='));
  return {
    only: only ? only.slice('--only='.length).split(',').map((s) => parseInt(s.trim(), 10)) : null,
    limit: limit ? parseInt(limit.slice('--limit='.length), 10) : null,
  };
}

async function main() {
  await fs.mkdir(RAW_DIR, { recursive: true });
  const { only, limit } = parseArgs(process.argv.slice(2));

  console.log('Fetching index page...');
  const indexHtml = await fetchCached('index_companion', INDEX_URL);
  const { list, order, subpages } = parseIndex(indexHtml);

  const missing = [];
  for (let n = 1; n <= 198; n++) if (!list.has(n)) missing.push(n);
  console.log(`Index lists ${order.length} appendixes (expected 198). Missing: ${missing.join(', ') || 'none'}.`);
  if (missing.length > 0 || order.length !== 198) {
    console.error('Index does not account for all 198 appendixes as expected — stopping instead of guessing.');
    process.exitCode = 1;
    return;
  }

  let numbers = order;
  if (only) numbers = order.filter((n) => only.includes(n));
  if (limit) numbers = numbers.slice(0, limit);

  const manifest = await loadManifest();
  const appendixes = [];
  const failed = [];
  const reviewNotes = [];

  for (const number of numbers) {
    const mainUrl = new URL(`append${number}.html`, BASE).toString();
    const subUrls = Array.from(subpages.get(number) || []);
    process.stdout.write(`Appendix ${number}/198... `);
    try {
      const mainHtml = await fetchCached(`append${number}`, mainUrl);
      const subHtmls = [];
      for (const subUrl of subUrls) {
        const key = subUrl.split('/').pop().replace(/\.html?$/i, '');
        subHtmls.push(await fetchCached(key, subUrl));
      }
      const containers = [mainHtml, ...subHtmls].map((html) => extractContentContainer(new JSDOM(html)));
      const { appendix, review } = buildAppendix(number, list.get(number), mainUrl, containers);
      if (review.length) reviewNotes.push(...review);
      appendixes.push(appendix);
      manifest[number] = { status: 'ok' };
      console.log('ok');
    } catch (err) {
      console.log(`FAILED (${err.message})`);
      manifest[number] = { status: 'failed', error: String(err.message || err), url: mainUrl };
      failed.push(number);
    }
    await saveManifest(manifest);
  }

  const output = {
    metadata: {
      scrape_date: new Date().toISOString().slice(0, 10),
      source_site: 'https://levendwater.org/companion/',
      source_index_url: INDEX_URL,
      author: 'E.W. Bullinger (1837-1913)',
      work: 'Appendixes to The Companion Bible',
      license_note:
        'Public domain — E.W. Bullinger died in 1913. Text as hosted by Levend Water (levendwater.org/companion/); scraped for personal, non-commercial, offline study use in Foundation.',
      total_appendixes_expected: 198,
      total_appendixes_scraped: appendixes.length,
      failed_appendixes: failed,
      manual_review_notes: reviewNotes,
    },
    appendixes: appendixes.sort((a, b) => a.number - b.number),
  };
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`\nWrote ${OUTPUT_PATH}`);
  console.log(
    `Scraped ${appendixes.length}/${numbers.length} requested. Failed: ${failed.join(', ') || 'none'}. Review notes: ${reviewNotes.length}.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
