// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads the William Davidson Talmud — Rabbi Adin Even-Israel
// Steinsaltz's English translation of the Babylonian Talmud, published by
// Sefaria and underwritten by the William Davidson Foundation — and writes
// one bundle per Seder, shaped to feed Foundation's compound-work import
// (one source, many books, a 3-level toc_entries hierarchy).
//
// Download-and-clean only: does not touch src-tauri/, src/db.ts or
// src/importer.ts, and is not part of the app runtime. The app never talks
// to Sefaria — it reads the bundles this script leaves under public/library/.
//
// ---------------------------------------------------------------------------
// LICENSE — READ BEFORE CHANGING ANYTHING BELOW.
//
// This is the ONLY text in Foundation's Library that is not public domain,
// and it is a deliberate, signed-off exception rather than a precedent. Every
// other Library work (Smith's Dictionary, JFB, Josephus, the 37 Church
// Fathers volumes) was individually verified public domain before inclusion.
// The Steinsaltz translation is CC BY-NC 4.0: free to redistribute with
// attribution, NON-COMMERCIAL USE ONLY. Foundation is a personal, offline,
// non-commercial app that makes no money, so it is inside those terms — but
// that is a fact about this app, not a general licence to add more non-PD
// texts. Do not generalise this exception without the same explicit sign-off.
//
// Why this edition and not a public-domain one: the only PD English Talmud is
// Michael Rodkinson's 1918 translation, which covers roughly a third of the
// tractates and was harshly criticised by contemporaries for its quality.
// Steinsaltz is complete and modern; completeness was the deciding factor.
//
// The guard below is the enforcement. Sefaria reports this version's licence
// as the bare token "CC-BY-NC" — their canonical spelling, carrying no
// version number in the field itself (the 4.0 comes from Sefaria's site-wide
// terms, not from per-text metadata). So the assertion pins the exact token
// Sefaria actually publishes: if upstream ever changes it — to a stricter
// licence, to "Copyright", to anything at all — the build fails loudly rather
// than shipping a text under terms nobody checked.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download
//   node build.mjs --no-links   skip the Talmud/Tanakh link scrape
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_TEXT_DIR = path.join(__dirname, 'raw', 'text');
const RAW_LINKS_DIR = path.join(__dirname, 'raw', 'links');
const LINKS_PATH = path.join(__dirname, 'links.json');
const DEPLOY_DIR = path.join(__dirname, '..', '..', 'public', 'library', 'rabbinic');

const API = 'https://www.sefaria.org/api';
const REQUEST_DELAY_MS = 250;
const USER_AGENT =
  'FoundationTalmudBuilder/1.0 (personal, non-commercial, offline Bible study app; ' +
  'one-time archival fetch; contact: shintax909@gmail.com)';

// The six orders of the Bavli, in their traditional shelf order. Sefaria's
// index also lists "Minor Tractates", "Guides", "Rishonim on Talmud",
// "Acharonim on Talmud" and "Modern Commentary on Talmud" under Bavli; those
// are deliberately NOT built here — the commentary tiers are pinned as future
// work in ROADMAP.md, not shipped now.
const SEDARIM = [
  { key: 'zeraim', category: 'Seder Zeraim', label: 'Seder Zeraim (Seeds)' },
  { key: 'moed', category: 'Seder Moed', label: 'Seder Moed (Appointed Times)' },
  { key: 'nashim', category: 'Seder Nashim', label: 'Seder Nashim (Women)' },
  { key: 'nezikin', category: 'Seder Nezikin', label: 'Seder Nezikin (Damages)' },
  { key: 'kodashim', category: 'Seder Kodashim', label: 'Seder Kodashim (Holy Things)' },
  { key: 'tahorot', category: 'Seder Tahorot', label: 'Seder Tahorot (Purities)' },
];

// The exact licence token Sefaria publishes for this version — see the header.
const REQUIRED_LICENSE = 'CC-BY-NC';
// The version must also *be* the William Davidson edition, not merely share
// its licence: Sefaria hosts other English Talmud versions, and a silent
// substitution would ship a different translation under this bundle's name.
const REQUIRED_VERSION_RE = /William Davidson/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, { retries = 3, timeoutMs = 120000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      // Sefaria rate-limits and occasionally 504s on large refs; back off.
      if (attempt < retries) await sleep(1500 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr?.message ?? lastErr}`);
}

// Reads a cached JSON file, or fetches and caches it. Resumable: a re-run
// after an interrupted scrape skips everything already on disk.
async function cached(dir, name, url, refetch) {
  const file = path.join(dir, `${name}.json`);
  if (!refetch) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      /* not cached yet */
    }
  }
  const data = await fetchJson(url);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data), 'utf8');
  await sleep(REQUEST_DELAY_MS);
  return data;
}

// Hard gate on licence and edition — see the header note. A version whose
// metadata doesn't match is not the text this bundle is allowed to ship, so
// the build fails rather than quietly importing it.
function assertLicense(tractate, version) {
  if (version.license !== REQUIRED_LICENSE) {
    throw new Error(
      `${tractate}: Sefaria reports license "${version.license}", not "${REQUIRED_LICENSE}". ` +
      'Refusing to build. Foundation ships this text only under CC BY-NC 4.0 (non-commercial); ' +
      'if upstream terms have changed, re-check them by hand before touching this guard.',
    );
  }
  const title = `${version.versionTitle ?? ''} ${version.versionNotes ?? ''}`;
  if (!REQUIRED_VERSION_RE.test(title)) {
    throw new Error(
      `${tractate}: version "${version.versionTitle}" is not the William Davidson edition. ` +
      'Refusing to build: only the Steinsaltz/William Davidson translation may ship in this bundle.',
    );
  }
}

// Sefaria marks Steinsaltz's own explanatory expansions apart from the literal
// Talmud text with <b>...</b>, and transliterated Hebrew/Aramaic terms with
// <i>...</i>. Foundation's entries.text is plain text everywhere — no source
// in the Library carries inline markup and no pane renders it — so the tags
// are stripped rather than shipped as literal angle brackets in the reading
// column. That loses the literal/expansion distinction; it is recorded as a
// known limitation in ROADMAP.md rather than papered over here.
function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Sefaria indexes a tractate's amudim from a notional daf 1, which no printed
// tractate has — the text always opens at 2a — so indices 0 and 1 come back
// empty and every real amud sits at index (daf - 1) * 2 + (amud === 'b' ? 1 : 0).
// Verified against Berakhot, whose 2a lands at index 2 and whose final 64a
// lands at index 126.
function dafLabel(index) {
  return `${Math.floor(index / 2) + 1}${index % 2 === 0 ? 'a' : 'b'}`;
}

async function buildTractate(title, refetch) {
  const data = await cached(
    RAW_TEXT_DIR, title,
    `${API}/v3/texts/${encodeURIComponent(title)}?version=english`,
    refetch,
  );
  const version = data.versions?.[0];
  if (!version) throw new Error(`${title}: Sefaria returned no English version.`);
  assertLicense(title, version);

  const dafim = [];
  const outer = Array.isArray(version.text) ? version.text : [];
  outer.forEach((paragraphs, i) => {
    if (!Array.isArray(paragraphs) || paragraphs.length === 0) return;
    // Paragraph-per-entry, not one entry per daf: highlights, notes and links
    // need a paragraph-sized selection unit, the same reasoning the Companion
    // Bible Appendixes and the EPUB importer already follow.
    const texts = paragraphs.map(htmlToText).filter((t) => t.length > 0);
    if (texts.length === 0) return;
    dafim.push({ ref: dafLabel(i), paragraphs: texts });
  });
  if (dafim.length === 0) throw new Error(`${title}: parsed to zero dafim.`);
  return { title, dafim };
}

// The canonical Tanakh books, from Sefaria's own index: the leaf nodes
// directly under Tanakh -> Torah / Prophets / Writings. Deliberately not a
// recursive walk, which would also collect every commentary shelved beneath a
// book — which is exactly the thing the link filter has to exclude.
async function fetchTanakhBooks() {
  const index = await fetchJson(`${API}/index/`);
  const tanakh = index.find((x) => x.category === 'Tanakh');
  if (!tanakh) throw new Error("Could not locate Tanakh in Sefaria's index.");
  const books = new Set();
  for (const section of tanakh.contents ?? []) {
    for (const node of section.contents ?? []) {
      if (node.title && !node.category) books.add(node.title);
    }
  }
  if (books.size === 0) throw new Error('Parsed zero Tanakh books from Sefaria\'s index.');
  return books;
}

// Sefaria exposes structured citation links between Talmud passages and
// Tanakh verses. Captured now, unused by the app: the verse-citation feature
// that will consume it is pinned in ROADMAP.md, and scraping alongside the
// main text is far cheaper than a second full pass later. Per-daf because the
// whole-tractate links ref reliably times out (504) on Sefaria's side.
//
// `category === 'Tanakh'` alone is NOT a sufficient filter: Sefaria shelves
// commentaries *on* Tanakh under the same category, so it admits things like
// Rabbi Sacks's "Lessons in Leadership" and "Steinsaltz Introductions to
// Tanakh" — 49 of 24,394 rows on the first full scrape. Those are commentary
// targets, not verses, and the feature this data feeds points at verses. So
// the link's `index_title` is checked against the canonical book list too.
async function scrapeLinks(tractate, dafim, refetch, tanakhBooks) {
  const out = [];
  for (const daf of dafim) {
    const ref = `${tractate} ${daf.ref}`;
    let links;
    try {
      links = await cached(
        RAW_LINKS_DIR, ref.replace(/[^\w.-]+/g, '_'),
        `${API}/links/${encodeURIComponent(ref)}?with_text=0`,
        refetch,
      );
    } catch (err) {
      // A missing links page must not sink a 5,000-request scrape — the data
      // is not consumed yet, so an incomplete capture is a warning, not a
      // build failure.
      console.warn(`  ! links for ${ref}: ${err.message}`);
      continue;
    }
    if (!Array.isArray(links)) continue;
    for (const l of links) {
      if (l.category !== 'Tanakh') continue;
      if (!tanakhBooks.has(l.index_title)) continue;
      out.push({
        talmud: l.anchorRef ?? ref,
        tanakh: l.ref,
        // The book on its own, so a consumer doesn't have to re-parse it back
        // out of the ref — multi-word names ("I Samuel", "Song of Songs")
        // make that parse more fragile than it looks.
        book: l.index_title,
        type: l.type ?? null,
      });
    }
  }
  return out;
}

async function main() {
  const refetch = process.argv.includes('--refetch');
  const skipLinks = process.argv.includes('--no-links');

  console.log('Fetching Sefaria index...');
  const index = await fetchJson(`${API}/index/`);
  const bavli = index
    .find((x) => x.category === 'Talmud')?.contents
    ?.find((x) => x.category === 'Bavli');
  if (!bavli) throw new Error("Could not locate Talmud -> Bavli in Sefaria's index.");

  const tanakhBooks = skipLinks ? null : await fetchTanakhBooks();
  if (tanakhBooks) console.log(`${tanakhBooks.size} canonical Tanakh books for link filtering`);

  await fs.mkdir(DEPLOY_DIR, { recursive: true });
  const allLinks = [];
  let grandDafim = 0;
  let grandParagraphs = 0;

  for (const seder of SEDARIM) {
    const node = bavli.contents.find((c) => c.category === seder.category);
    if (!node) throw new Error(`Sefaria's index no longer lists ${seder.category}.`);

    console.log(`\n${seder.label}`);
    const tractates = [];
    for (const t of node.contents) {
      process.stdout.write(`  ${t.title}... `);
      const built = await buildTractate(t.title, refetch);
      const paragraphs = built.dafim.reduce((n, d) => n + d.paragraphs.length, 0);
      tractates.push({ ...built, heTitle: t.heTitle ?? null, description: t.enShortDesc ?? null });
      grandDafim += built.dafim.length;
      grandParagraphs += paragraphs;
      console.log(`${built.dafim.length} dafim, ${paragraphs} paragraphs`);

      if (!skipLinks) {
        const links = await scrapeLinks(t.title, built.dafim, refetch, tanakhBooks);
        allLinks.push(...links);
        console.log(`    ${links.length} Tanakh links`);
      }
    }

    const bundle = {
      metadata: {
        build_date: new Date().toISOString().slice(0, 10),
        work: 'The William Davidson Talmud (Babylonian Talmud / Bavli)',
        seder: seder.label,
        seder_key: seder.key,
        translator: 'Rabbi Adin Even-Israel Steinsaltz',
        source_site: 'https://www.sefaria.org/',
        license: REQUIRED_LICENSE,
        license_note:
          'CC BY-NC 4.0 — NOT public domain. English translation by Rabbi Adin Even-Israel ' +
          'Steinsaltz, from the William Davidson digital edition of the Koren Noé Talmud ' +
          '(Koren Publishers Jerusalem), underwritten by the William Davidson Foundation and ' +
          'published by Sefaria. Free to share and adapt with attribution, for NON-COMMERCIAL ' +
          'use only. This is the only non-public-domain text in Foundation’s Library, ' +
          'included as a deliberate exception: the sole public-domain English Talmud ' +
          '(Rodkinson, 1918) covers roughly a third of the tractates and is of poor repute, so ' +
          'completeness decided it. Steinsaltz’s explanatory expansions are interleaved ' +
          'with the literal text, as in the printed edition.',
        tractate_count: tractates.length,
        daf_count: tractates.reduce((n, t) => n + t.dafim.length, 0),
      },
      tractates,
    };
    const out = path.join(DEPLOY_DIR, `talmud-${seder.key}.json`);
    await fs.writeFile(out, JSON.stringify(bundle), 'utf8');
    const mb = (await fs.stat(out)).size / 1024 / 1024;
    console.log(`  wrote ${out} (${mb.toFixed(1)} MB)`);
  }

  if (!skipLinks) {
    await fs.writeFile(LINKS_PATH, JSON.stringify(allLinks, null, 1), 'utf8');
    console.log(`\nwrote ${LINKS_PATH} (${allLinks.length} Talmud->Tanakh links, not yet consumed)`);
  }
  console.log(`\n${grandDafim} dafim, ${grandParagraphs} paragraphs across ${SEDARIM.length} sedarim`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
