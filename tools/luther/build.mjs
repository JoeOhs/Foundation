// Standalone data-prep script (run with `node build.mjs`, outside the Tauri
// app): reads the two Project Gutenberg releases of the Philadelphia Edition
// of Luther's works, parses their Work / Section / paragraph structure and
// writes luther-vol1.json and luther-vol2.json — bundles shaped to feed
// Foundation's freeform, position_ref-anchored import (one source per
// volume, one book per work, a 2-level toc_entries hierarchy). Parse-and-
// clean only: does not touch src-tauri/, src/db.ts or src/importer.ts, and
// is not part of the app runtime.
//
// EDITION PROVENANCE — read before changing the IDs below.
// This is the Philadelphia Edition, "Works of Martin Luther, with
// Introductions and Notes", A. J. Holman Company, 1915-1932, in which a team
// of Lutheran scholars translated Luther's major treatises, sermons and
// catechisms directly from the German and Latin, each piece carrying its own
// introduction and named translator. Only Volumes I and II are digitised on
// Project Gutenberg (#31604 and #34904); Volumes III-VI exist as page scans
// on the Internet Archive and are a separate, OCR-shaped job — see ROADMAP.md.
// Do not point these IDs at another Luther edition (Lenker's commentary
// series, Cole's Select Works): those are different works with different
// structure, and the parser below is pinned to this one.
//
// LICENCE: public domain — the volumes were published in 1915 and 1916 and
// US copyright has long expired. Project Gutenberg's own licence covers the
// digitisation and imposes no further restriction. The build hard-fails if a
// file no longer carries Gutenberg's licence boilerplate, or if its header
// does not name this edition and the matching volume number — the same
// discipline tools/josephus/build.mjs applies to Whiston's translation and
// tools/talmud/build.mjs to the CC BY-NC licence.
//
// NO NETWORK. gutenberg.org is unreachable from the environment this was
// written in, and the two source files are supplied locally under raw/
// (gitignored, like every other builder's raw/ in this repo). The bundles
// this writes are what ship; the app never fetches anything at read time.
//
// Usage:
//   node build.mjs           parse raw/ and write both bundles
//   node build.mjs --audit   also print the full Work -> Section outline and
//                            every excluded block, for the manual
//                            read-through this project's standing discipline
//                            asks for

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(__dirname, 'raw');
const EXCLUSIONS_PATH = path.join(__dirname, 'luther-exclusions.txt');
const DEPLOY_DIR = path.join(__dirname, '..', '..', 'public', 'library', 'reformation');

// ---------------------------------------------------------------------------
// Volume manifests.
//
// Work boundaries are declared, not inferred. The two volumes are marked up
// differently enough that inference would need special-casing anyway and
// would fail silently when it guessed wrong: Volume II is regular (an <h3>
// work title immediately followed by an <h3> INTRODUCTION, eight times),
// while Volume I only settles into that shape from its fifth work on — its
// first four are introduced variously by a half-title <h4>, by a bare
// INTRODUCTION heading, or by a styled <p> title block with no heading tag
// at all. Declaring every boundary — nine in Volume I (its eight works plus
// the volume's own introduction and translators' note) and eight in Volume II,
// which has no volume-level introduction — and asserting every one of them
// is found, in order, is the same call tools/josephus/build.mjs and
// tools/foxe/build.mjs make when they pin their expected book and chapter
// counts: a parser that has drifted from the text stops the build instead of
// shipping a volume quietly missing half its treatises.
//
// `locator` is the exact normalised text of the heading (or styled title
// paragraph) that opens the work; `nth` disambiguates when that text recurs
// — every work title in this edition appears at least twice, once over the
// scholarly introduction and again over Luther's own text.
const VOLUMES = [
  {
    volume: 1,
    gutenbergId: 31604,
    file: 'luther-vol1.html',
    printedYear: 1915,
    releaseDate: 'March 12, 2010',
    // Volume I's top-level heading tag. Stated per volume because it differs:
    // Volume I has no <h3> at all and hangs its works off <h4>, while Volume
    // II uses <h3> for works and demotes FOOTNOTES to <h4>. Reading both
    // volumes with one hard-coded level would mis-segment one of them.
    topTag: 'h4',
    frontMatter: 'Half-title, title page and contents.',
    works: [
      // Not a work of Luther's, but the volume's own scholarly front matter,
      // and kept for the same reason each work's introduction is kept: the
      // edition is titled "with Introductions and Notes" and this is one of
      // them. Excluding it while keeping the per-work introductions would be
      // an inconsistent reading of the same material. Volume II has no
      // volume-level introduction, so it has no counterpart here.
      { name: 'Introduction and Translators’ Note (Philadelphia Edition)', locator: 'INTRODUCTION', nth: 1 },
      { name: "Luther's Prefaces to His Works (1539, 1545)", locator: 'WORKS OF MARTIN LUTHER', nth: 1 },
      { name: 'Disputation on Indulgences (The XCV Theses), 1517', locator: 'INTRODUCTION', nth: 2 },
      { name: 'A Treatise on Baptism (1519)', locator: 'A TREATISE ON THE HOLY SACRAMENT OF BAPTISM 1529', nth: 1 },
      { name: 'A Discussion of Confession (1520)', locator: 'A DISCUSSION OF CONFESSION (CONFITENDI RATIO) 1520', nth: 1 },
      { name: 'The Fourteen of Consolation (1520)', locator: 'THE FOURTEEN OF CONSOLATION', nth: 1 },
      { name: 'A Treatise on Good Works (1520)', locator: 'A TREATISE ON GOOD WORKS,', nth: 1 },
      { name: 'A Treatise on the New Testament, that is, the Holy Mass (1520)', locator: 'A TREATISE ON THE NEW TESTAMENT', nth: 1 },
      { name: 'The Papacy at Rome (1520)', locator: 'THE PAPACY AT ROME', nth: 1 },
    ],
    backMatter: { locator: 'INDEX', nth: 1 },
  },
  {
    volume: 2,
    gutenbergId: 34904,
    file: 'luther-vol2.html',
    printedYear: 1916,
    releaseDate: 'January 10, 2011',
    topTag: 'h3',
    frontMatter: 'Title page and contents.',
    works: [
      { name: 'A Treatise Concerning the Blessed Sacrament and the Brotherhoods (1519)', locator: 'A TREATISE CONCERNING THE BLESSED SACRAMENT OF THE HOLY AND TRUE BODY OF CHRIST AND CONCERNING THE BROTHERHOODS', nth: 1 },
      { name: 'A Treatise Concerning the Ban (1520)', locator: 'A TREATISE CONCERNING THE BAN', nth: 1 },
      { name: 'An Open Letter to the Christian Nobility of the German Nation (1520)', locator: 'AN OPEN LETTER TO THE CHRISTIAN NOBILITY OF THE GERMAN NATION CONCERNING THE REFORM OF THE CHRISTIAN ESTATE', nth: 1 },
      { name: 'A Prelude on the Babylonian Captivity of the Church (1520)', locator: 'A PRELUDE ON THE BABYLONIAN CAPTIVITY OF THE CHURCH', nth: 1 },
      { name: 'A Treatise on Christian Liberty (1520)', locator: 'A TREATISE ON CHRISTIAN LIBERTY WITH A LETTER TO POPE LEO X', nth: 1 },
      { name: "A Brief Explanation of the Ten Commandments, the Creed, and the Lord's Prayer (1520)", locator: "A BRIEF EXPLANATION (EINE KURZE FORM) OF THE TEN COMMANDMENTS, THE CREED, AND THE LORD'S PRAYER", nth: 1 },
      { name: 'The Eight Wittenberg Sermons (1522)', locator: 'THE EIGHT WITTENBERG SERMONS', nth: 1 },
      { name: 'That Doctrines of Men Are to Be Rejected (1522)', locator: 'THAT DOCTRINES OF MEN ARE TO BE REJECTED', nth: 1 },
    ],
    backMatter: { locator: 'INDEX', nth: 1 },
  },
  // Volume III is not a Gutenberg release — there is none — but a page scan
  // on the Internet Archive, put through tools/luther/vol3-normalise.mjs
  // first. That script reads the scan's hOCR and writes raw/luther-vol3.html
  // in the shape the parser below already understands, so everything from
  // tokenise() down is shared with Volumes I and II and nothing about their
  // path changes. What differs is stated here in data: a different licence
  // and provenance story (`provenance: 'vol3'`), and locators that are the
  // OCR of the printed half-title pages rather than a transcriber's heading.
  //
  // Those locators look damaged because they are: "DEFENSE OF ALL THE
  // ARTICLES Mi" is what Tesseract makes of a decorated half-title with
  // show-through behind it. They are pinned verbatim on purpose. The
  // half-title pages are the only structural boundary this volume prints,
  // and matching them exactly means that if the scan is ever re-run, or
  // Internet Archive replaces the item, the build stops instead of quietly
  // re-cutting the volume at different places.
  {
    volume: 3,
    file: 'luther-vol3.html',
    printedYear: 1930,
    provenance: 'vol3',
    iaIdentifier: 'worksofmartinlut03luth_0',
    publisher: 'A. J. Holman Company and The Castle Press, Philadelphia',
    topTag: 'h3',
    frontMatter: 'Title page and contents.',
    works: [
      { name: 'An Argument in Defense of All the Articles of Dr. Martin Luther Wrongly Condemned in the Roman Bull (1521)', locator: 'AN ARGUMENT DEFENSE OF ALL THE ARTICLES OF MARTIN LUTHER IN THE ROMAN BULL', nth: 1 },
      { name: 'The Magnificat, Translated and Explained (1520-21)', locator: 'THE MAGNIFICAT TRANSLATED AND EXPLAINED', nth: 1 },
      { name: 'An Earnest Exhortation for All Christians, Warning Them Against Insurrection and Rebellion (1522)', locator: 'AN EARNEST EXHORTATION FOR ALL CHRISTIANS, WARNING THEM AGAINST INSURRECTION AND REBELLION', nth: 1 },
      { name: 'Secular Authority: To What Extent It Should Be Obeyed (1523)', locator: 'SECULAR AUTHORITY TO WHAT EXTENT IT SHOULD BE OBEYED', nth: 1 },
      // The edition groups the three Emser pieces under one half-title,
      // "Luther's Writings Against Emser"; the first of them shares that
      // page, which is why this locator carries the group title too.
      { name: 'To the Leipzig Goat (1521)', locator: 'LUTHER’S WRITINGS AGAINST EMSER I. TO THE LEIPZIG GOAT', nth: 1 },
      { name: 'Reply to the Answer of the Leipzig Goat (1521)', locator: 'II. REPLY TO THE ANSWER OF THE LEIPZIG GOAT', nth: 1 },
      { name: 'Answer to the Superchristian, Superspiritual, and Superlearned Book of Goat Emser of Leipzig (1521)', locator: 'Ill. MARTIN LUTHER’S ANSWER SUPERCHRISTIAN, SUPERSPIRITUAL, AND SUPERLEARNED BOOK OF GOAT EMSER OF LEIPZIG WITH A GLANCE AT HIS COMRADE MURNER', nth: 1 },
      { name: 'To the Knights of the Teutonic Order (1523)', locator: 'TO THE KNIGHTS OF THE TEUTONIC ORDER AN EXHORTATION THAT THEY LAY ASIDE FALSE CHASTITY AND TAKE UPON THEM THE TRUE CHASTITY OF WEDLOCK', nth: 1 },
    ],
    backMatter: { locator: 'INDEX SCRIPTURE REFERENCES', nth: 1 },
  },
];

// Asserted against each volume's own declared list rather than a single
// number: Volume I carries the edition's general introduction as a ninth
// book, Volume II has no volume-level introduction to carry, and Volume III
// has none either — its eight works are the eight in its printed contents.
const EXPECTED_BOOKS = { 1: 9, 2: 8, 3: 8 };

const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };

// ---------------------------------------------------------------------------
// Text normalisation

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…', rsquo: '’',
  lsquo: '‘', ldquo: '“', rdquo: '”', oelig: 'œ',
  aelig: 'æ', eacute: 'é', egrave: 'è', uuml: 'ü',
  ouml: 'ö', auml: 'ä', deg: '°', sect: '§', pound: '£',
};

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

// entries.text is plain text everywhere in this app and no pane renders
// markup, so the edition's <i> (Latin titles, emphasised Scripture) is
// unwrapped rather than carried through — the same call the Talmud import
// made with Sefaria's <b> and the Foxe build made with Gutenberg's
// _underscore_ italics.
function stripTags(html) {
  return html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '');
}

function normalise(html) {
  return decodeEntities(stripTags(html)).replace(/\s+/g, ' ').trim();
}

// Footnote *markers* left in the body. The edition prints them as bracketed
// numbers ("if he is in personal fellowship with his Lord[1]"), which is the
// same shape Josephus's Life/Against Apion used and is stripped the same way.
// Deliberately numeric-only: this edition also brackets Scripture citations
// ("[Matt. 16:18]", 500+ of them across the two volumes), which are the
// translators' cross-references *to* the text and are content, not
// apparatus — a greedier rule would silently delete every one of them.
function stripFootnoteMarkers(text) {
  return text.replace(/\s*\[\d{1,3}\]/g, '');
}

// ---------------------------------------------------------------------------
// Provenance gate — see the header note. Runs before any parsing.

// Volume III's gate. Its provenance story is different in kind from the
// Gutenberg volumes': there is no machine-readable header and no licence
// boilerplate to match, only what the printed leaves themselves say, read
// off the scan by vol3-normalise.mjs and restated in the FOUNDATION-PROVENANCE
// block it writes. Both halves are checked — the block, and the title page
// as it appears in the body text — so that neither the normaliser's summary
// nor the text alone is trusted on its own.
//
// The 1930 date is the whole basis for this volume being public domain
// (95-year term expiry, so 1 January 2026), and it is asserted against the
// printed notice. Internet Archive's catalogue date for this item says 1915,
// which is the six-volume set's date and wrong for this volume; nothing here
// reads it, and the assertions below would not pass if something tried to.
function assertVol3Provenance(raw, vol) {
  const headerEnd = raw.indexOf('*** START');
  const header = raw.slice(0, headerEnd > 0 ? headerEnd : 4000).replace(/\s+/g, ' ');
  const body = raw.slice(headerEnd > 0 ? headerEnd : 0, (headerEnd > 0 ? headerEnd : 0) + 4000)
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const fail = (why) => {
    throw new Error(
      `Volume 3 (${vol.file}) failed the provenance gate: ${why}\n` +
      '  This build is pinned to the A. J. Holman Company and The Castle Press\n' +
      `  printing of Volume III, ${vol.printedYear}, Internet Archive item\n` +
      `  ${vol.iaIdentifier}. Refusing to build rather than shipping a text whose\n` +
      '  edition, printing or copyright date is unconfirmed. Re-run\n' +
      '  `node vol3-normalise.mjs --report` and read the report before changing this.',
    );
  };

  if (!header.includes('FOUNDATION-PROVENANCE')) {
    fail('it carries no FOUNDATION-PROVENANCE block — it was not written by vol3-normalise.mjs');
  }
  if (!header.includes(`primary-scan: ${vol.iaIdentifier}`)) {
    fail(`its provenance block does not name the scan ${vol.iaIdentifier}`);
  }
  if (!header.includes('edition: Works of Martin Luther, with Introductions and Notes')) {
    fail('its provenance block does not name this edition');
  }
  if (!header.includes('volume: III')) fail('its provenance block does not name Volume III');
  if (!header.includes(`printed-year: ${vol.printedYear}`)) {
    fail(`its provenance block does not carry the printed year ${vol.printedYear}`);
  }
  // Read off a printed leaf, not asserted by the normaliser: at least one
  // scan of this volume must actually show the 1930 date.
  if (!/year-evidence: .*\b1930\b/.test(header)) {
    fail('no scan of this volume shows a printed 1930 date');
  }
  if (!/ia-date-field: NOT USED/.test(header)) {
    fail('its provenance block does not record that Internet Archive\'s date field was refused');
  }
  // And independently of the block, the title page in the text itself.
  if (!/VOLUME III/.test(body)) fail('"VOLUME III" is not on its title page');
  if (!/A\. J\. HOLMAN COMPANY/i.test(body)) fail('the A. J. Holman Company imprint is not on its title page');
  if (!/THE CASTLE PRESS/i.test(body)) fail('The Castle Press imprint is not on its title page');
}

function assertProvenance(raw, vol) {
  if (vol.provenance === 'vol3') return assertVol3Provenance(raw, vol);
  const flat = (chunk) => chunk.replace(/\s+/g, ' ');
  // Gutenberg's machine-readable header runs from the top of the file to the
  // START marker, and the publisher's title page sits just after it. Sliced
  // by that marker rather than by a byte count: in the HTML releases the
  // <head> stylesheet alone is ~7KB, so any fixed window big enough for the
  // .txt files would fall short here and fail a perfectly good file.
  const startAt = raw.indexOf('*** START');
  const header = flat(raw.slice(0, startAt > 0 ? startAt : 12000));
  const titlePage = flat(raw.slice(startAt > 0 ? startAt : 0, (startAt > 0 ? startAt : 0) + 6000));
  const footer = flat(raw.slice(-30000));
  const fail = (why) => {
    throw new Error(
      `Volume ${vol.volume} (${vol.file}) failed the provenance gate: ${why}\n` +
      '  This build is pinned to the Philadelphia Edition of Luther\'s works,\n' +
      '  Project Gutenberg #31604 (Vol. I) and #34904 (Vol. II). Refusing to\n' +
      '  build rather than shipping a text whose edition or licence is unconfirmed.',
    );
  };

  const roman = vol.volume === 1 ? 'I' : 'II';
  if (!header.includes(`Works of Martin Luther, with Introductions and Notes (Volume ${roman})`)) {
    fail(`its header does not name "Works of Martin Luther, with Introductions and Notes (Volume ${roman})"`);
  }
  if (!header.includes(`[eBook #${vol.gutenbergId}]`)) {
    fail(`its header does not carry [eBook #${vol.gutenbergId}]`);
  }
  if (!/A\. J\. HOLMAN\s*(?:<[^>]*>\s*)*Company/i.test(titlePage)) {
    fail('the A. J. Holman Company imprint is not on its title page');
  }
  if (!titlePage.includes(String(vol.printedYear))) {
    fail(`the printed year ${vol.printedYear} is not on its title page`);
  }
  // Gutenberg states the licence in its own boilerplate rather than in a
  // metadata field. Matched against whitespace-normalised text because
  // Gutenberg hard-wraps at ~72 columns and a wrap inside a phrase would
  // make a raw-text regex fail on a perfectly good file — the fix
  // tools/foxe/build.mjs already had to make.
  if (!header.includes('This eBook is for the use of anyone anywhere in the United States')) {
    fail('the Project Gutenberg licence header is missing or reworded');
  }
  if (!/not protected by copyright in the U\.S\./i.test(footer)) {
    fail('the Project Gutenberg licence footer is missing or reworded');
  }
}

// ---------------------------------------------------------------------------
// Tokenising
//
// The document is read as one flat, ordered stream of headings and
// paragraphs. Nothing else in these files carries structure: there are no
// semantic classes (five in the whole file, all Gutenberg's own chrome) and
// the ids are sequential autogenerated noise, so heading level and document
// order are all there is to segment on.

function tokenise(html, vol) {
  const start = html.indexOf('*** START');
  const end = html.indexOf('*** END');
  if (start < 0) throw new Error(`${vol.file}: no Gutenberg START marker`);
  const body = html.slice(start, end > start ? end : html.length);

  const tokens = [];
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>|<p([^>]*)>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(body)) !== null) {
    if (m[1]) {
      // Headings carry footnote markers too ("PREFATORY NOTE[1]", "JESUS[1]"),
      // and a heading becomes a TOC row and a position_ref citation, so the
      // marker has to come off here as well as in the body.
      const text = stripFootnoteMarkers(normalise(m[2])).trim();
      if (text) tokens.push({ kind: 'heading', tag: m[1].toLowerCase(), text });
    } else {
      const attrs = m[3] || '';
      const text = normalise(m[4]);
      if (!text) continue;
      // The printed marginal sidenotes ("[Sidenote: The Third Commandment]").
      // All 532 across the two volumes occupy a paragraph of their own,
      // immediately before the paragraph they label — verified, not assumed —
      // so they lift cleanly onto entries.heading, the nullable column added
      // for JFB's section headings and reused by Foxe. Left inline they would
      // read as stray editorial noise mid-column.
      const side = text.match(/^\[Sidenote:\s*(.*?)\]$/);
      if (side) {
        tokens.push({ kind: 'sidenote', text: side[1].trim() });
        continue;
      }
      // A styled title block standing in for a heading tag — Volume I opens
      // two of its works this way and none of Volume II does.
      const isTitleBlock = /margin-top: 2em/.test(attrs)
        && text.length < 90 && text === text.toUpperCase() && /[A-Z]/.test(text);
      tokens.push({ kind: isTitleBlock ? 'heading' : 'para', tag: isTitleBlock ? vol.topTag : null, text });
    }
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Segmenting

function findLocator(tokens, locator, nth, vol) {
  let seen = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.kind !== 'heading' || t.tag !== vol.topTag) continue;
    if (t.text !== locator) continue;
    if (++seen === nth) return i;
  }
  throw new Error(
    `Volume ${vol.volume}: could not find occurrence ${nth} of the ${vol.topTag} ` +
    `heading "${locator}".\n  The parser has drifted from the text — refusing to ` +
    'build a volume with a missing or misplaced work.',
  );
}

// Returns { books, exclusions }.
function parseVolume(tokens, vol) {
  const exclusions = [];

  // Locate every declared boundary and assert they run in document order.
  const bounds = vol.works.map((w) => ({ ...w, at: findLocator(tokens, w.locator, w.nth, vol) }));
  const backAt = findLocator(tokens, vol.backMatter.locator, vol.backMatter.nth, vol);
  for (let i = 1; i < bounds.length; i++) {
    if (bounds[i].at <= bounds[i - 1].at) {
      throw new Error(
        `Volume ${vol.volume}: work "${bounds[i].name}" was found before ` +
        `"${bounds[i - 1].name}". The declared order no longer matches the file.`,
      );
    }
  }
  if (backAt <= bounds[bounds.length - 1].at) {
    throw new Error(`Volume ${vol.volume}: the ${vol.backMatter.locator} back matter precedes the last work.`);
  }

  const excludeRange = (from, to, label) => {
    const paras = tokens.slice(from, to).filter((t) => t.kind === 'para');
    const text = paras.map((t) => t.text).join(' ');
    if (text) exclusions.push({ label, bytes: Buffer.byteLength(text, 'utf8'), paragraphs: paras.length, text });
  };

  // Front matter (title page, contents) and back matter (the printed index,
  // which is a list of page numbers and is meaningless without the print
  // pagination this edition's text does not carry).
  excludeRange(0, bounds[0].at, `Vol. ${vol.volume} front matter — ${vol.frontMatter}`);
  excludeRange(backAt, tokens.length, `Vol. ${vol.volume} back matter — printed index and Scripture-reference tables (page numbers only)`);

  const books = [];
  for (let w = 0; w < bounds.length; w++) {
    const from = bounds[w].at;
    const to = w + 1 < bounds.length ? bounds[w + 1].at : backAt;
    books.push(parseWork(tokens.slice(from, to), bounds[w], vol, exclusions));
  }
  return { books, exclusions };
}

function parseWork(tokens, work, vol, exclusions) {
  const sections = [];
  // Paragraphs before the work's first inner heading belong to the work
  // itself (a date line, a half-title's subtitle), so the opening section is
  // named for the work rather than being dropped.
  let current = { title: null, paragraphs: [] };
  // Consecutive headings with no text between them are one printed heading
  // broken across several tags — the edition sets "CHAPTER I", "THE FIRST
  // IMAGE" and "THE EVIL WITHIN US" as three successive <h5>s over a single
  // section. Read one-heading-per-section they would produce two empty
  // sections and silently drop the chapter numbering from the third, so they
  // are joined back into the one heading the page actually shows.
  let pendingTitles = [];
  let pendingHeading = null;
  const droppedSidenotes = [];
  let inFootnotes = false;
  let footnoteBuf = [];

  const flushFootnotes = () => {
    if (footnoteBuf.length) {
      const text = footnoteBuf.join(' ');
      exclusions.push({
        label: `Vol. ${vol.volume} — ${work.name} — FOOTNOTES block`,
        bytes: Buffer.byteLength(text, 'utf8'),
        paragraphs: footnoteBuf.length,
        text,
      });
      footnoteBuf = [];
    }
  };
  const pushSection = () => {
    if (current.paragraphs.length) sections.push(current);
  };

  for (const t of tokens) {
    if (t.kind === 'heading') {
      // A FOOTNOTES heading opens the editorial apparatus: the translators'
      // and editors' numbered notes, which run until the next heading of any
      // level. Excluded from entries.text entirely and logged, the same
      // standard tools/josephus/build.mjs and tools/jfb/build.mjs hold to.
      if (/^FOOTNOTES:?$/i.test(t.text)) {
        flushFootnotes();
        inFootnotes = true;
        continue;
      }
      if (inFootnotes) { flushFootnotes(); inFootnotes = false; }
      if (current.paragraphs.length) {
        pushSection();
        current = { title: null, paragraphs: [] };
        pendingTitles = [];
      }
      pendingTitles.push(t.text);
      current.title = pendingTitles.join(' — ');
      if (pendingHeading) { droppedSidenotes.push(pendingHeading); pendingHeading = null; }
      continue;
    }
    if (inFootnotes) { footnoteBuf.push(t.text); continue; }
    if (t.kind === 'sidenote') {
      // A sidenote labels the paragraph that follows it. If a heading or the
      // end of a section arrives first there is nothing to attach it to; that
      // is rare (7 of 532) and always a sidenote sitting against a section
      // break, where the heading already says the same thing.
      if (pendingHeading) droppedSidenotes.push(pendingHeading);
      pendingHeading = t.text;
      continue;
    }

    const text = stripFootnoteMarkers(t.text).trim();
    if (!text) continue;
    current.paragraphs.push({ text, heading: pendingHeading });
    pendingHeading = null;
  }
  if (inFootnotes) flushFootnotes();
  if (pendingHeading) droppedSidenotes.push(pendingHeading);
  pushSection();

  if (!sections.length) {
    throw new Error(`Volume ${vol.volume}: work "${work.name}" parsed to no text at all.`);
  }
  return { name: work.name, sections, droppedSidenotes };
}

// ---------------------------------------------------------------------------

async function buildVolume(vol, audit) {
  const raw = await fs.readFile(path.join(RAW_DIR, vol.file), 'utf8');
  assertProvenance(raw, vol);
  const tokens = tokenise(raw, vol);
  const { books, exclusions } = parseVolume(tokens, vol);

  if (books.length !== EXPECTED_BOOKS[vol.volume] || books.length !== vol.works.length) {
    throw new Error(
      `Volume ${vol.volume}: expected ${EXPECTED_BOOKS[vol.volume]} books, parsed ${books.length}.`);
  }
  const paragraphCount = books.reduce(
    (n, b) => n + b.sections.reduce((m, s) => m + s.paragraphs.length, 0), 0);
  const sectionCount = books.reduce((n, b) => n + b.sections.length, 0);

  // CONSERVATION GATE. Every body paragraph in the file must end up either in
  // the bundle or in a logged exclusion — nothing may simply vanish. Without
  // this, a mis-declared work boundary or a FOOTNOTES block that never
  // terminates would swallow real treatise text and the build would still
  // report success, which is precisely the failure that shipped once already
  // in this project (the {braces} note-leak repaired in src/seed.ts).
  const sourceParagraphs = tokens.filter((t) => t.kind === 'para').length;
  const excludedParagraphs = exclusions.reduce((n, e) => n + (e.paragraphs ?? 0), 0);
  if (paragraphCount + excludedParagraphs !== sourceParagraphs) {
    throw new Error(
      `Volume ${vol.volume}: paragraph conservation failed — ${sourceParagraphs} in the ` +
      `source, ${paragraphCount} kept + ${excludedParagraphs} excluded = ` +
      `${paragraphCount + excludedParagraphs}. Text is being dropped silently; refusing to build.`,
    );
  }
  const droppedSidenotes = books.flatMap((b) => b.droppedSidenotes);
  for (const b of books) delete b.droppedSidenotes;

  const roman = ROMAN[vol.volume];
  const bundle = {
    metadata: {
      build_date: new Date().toISOString(),
      work: `Works of Martin Luther, with Introductions and Notes — Volume ${roman}`,
      edition: 'Philadelphia Edition',
      publisher: vol.publisher ?? 'A. J. Holman Company, Philadelphia',
      printed_year: vol.printedYear,
      volume: vol.volume,
      volumes_in_edition: 6,
      ...(vol.provenance === 'vol3'
        ? {
          ia_identifier: vol.iaIdentifier,
          source_site: 'https://archive.org/',
          license_note:
            'Public domain — Works of Martin Luther, with Introductions and Notes ' +
            '(the Philadelphia Edition), Volume III, A. J. Holman Company and The Castle ' +
            'Press, Philadelphia, 1930. In the public domain in the United States since ' +
            '1 January 2026, when its 95-year copyright term expired; the date is taken ' +
            'from the printed copyright notice, not from Internet Archive\'s catalogue ' +
            'record, which gives the six-volume set\'s date of 1915 and is wrong for this ' +
            'volume. Digitised by the Internet Archive from the Princeton Theological ' +
            `Seminary copy (${vol.iaIdentifier}); text recovered from that scan's OCR. ` +
            'Translators\' and editors\' footnotes are excluded from the text.',
        }
        : {
          gutenberg_id: vol.gutenbergId,
          gutenberg_released: vol.releaseDate,
          source_site: 'https://www.gutenberg.org/',
          license_note:
            `Public domain — Works of Martin Luther, with Introductions and Notes ` +
            `(Philadelphia Edition), Volume ${roman}, A. J. Holman Company, ` +
            `${vol.printedYear}; US copyright expired. Digitised by Project Gutenberg ` +
            `(#${vol.gutenbergId}). Translators' and editors' footnotes are excluded from the text.`,
        }),
      work_count: books.length,
      section_count: sectionCount,
      paragraph_count: paragraphCount,
    },
    books,
  };

  const outPath = path.join(__dirname, `luther-vol${vol.volume}.json`);
  const json = `${JSON.stringify(bundle, null, 1)}\n`;
  await fs.writeFile(outPath, json, 'utf8');
  await fs.mkdir(DEPLOY_DIR, { recursive: true });
  await fs.writeFile(path.join(DEPLOY_DIR, `luther-vol${vol.volume}.json`), json, 'utf8');

  console.log(
    `  Vol. ${vol.volume}: ${books.length} works, ${sectionCount} sections, ` +
    `${paragraphCount} paragraphs, ${(Buffer.byteLength(json, 'utf8') / 1024 / 1024).toFixed(2)}MB`,
  );
  if (audit) {
    for (const b of books) {
      console.log(`    ${b.name}`);
      for (const s of b.sections) {
        console.log(`      - ${s.title ?? '(opening)'} — ${s.paragraphs.length}p`);
      }
    }
  }
  if (droppedSidenotes.length) {
    console.log(`    (${droppedSidenotes.length} sidenote label(s) sat against a section break and were superseded by its heading)`);
    if (audit) for (const d of droppedSidenotes) console.log(`      · ${d}`);
  }
  return {
    exclusions,
    stats: {
      volume: vol.volume, works: books.length, sections: sectionCount,
      paragraphs: paragraphCount, sourceParagraphs, excludedParagraphs,
      droppedSidenotes: droppedSidenotes.length,
    },
  };
}

async function writeExclusionReport(all, stats) {
  const lines = [
    'Luther (Philadelphia Edition) build — excluded blocks',
    '',
    'Everything below is editorial apparatus from the Philadelphia Edition',
    'rather than text to be read: the translators\' and editors\' numbered',
    'FOOTNOTES blocks, the front matter (title page and contents), and the',
    'printed back-matter index, which is a list of page numbers and is',
    'meaningless without the print pagination this text does not carry.',
    'None of it is imported. Listed here so the decision stays auditable.',
    '',
    'Kept in the text, deliberately, and so absent from this list:',
    '  - each work\'s scholarly Introduction and its translator\'s signature.',
    '    The edition is titled "with Introductions and Notes" and every work',
    '    carries its own; they are content, not apparatus.',
    '  - the bracketed Scripture citations ("[Matt. 16:18]"), which are the',
    '    translators\' cross-references and part of the reading text.',
    '  - the printed marginal sidenotes, lifted onto entries.heading rather',
    '    than dropped or left inline.',
    '',
    `Generated: ${new Date().toISOString()}`,
    ...stats.map((s) =>
      `Vol. ${s.volume}: ${s.sourceParagraphs} source paragraphs = ${s.paragraphs} kept ` +
      `(${s.works} works, ${s.sections} sections) + ${s.excludedParagraphs} excluded` +
      (s.droppedSidenotes ? `; ${s.droppedSidenotes} sidenote label(s) superseded by a section heading` : '')),
    `Blocks excluded: ${all.length}`,
    `Bytes excluded: ${all.reduce((n, e) => n + e.bytes, 0)}`,
    '',
    '---',
    '',
  ];
  for (const e of all) {
    const snippet = e.text.length > 160 ? `${e.text.slice(0, 160)}…` : e.text;
    lines.push(`[${e.label}] ${e.bytes} bytes — ${snippet}`);
  }
  await fs.writeFile(EXCLUSIONS_PATH, `${lines.join('\n')}\n`, 'utf8');
}

async function main() {
  const audit = process.argv.includes('--audit');
  console.log('Building Luther (Philadelphia Edition) from raw/…');
  const all = [];
  const stats = [];
  for (const vol of VOLUMES) {
    const res = await buildVolume(vol, audit);
    all.push(...res.exclusions);
    stats.push(res.stats);
  }
  await writeExclusionReport(all, stats);
  console.log(`  ${all.length} blocks excluded (see luther-exclusions.txt)`);
  if (audit) {
    console.log('\n--- excluded blocks ---');
    for (const e of all) console.log(`[${e.label}] ${e.bytes}b — ${e.text.slice(0, 100)}…`);
  }
  console.log('Done.');
}

main().catch((err) => { console.error(`\n${err.message}\n`); process.exit(1); });
