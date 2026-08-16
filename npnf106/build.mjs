// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series I, Volume 6 from CCEL, parses, strips footnotes, writes
// npnf106.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series I, Vol. 6: Augustine: Sermon on the Mount, Harmony of the Gospels, Homilies on the Gospels.
// Edited by Philip Schaff. First published 1886–1889. Public domain.
//
// FOOTNOTES: Excluded (same as all prior patristic volumes).
//
// STRUCTURE — this volume, like Vols 5–8, mixes two shapes in one file:
// treatises whose div2s are Books (holding div3 chapters), and treatises
// whose div2s ARE the chapters. See groupDiv2s() for how the two are told
// apart; Vol. 2's one-work-per-div2 rule would shatter the latter shape.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const VOLUME_ID = 'npnf106';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', 'public', 'library', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 6;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series I, Vol. 6: Augustine: Sermon on the Mount, Harmony of the Gospels, Homilies on the Gospels';
const MIN_PARAGRAPHS = 500;

const THML_URL = `https://ccel.org/ccel/s/schaff/${VOLUME_ID}.xml`;
const USER_AGENT =
  'FoundationNPNFBuilder/1.0 (personal, non-commercial, offline Bible study app; one-time archival fetch; contact: shintax909@gmail.com)';

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
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

function stripNotes(xml) { return xml.replace(/<note\b[^>]*>[\s\S]*?<\/note>/gi, ''); }
function stripIndexes(xml) { return xml.replace(/<index\b[^>]*\/>/gi, ''); }
function stripPageBreaks(xml) { return xml.replace(/<pb\b[^>]*\/?>/gi, ''); }

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
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&\w+;/g, '')
    .trim();
}

function normalizeParagraph(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n{2,}/g, '\x00PP\x00')
    .replace(/\n/g, ' ').replace(/\x00PP\x00/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
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
    results.push({
      tag: m[0], attrs: m[1],
      title: attr(m[1], 'title') || '',
      shorttitle: attr(m[1], 'shorttitle') || '',
      id: attr(m[1], 'id') || '',
      content: xml.slice(start, end),
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

function cleanTitle(raw) { return stripTags(raw).replace(/\s+/g, ' ').trim(); }

function normalizeForMatch(t) {
  return t.toLowerCase().replace(/[‘’“”]/g, "'").replace(/[.\s]+$/, '').trim();
}

function isSkippableDiv1(div) {
  const t = normalizeForMatch(div.title);
  if (t === '' || t === 'title page' || t === 'preface' || t === 'contents') return true;
  if (t === 'table of contents' || t === "editor's preface" || t === 'credits') return true;
  if (/\bindex(es)?\b/.test(t)) return true;
  return false;
}

function isSkippableDiv2(title) {
  const t = normalizeForMatch(title);
  if (t === '' || t === 'title page') return true;
  if (/\bindex(es)?\b/.test(t)) return true;
  if (/\bpages? of the print edition\b/.test(t)) return true;
  if (/^(greek|hebrew|german|latin|french) words and phrases$/.test(t)) return true;
  return false;
}

// Editorial apparatus that opens a treatise rather than forming part of its
// argument. Kept (it's real content) but as its own single-chapter work, so
// it doesn't get swept into the run of body chapters below it.
function isFrontMatterDiv2(title) {
  const t = normalizeForMatch(title);
  return /^(preface|advertisement|argument|introduction|introductory (essay|note|notice))\b/.test(t)
    || /^(translator|editor|author)'s (preface|introductory note|introductory notice|note|notice)\b/.test(t)
    || /^(introductory note|note on the following work|extract from|retractations)\b/.test(t)
    || /^contents\b/.test(t);
}

// Resolves a div1's div2 children into works. A div2 carrying div3s is
// either a Book (its div3s are chapters) or a single long piece that merely
// happens to be subdivided — and which of those it is cannot be read off the
// div2 alone. Vol. 5's "Book I" holds 70 chapters; Vol. 8's "Psalm CXIX"
// holds 22 div3s too, but they are that one exposition's acrostic stanzas,
// and it sits in a flat run of 150 sibling Psalms.
//
// The signal that separates them is where the body text actually lives:
//
//   * Most text inside div3s → a Book container. Each div3-bearing div2
//     becomes a work; the div2s holding text directly are apparatus beside
//     the Books (a Retractations extract, a dedicatory letter) and each
//     becomes its own single-chapter work.
//   * Most text held directly by div2s → a flat run. Those div2s ARE the
//     chapters of one work named for the div1 — the shape of Vol. 8's 150
//     Psalm expositions, Vol. 7's 125 Tractates on John and Vol. 6's
//     Sermons, all of which Vol. 2's one-work-per-div2 rule would shatter
//     into dozens of one-chapter works. A subdivided member of such a run
//     stays one chapter, its div3 headings kept inline so no text or
//     structure is lost. Leading front matter is split off so the run
//     starts at the real first chapter.
function groupDiv2s(div2s, sectionName) {
  const kept = [];
  for (const div2 of div2s) {
    const title = cleanTitle(div2.title || div2.shorttitle);
    if (!title || isSkippableDiv2(title)) continue;
    const parts = splitDivs(div2.content, 3).map((div3) => ({
      title: cleanTitle(div3.title || div3.shorttitle),
      paragraphs: extractParagraphs(div3.content),
    })).filter((p) => p.paragraphs.length > 0);
    kept.push({
      title,
      parts,
      paragraphs: parts.length > 0 ? [] : extractParagraphs(div2.content),
    });
  }

  const nestedText = kept.reduce((n, d) => n + d.parts.reduce((m, p) => m + p.paragraphs.length, 0), 0);
  const directText = kept.reduce((n, d) => n + d.paragraphs.length, 0);
  const isBookContainer = nestedText > directText;

  const works = [];
  const bodyChapters = [];
  let counted = 0;

  for (const { title, parts, paragraphs } of kept) {
    if (parts.length > 0) {
      counted += parts.reduce((m, p) => m + p.paragraphs.length, 0);
      if (isBookContainer) {
        works.push({
          title,
          chapters: parts.map((p, i) => ({ number: i + 1, title: p.title || `Section ${i + 1}`, paragraphs: p.paragraphs })),
        });
      } else {
        // one chapter, div3 headings preserved as leading lines
        const merged = [];
        for (const p of parts) {
          if (p.title) merged.push(p.title);
          merged.push(...p.paragraphs);
        }
        bodyChapters.push({ number: bodyChapters.length + 1, title, paragraphs: merged });
      }
      continue;
    }

    if (paragraphs.length === 0) continue;
    counted += paragraphs.length;
    if (isBookContainer || (isFrontMatterDiv2(title) && bodyChapters.length === 0)) {
      works.push({ title, chapters: [{ number: 1, title, paragraphs }] });
    } else {
      bodyChapters.push({ number: bodyChapters.length + 1, title, paragraphs });
    }
  }

  if (bodyChapters.length > 0) works.push({ title: sectionName, chapters: bodyChapters });
  return { works, counted };
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
    const sectionName = cleanTitle(div1.title || div1.shorttitle);
    if (!sectionName) continue;

    const div2s = splitDivs(div1.content, 2);
    let works = [];

    if (div2s.length > 0) {
      const grouped = groupDiv2s(div2s, sectionName);
      works = grouped.works;
      totalSections += grouped.counted;
    } else {
      const paragraphs = extractParagraphs(div1.content);
      if (paragraphs.length > 0) {
        works = [{ title: sectionName, chapters: [{ number: 1, title: sectionName, paragraphs }] }];
        totalSections += paragraphs.length;
      }
    }

    if (works.length > 0) authors.push({ name: sectionName, works });
  }

  return {
    metadata: {
      title: VOLUME_TITLE,
      series: 'Nicene and Post-Nicene Fathers, Series I',
      volume: VOLUME_NUMBER,
      editor: 'Philip Schaff',
      source_url: `https://ccel.org/ccel/schaff/${VOLUME_ID}`,
      source_format: 'ThML XML',
      license_note:
        'Public domain. Edited by Philip Schaff (first published 1886–1889, Buffalo, NY, by the ' +
        'Christian Literature Publishing Co.). Editor deceased 1893; text in the public domain ' +
        'in the United States. Editorial footnotes excluded.',
      footnotes: 'excluded',
      build_date: new Date().toISOString().slice(0, 10),
      total_paragraphs: totalSections,
    },
    authors,
  };
}

function validate(bundle) {
  const { authors, metadata } = bundle;
  if (authors.length < 1) throw new Error(`Expected at least 1 author group; got ${authors.length}.`);
  if (metadata.total_paragraphs < MIN_PARAGRAPHS) {
    throw new Error(`Expected at least ${MIN_PARAGRAPHS} paragraphs; got ${metadata.total_paragraphs}.`);
  }

  let tagLeaks = 0;
  let noteLeaks = 0;
  for (const a of authors) {
    for (const w of a.works) {
      for (const ch of w.chapters) {
        for (const p of ch.paragraphs) {
          if (/<[a-z]\w*[\s>]/i.test(p)) tagLeaks++;
          if (/<\/?note\b/i.test(p)) noteLeaks++;
        }
      }
    }
  }
  if (noteLeaks > 0) throw new Error(`Found ${noteLeaks} paragraphs with leaked footnote markup.`);
  if (tagLeaks > 10) throw new Error(`Found ${tagLeaks} paragraphs with leaked HTML/XML tags.`);

  let totalWorks = 0, totalChapters = 0;
  for (const a of authors) { totalWorks += a.works.length; for (const w of a.works) totalChapters += w.chapters.length; }
  console.log(`  ${authors.length} author/section groups`);
  console.log(`  ${totalWorks} works`);
  console.log(`  ${totalChapters} chapters/sections`);
  console.log(`  ${metadata.total_paragraphs} paragraphs`);
  if (tagLeaks > 0) console.log(`  ⚠ ${tagLeaks} paragraphs with minor tag leaks`);
}

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

main().catch((err) => { console.error('Build failed:', err.message); process.exit(1); });
