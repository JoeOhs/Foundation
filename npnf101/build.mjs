// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads the ThML XML of Nicene and Post-Nicene Fathers, Series I,
// Volume 1 from CCEL (ccel.org), parses the div hierarchy, strips editorial
// footnotes, and writes npnf101.json — a bundle shaped to feed Foundation's
// compound-work import (one source, many books, a multi-level toc_entries
// hierarchy).
//
// PROVENANCE — Nicene and Post-Nicene Fathers, First Series, Vol. 1:
// Augustine: Prolegomena, Confessions, Letters. Edited by Philip Schaff.
// American edition first published 1886 by the Christian Literature Publishing
// Co., Buffalo, NY. Public domain — first published in the U.S. before 1929.
// CCEL hosts the text under an open license.
//
// FOOTNOTES: Schaff's editorial footnotes are EXCLUDED from entries.text.
// ThML marks them as <note> elements; they are stripped during extraction.
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
const VOLUME_ID = 'npnf101';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', 'public', 'library', `${VOLUME_ID}.json`);

const THML_URL = `https://ccel.org/ccel/s/schaff/${VOLUME_ID}.xml`;
const USER_AGENT =
  'FoundationNPNFBuilder/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

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
  const cachePath = path.join(RAW_DIR, `${VOLUME_ID}.xml`);
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

function stripNotes(xml) {
  return xml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, '');
}

function stripIndexes(xml) {
  return xml.replace(/<index\b[^>]*\/>/gi, '');
}

function stripPageBreaks(xml) {
  return xml.replace(/<pb\b[^>]*\/?>/gi, '');
}

function attr(tag, name) {
  const re = new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i');
  const m = tag.match(re);
  return m ? m[1] : null;
}

function stripTags(html) {
  return html
    .replace(/<scripRef\b[^>]*>([\s\S]*?)<\/scripRef>/gi, '$1')
    .replace(/<span\b[^>]*>([\s\S]*?)<\/span>/gi, '$1')
    .replace(/<\/?(i|b|em|strong|sup|sub|u)\b[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+\/>/g, '')
    .replace(/<\/?\w[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&\w+;/g, '')
    .trim();
}

function normalizeParagraph(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{2,}/g, '\x00PP\x00')
    .replace(/\n/g, ' ')
    .replace(/\x00PP\x00/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function splitDivs(xml, level) {
  const openRe = new RegExp(`<div${level}\\b([^>]*)>`, 'gi');
  const closeTag = `</div${level}>`;
  const results = [];
  let m;
  while ((m = openRe.exec(xml)) !== null) {
    const start = m.index + m[0].length;
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

function extractParagraphs(content) {
  const paragraphs = [];
  const pRe = /<(?:p|li)\b[^>]*>([\s\S]*?)<\/(?:p|li)>/gi;
  let pm;
  while ((pm = pRe.exec(content)) !== null) {
    const text = normalizeParagraph(stripTags(pm[1]));
    if (text.length > 0) paragraphs.push(text);
  }
  if (paragraphs.length === 0) {
    const bare = content.replace(/<div\d\b[\s\S]*$/gi, '');
    const text = normalizeParagraph(stripTags(bare));
    if (text.length > 10) paragraphs.push(text);
  }
  return paragraphs;
}

function cleanTitle(raw) {
  return stripTags(raw).replace(/\s+/g, ' ').trim();
}

// ---------- structure extraction ----------

// NPNF volumes are organized differently from ANF:
// ANF: div1 = Author group → div2 = Work → div3 = Chapter
// NPNF: div1 = Major section (work or work-group) → div2 = Book/sub-work → div3 = Chapter
// All content in a NPNF Series I volume is by one author (Augustine for Vols 1-8),
// so div1 serves as section grouping, not author grouping.

function isSkippableDiv1(div) {
  const t = div.title.toLowerCase().replace(/[‘’“”]/g, "'").replace(/[.\s]+$/, '');
  if (t === '' || t === 'title page' || t === 'preface' || t === 'contents') return true;
  if (t === 'table of contents' || t === "editor's preface") return true;
  if (/\bindex\b/i.test(t) || /\bindexes\b/i.test(t)) return true;
  return false;
}

function buildBundle(xml) {
  let clean = stripNotes(xml);
  clean = stripIndexes(clean);
  clean = stripPageBreaks(clean);

  const div1s = splitDivs(clean, 1);
  const authors = [];
  let totalSections = 0;

  for (const div1 of div1s) {
    if (isSkippableDiv1(div1)) continue;

    const sectionName = cleanTitle(div1.shorttitle || div1.title);
    if (!sectionName) continue;

    const div2s = splitDivs(div1.content, 2);
    const works = [];

    for (const div2 of div2s) {
      const workTitle = cleanTitle(div2.shorttitle || div2.title);
      if (!workTitle) continue;
      // Skip index/reference div2s
      const wLower = workTitle.toLowerCase();
      if (/\bindex\b/.test(wLower) || /\bpages?\b.*print/i.test(wLower) || wLower.replace(/[.\s]+$/, '') === 'title page') continue;

      const div3s = splitDivs(div2.content, 3);

      if (div3s.length > 0) {
        const chapters = [];
        for (const div3 of div3s) {
          const chTitle = cleanTitle(div3.shorttitle || div3.title);
          const paragraphs = extractParagraphs(div3.content);
          if (paragraphs.length > 0) {
            chapters.push({
              number: chapters.length + 1,
              title: chTitle || `Section ${chapters.length + 1}`,
              paragraphs,
            });
            totalSections += paragraphs.length;
          }
        }
        if (chapters.length > 0) {
          works.push({ title: workTitle, chapters });
        }
      } else {
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

    // If div1 has no div2 children but has direct content
    if (div2s.length === 0) {
      const paragraphs = extractParagraphs(div1.content);
      if (paragraphs.length > 0) {
        works.push({
          title: sectionName,
          chapters: [{
            number: 1,
            title: sectionName,
            paragraphs,
          }],
        });
        totalSections += paragraphs.length;
      }
    }

    if (works.length > 0) {
      authors.push({ name: sectionName, works });
    }
  }

  return {
    metadata: {
      title: 'Nicene and Post-Nicene Fathers, Series I, Vol. 1: Augustine: Prolegomena, Confessions, Letters',
      series: 'Nicene and Post-Nicene Fathers, Series I',
      volume: 1,
      editor: 'Philip Schaff',
      source_url: 'https://ccel.org/ccel/schaff/npnf101',
      source_format: 'ThML XML',
      license_note:
        'Public domain. Edited by Philip Schaff (first published 1886, Buffalo, NY, by the ' +
        'Christian Literature Publishing Co.). Editor deceased 1893; text in the public domain ' +
        'in the United States. Editorial footnotes excluded.',
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
  if (authors.length < 1) {
    throw new Error(`Expected at least 1 author group; got ${authors.length}.`);
  }
  if (metadata.total_paragraphs < 500) {
    throw new Error(
      `Expected at least 500 paragraphs; got ${metadata.total_paragraphs}. ` +
      `Something went wrong with extraction.`,
    );
  }
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

  let totalWorks = 0;
  let totalChapters = 0;
  for (const a of authors) {
    totalWorks += a.works.length;
    for (const w of a.works) totalChapters += w.chapters.length;
  }
  console.log(`  ${authors.length} author/section groups`);
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
