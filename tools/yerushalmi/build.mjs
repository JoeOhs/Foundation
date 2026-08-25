// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): downloads Heinrich W. Guggenheimer's English translation of the
// Jerusalem Talmud (Talmud Yerushalmi) and writes one bundle, shaped to feed
// Foundation's compound-work import (one source, many books, a 3-level
// toc_entries hierarchy).
//
// Prior art: tools/talmud/build.mjs, which does the same job for the Bavli
// (commit 0c55e0d). This is a sibling, not a fork — see "WHY A SEPARATE
// BUILDER" below for what actually differs.
//
// Download-and-clean only: does not touch src-tauri/, src/db.ts or
// src/importer.ts, and is not part of the app runtime. The app never talks to
// Sefaria — it reads the bundle this script leaves under public/library/.
//
// ---------------------------------------------------------------------------
// LICENSE — READ BEFORE CHANGING ANYTHING BELOW.
//
// Guggenheimer's translation is CC-BY: free to redistribute and adapt with
// attribution, with NO non-commercial restriction. That is *looser* than the
// Bavli's CC BY-NC 4.0, so this text is not a second instance of that
// exception — attribution-only terms are ordinary for this Library. It is
// still not public domain, so the attribution travels with the source into
// sources.license_note and is surfaced in the Library panel.
//
// Verified against Sefaria's own published corpus: every one of the 39
// tractate files carries `"license": "CC-BY"` and the versionTitle pinned
// below. The guard in assertLicense() is the enforcement — if upstream ever
// changes those terms, the build fails loudly rather than shipping a text
// under terms nobody checked.
//
// WHY THIS EDITION. Sefaria hosts two English versions of the Yerushalmi:
//
//   * Guggenheimer (CC-BY) — 39 of 39 tractates, 12,243 non-empty segments,
//     2 empty segments in the entire corpus. Complete.
//   * "Sefaria Community Translation" (CC0) — present in only 20 tractates
//     and just 116 segments in total: 0.9% of the corpus. A stub.
//
// The CC0 licence is looser and would have been preferred on terms alone, so
// completeness was measured tractate-by-tractate rather than assumed. It is
// not close: the Community Translation is a crowd-filled placeholder, not an
// edition. Guggenheimer it is.
//
// The only public-domain English Yerushalmi (Moses Schwab, 1886) covers
// Berakhot alone — 1 of 39 tractates — and so is not viable as a Library
// source. Completeness decided this the same way it decided the Bavli.
//
// WHY A SEPARATE BUILDER (rather than a mode on tools/talmud/build.mjs):
//
//   1. Addressing. The Bavli is cited by daf/amud and needs dafLabel()'s
//      notional-daf-1 offset. The Yerushalmi is cited chapter:halakhah, is
//      1-indexed with no offset, and its text array is three levels deep
//      (Chapter -> Halakhah -> Segment) where the Bavli's is two.
//   2. Source. Sefaria's live API is not the fetch path here (see FETCH).
//   3. Footnotes. Guggenheimer's commentary is inline; the Bavli has no
//      equivalent (see htmlToText).
//
// What is genuinely shared is a ~12-line HTML-to-text helper, and even that
// diverges here for the footnote handling. Factoring a shared module for it
// would be premature — the bar tools/npnf2/shared/thml.mjs met was a real
// parser, not a tag-stripper.
//
// FETCH — Sefaria publishes its complete corpus, with the same per-version
// metadata the API returns (license, versionTitle, versionSource), to a
// public Google Cloud Storage bucket: github.com/Sefaria/Sefaria-Export. That
// is the fetch path used here. It is Sefaria's own published data, it needs
// no API key and no rate-limit backoff, and each tractate is a single
// request rather than one-per-daf. The licence guard reads the same fields
// off it that the Bavli builder reads off the API response.
//
// Usage:
//   node build.mjs              download (or reuse cache) and build
//   node build.mjs --refetch    ignore the cache and re-download
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const DEPLOY_DIR = path.join(__dirname, '..', '..', 'public', 'library', 'rabbinic');

const BUCKET = 'https://storage.googleapis.com/sefaria-export';
const VERSION_FILE =
  'The Jerusalem Talmud, translation and commentary by ' +
  'Heinrich W. Guggenheimer. Berlin, De Gruyter, 1999-2015';

// The exact licence token Sefaria publishes for this version — see the header.
const REQUIRED_LICENSE = 'CC-BY';
// The version must also *be* Guggenheimer's translation, not merely share its
// licence: Sefaria hosts another English Yerushalmi (the 0.9%-complete
// Community Translation), and a silent substitution would ship a stub under
// this bundle's name.
const REQUIRED_VERSION_RE = /Guggenheimer/i;

// The Yerushalmi's tractates, by Seder, in traditional shelf order. Sefaria's
// export lists them alphabetically and carries no canonical ordering, so the
// order is pinned here and cross-checked against the export in main(): a
// tractate that appears upstream but not below (or vice versa) fails the
// build rather than being silently dropped or shelved out of order.
//
// Only five Sedarim have Yerushalmi content. Seder Kodashim has no Yerushalmi
// at all, and Seder Tahorot survives only as Niddah — that is a fact about
// the work, not a gap in this build. Sefaria's index also shelves
// "Commentary" and "Modern Commentary on Talmud" under Yerushalmi; those are
// deliberately NOT built here, matching the Bavli.
const SEDARIM = [
  {
    key: 'zeraim', label: 'Seder Zeraim (Seeds)',
    tractates: [
      'Berakhot', 'Peah', 'Demai', 'Kilayim', 'Sheviit', 'Terumot',
      'Maasrot', 'Maaser Sheni', 'Challah', 'Orlah', 'Bikkurim',
    ],
  },
  {
    key: 'moed', label: 'Seder Moed (Appointed Times)',
    tractates: [
      'Shabbat', 'Eruvin', 'Pesachim', 'Yoma', 'Shekalim', 'Sukkah',
      'Rosh Hashanah', 'Beitzah', 'Taanit', 'Megillah', 'Chagigah',
      'Moed Katan',
    ],
  },
  {
    key: 'nashim', label: 'Seder Nashim (Women)',
    tractates: [
      'Yevamot', 'Ketubot', 'Nedarim', 'Nazir', 'Sotah', 'Gittin', 'Kiddushin',
    ],
  },
  {
    key: 'nezikin', label: 'Seder Nezikin (Damages)',
    tractates: [
      'Bava Kamma', 'Bava Metzia', 'Bava Batra', 'Sanhedrin', 'Makkot',
      'Shevuot', 'Avodah Zarah', 'Horayot',
    ],
  },
  { key: 'tahorot', label: 'Seder Tahorot (Purities)', tractates: ['Niddah'] },
];

async function fetchJson(url, { retries = 3, timeoutMs = 120000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastErr?.message ?? lastErr}`);
}

// Reads a cached JSON file, or fetches and caches it. Resumable: a re-run
// after an interrupted download skips everything already on disk.
async function cached(name, url, refetch) {
  const file = path.join(RAW_DIR, `${name}.json`);
  if (!refetch) {
    try {
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch {
      /* not cached yet */
    }
  }
  const data = await fetchJson(url);
  await fs.mkdir(RAW_DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data), 'utf8');
  return data;
}

// Hard gate on licence and edition — see the header note. A version whose
// metadata doesn't match is not the text this bundle is allowed to ship, so
// the build fails rather than quietly importing it.
function assertLicense(tractate, doc) {
  if (doc.license !== REQUIRED_LICENSE) {
    throw new Error(
      `${tractate}: Sefaria reports license "${doc.license}", not "${REQUIRED_LICENSE}". ` +
      'Refusing to build. Foundation ships this text on the strength of its CC-BY terms; ' +
      'if upstream terms have changed, re-check them by hand before touching this guard.',
    );
  }
  const title = `${doc.versionTitle ?? ''} ${doc.versionNotes ?? ''}`;
  if (!REQUIRED_VERSION_RE.test(title)) {
    throw new Error(
      `${tractate}: version "${doc.versionTitle}" is not Guggenheimer's translation. ` +
      'Refusing to build: Sefaria\'s other English Yerushalmi covers 0.9% of the corpus.',
    );
  }
}

// Guggenheimer's edition is a "translation and commentary", and Sefaria
// carries the commentary as footnotes spliced into the middle of the
// translated sentence:
//
//   ...read the Shema in the evening<sup class="footnote-marker">1</sup>
//   <i class="footnote">The Mishnah presupposes...</i>? From the time...
//
// Stripping tags the way the Bavli builder does would weld the note into the
// sentence it interrupts ("in the evening1The Mishnah presupposes...?"),
// which is precisely the note-leak that had to be repaired out of
// entries.text once already (see the {braces} repair in src/seed.ts). So the
// markers and note bodies are removed outright, before the generic
// tag-strip, leaving the translation to read continuously.
//
// That drops roughly a third of the shipped characters — the commentary is
// substantial, and losing it is a real cost, not a rounding error. It is
// recorded as a known limitation in ROADMAP.md, with the footnotes pinned as
// candidate entry_notes work, rather than papered over here.
// Removes each <i class="footnote">...</i> span, including its closing tag.
//
// A regex cannot do this: Sefaria's footnote bodies contain *nested* <i>
// tags (cited book abbreviations, e.g. <i>Deut.</i>), so a non-greedy
// `.*?</i>` stops at the first inner close and leaves the remainder of the
// note welded into the sentence. That is not hypothetical — it is what the
// first cut of this builder shipped, and what the importer's verification
// pass caught. So the span is matched by walking the tag stream and tracking
// <i> depth.
function stripFootnotes(html) {
  const OPEN = '<i class="footnote">';
  let out = '';
  let i = 0;
  for (;;) {
    const start = html.indexOf(OPEN, i);
    if (start === -1) return out + html.slice(i);
    out += html.slice(i, start);
    // Walk forward from just inside the note, counting <i ...> against </i>,
    // until the tag that closes *this* note.
    let depth = 1;
    let j = start + OPEN.length;
    while (depth > 0 && j < html.length) {
      const next = html.indexOf('<', j);
      if (next === -1) { j = html.length; break; }
      const end = html.indexOf('>', next);
      if (end === -1) { j = html.length; break; }
      const tag = html.slice(next, end + 1);
      if (/^<i[\s>]/i.test(tag)) depth++;
      else if (/^<\/i\s*>$/i.test(tag)) depth--;
      j = end + 1;
    }
    i = j;
  }
}

function htmlToText(html) {
  return String(stripFootnotes(String(html)))
    .replace(/<sup class="footnote-marker">.*?<\/sup>/gis, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Entity decoding above can *reveal* markup: a handful of segments carry
    // HTML-escaped tags (&lt;sub&gt;) that were invisible to the tag strip.
    // Only an exact, closed set of tag names is removed here, and only after
    // decoding, because Guggenheimer uses bare angle brackets as an editorial
    // convention for supplied text — "<and were there until this day.>" — and
    // a general <[^>]+> pass at this point would silently eat 59 such
    // passages along with the 2 real tags.
    .replace(/<\/?(?:sub|sup|i|b|br|strong|em|a)\s*\/?>/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Unlike the Bavli, whose Sefaria text array starts at a notional daf 1 that
// no printed tractate has, the Yerushalmi's chapters and halakhot are plain
// 1-indexed with no offset: text[0][0] is chapter 1, halakhah 1. Verified
// against Berakhot (9 chapters, first halakhah non-empty at index 0,0),
// Shabbat (24) and Niddah (4), all three of which match the printed tractate
// exactly. Hence no dafLabel()-style correction here.
function halakhahRef(chapterIndex, halakhahIndex) {
  return `${chapterIndex + 1}:${halakhahIndex + 1}`;
}

async function buildTractate(seder, name, refetch) {
  const title = `Jerusalem Talmud ${name}`;
  const url =
    `${BUCKET}/json/Talmud/Yerushalmi/${encodeURIComponent(`Seder ${seder}`)}` +
    `/${encodeURIComponent(title)}/English/${encodeURIComponent(VERSION_FILE)}.json`;
  const doc = await cached(title, url, refetch);
  assertLicense(title, doc);

  const halakhot = [];
  const chapters = Array.isArray(doc.text) ? doc.text : [];
  chapters.forEach((chapter, ci) => {
    if (!Array.isArray(chapter)) return;
    chapter.forEach((segments, hi) => {
      if (!Array.isArray(segments) || segments.length === 0) return;
      // Paragraph-per-entry, not one entry per halakhah: highlights, notes
      // and links need a paragraph-sized selection unit, the same reasoning
      // the Bavli, the Companion Bible Appendixes and the EPUB importer
      // already follow.
      const texts = segments.map(htmlToText).filter((t) => t.length > 0);
      if (texts.length === 0) return;
      halakhot.push({ ref: halakhahRef(ci, hi), paragraphs: texts });
    });
  });
  if (halakhot.length === 0) throw new Error(`${title}: parsed to zero halakhot.`);
  return { title, heTitle: doc.heTitle ?? null, halakhot };
}

// Cross-checks the pinned SEDARIM list against what Sefaria actually
// publishes, so a tractate added or renamed upstream fails the build instead
// of vanishing from the shelf. Listing is paginated; the bucket holds ~1,200
// Yerushalmi objects including commentaries, so only the Guggenheimer files
// under a "Seder ..." directory are counted.
async function fetchPublishedTractates() {
  const found = new Map();
  let token;
  do {
    const q = new URLSearchParams({
      prefix: 'json/Talmud/Yerushalmi/',
      fields: 'items/name,nextPageToken',
      maxResults: '1000',
    });
    if (token) q.set('pageToken', token);
    const page = await fetchJson(
      `https://storage.googleapis.com/storage/v1/b/sefaria-export/o?${q}`,
    );
    for (const item of page.items ?? []) {
      const parts = item.name.split('/');
      // json / Talmud / Yerushalmi / <Seder X> / <Tractate> / English / <file>
      if (parts.length !== 7) continue;
      if (!parts[3].startsWith('Seder ')) continue;
      if (parts[6] !== `${VERSION_FILE}.json`) continue;
      found.set(parts[4], parts[3].replace(/^Seder /, ''));
    }
    token = page.nextPageToken;
  } while (token);
  if (found.size === 0) {
    throw new Error('Listed zero Guggenheimer tractates from Sefaria\'s export bucket.');
  }
  return found;
}

async function main() {
  const refetch = process.argv.includes('--refetch');

  console.log('Listing Sefaria\'s published Yerushalmi tractates...');
  const published = await fetchPublishedTractates();
  const pinned = new Set(
    SEDARIM.flatMap((s) => s.tractates.map((t) => `Jerusalem Talmud ${t}`)),
  );
  const missing = [...pinned].filter((t) => !published.has(t));
  const unexpected = [...published.keys()].filter((t) => !pinned.has(t));
  if (missing.length || unexpected.length) {
    throw new Error(
      'Sefaria\'s Yerushalmi tractate list no longer matches the order pinned in SEDARIM.\n' +
      (missing.length ? `  pinned but not published: ${missing.join(', ')}\n` : '') +
      (unexpected.length ? `  published but not pinned: ${unexpected.join(', ')}\n` : '') +
      '  Re-check the canonical order by hand before touching SEDARIM.',
    );
  }
  console.log(`${published.size} tractates, matching the pinned order`);

  const sedarim = [];
  let grandHalakhot = 0;
  let grandParagraphs = 0;

  for (const seder of SEDARIM) {
    console.log(`\n${seder.label}`);
    const tractates = [];
    for (const name of seder.tractates) {
      process.stdout.write(`  ${name}... `);
      const built = await buildTractate(seder.label.split(' ')[1], name, refetch);
      const paragraphs = built.halakhot.reduce((n, h) => n + h.paragraphs.length, 0);
      tractates.push(built);
      grandHalakhot += built.halakhot.length;
      grandParagraphs += paragraphs;
      console.log(`${built.halakhot.length} halakhot, ${paragraphs} paragraphs`);
    }
    sedarim.push({ key: seder.key, label: seder.label, tractates });
  }

  const bundle = {
    metadata: {
      build_date: new Date().toISOString().slice(0, 10),
      work: 'The Jerusalem Talmud (Talmud Yerushalmi)',
      translator: 'Heinrich W. Guggenheimer',
      publisher: 'Walter de Gruyter, Berlin, 1999–2015',
      source_site: 'https://www.sefaria.org/',
      source_export: 'https://github.com/Sefaria/Sefaria-Export',
      license: REQUIRED_LICENSE,
      version_title: VERSION_FILE,
      license_note:
        'CC BY — NOT public domain, but attribution-only: free to share and adapt, including ' +
        'commercially, provided Heinrich W. Guggenheimer is credited as translator. English ' +
        'translation and commentary by Heinrich W. Guggenheimer, originally published in 17 ' +
        'volumes by Walter de Gruyter (Berlin, 1999–2015) and digitised and published by ' +
        'Sefaria. Chosen over the only public-domain English Yerushalmi (Moses Schwab, 1886), ' +
        'which covers Berakhot alone — 1 of 39 tractates — and over Sefaria’s CC0 “Community ' +
        'Translation”, which despite its looser licence reaches only 20 tractates and 0.9% of ' +
        'the corpus. Guggenheimer’s explanatory footnotes are omitted: Sefaria splices them ' +
        'into the middle of the translated sentence, and this Library’s reading column is ' +
        'plain text.',
      seder_count: sedarim.length,
      tractate_count: sedarim.reduce((n, s) => n + s.tractates.length, 0),
      halakhah_count: grandHalakhot,
    },
    sedarim,
  };

  await fs.mkdir(DEPLOY_DIR, { recursive: true });
  const out = path.join(DEPLOY_DIR, 'yerushalmi.json');
  await fs.writeFile(out, JSON.stringify(bundle), 'utf8');
  const mb = (await fs.stat(out)).size / 1024 / 1024;
  console.log(`\nwrote ${out} (${mb.toFixed(1)} MB)`);
  console.log(
    `${grandHalakhot} halakhot, ${grandParagraphs} paragraphs across ` +
    `${bundle.metadata.tractate_count} tractates in ${sedarim.length} sedarim`,
  );
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
