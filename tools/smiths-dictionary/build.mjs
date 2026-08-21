// Builds the bundled Smith's Bible Dictionary JSON that ships with the app.
//
// Source: the CrossWire SWORD project's "Smith" module —
//   https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Smith.zip
// which is a hand-transcribed digital text of Smith's Bible Dictionary
// (Dr. William Smith, 1884), distributed with DistributionLicense=Public
// Domain in its module config. This was chosen over the archive.org page
// scans (e.g. dictionaryofbwi01smit) deliberately: those items are raw
// ABBYY OCR of two-column scans, full of character-level corruption
// ("I'-gj^pt" for "Egypt"), and each item covers only one volume of the
// four-volume unabridged edition. The CrossWire text is the complete 1884
// dictionary, transcribed (not OCRed), with headwords already structured.
//
// The build refuses to proceed unless the module config declares itself
// public domain, mirroring josephus/build.mjs's Whiston-only check.
//
// SWORD RawLD format: <name>.idx is an array of 6-byte records
// (uint32le offset into <name>.dat, uint16le length). Each dat slice is
// "HEADWORD\r\n" followed by the article in light ThML markup, which is
// reduced to plain text here (<scripRef> keeps its visible reference text,
// <term> keeps the referenced headword).
//
// Usage:  node build.mjs [--refetch]
// Output: smiths.json (here) and ../public/library/smiths.json

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(HERE, 'raw');
const ZIP_URL = 'https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Smith.zip';

const TITLE = "Smith's Bible Dictionary (1884)";
const LICENSE_NOTE =
  "Dr. William Smith, Smith's Bible Dictionary (1884) — public domain. "
  + 'Text from the CrossWire SWORD "Smith" module (DistributionLicense: Public Domain), '
  + 'a hand-transcribed edition; built by smiths-dictionary/build.mjs.';

async function fetchZip(refetch) {
  const cached = join(RAW_DIR, 'Smith.zip');
  if (!refetch && existsSync(cached)) return readFile(cached);
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status} for ${ZIP_URL}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(RAW_DIR, { recursive: true });
  await writeFile(cached, buf);
  return buf;
}

// Minimal zip reader: walk the central directory (found via the end-of-
// central-directory record) and inflate each file. Enough for CrossWire's
// plain deflate/store zips; anything fancier fails loudly.
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('latin1', p + 46, p + 46 + nlen);
    // local header: skip its own (possibly different-length) name+extra
    const lnlen = buf.readUInt16LE(lho + 26);
    const lelen = buf.readUInt16LE(lho + 28);
    const start = lho + 30 + lnlen + lelen;
    const raw = buf.subarray(start, start + csize);
    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`Unsupported zip compression method ${method} for ${name}`);
    p += 46 + nlen + elen + clen;
  }
  return files;
}

// The module text is Windows-1252; Buffer's latin1 covers all of it except
// the 0x80–0x9F block (curly quotes, dashes) which cp1252 remaps.
const CP1252 = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—', 0x98: '˜',
  0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};
function decode1252(buf) {
  let out = '';
  for (const b of buf) out += b >= 0x80 && b <= 0x9f ? (CP1252[b] ?? '') : String.fromCharCode(b);
  return out;
}

// ThML → plain text. Keeps the visible text of scripture references and
// cross-references; drops the markup. Anything tag-shaped that survives is
// counted so the build can fail loudly instead of shipping markup.
function thmlToText(s) {
  return s
    .replace(/<scripRef[^>]*>/gi, '').replace(/<\/scripRef>/gi, '')
    .replace(/<term[^>]*>/gi, '').replace(/<\/term>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n\n')
    .replace(/<\/?(?:i|b|em|strong|sup|sub|small|font|span|div|a|ul|ol)[^>]*>/gi, '')
    .replace(/<li[^>]*>/gi, '\n• ').replace(/<\/li>/gi, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseRawLD(dat, idx) {
  const entries = [];
  for (let p = 0; p + 6 <= idx.length; p += 6) {
    const off = idx.readUInt32LE(p);
    const len = idx.readUInt16LE(p + 4);
    if (len === 0) continue;
    const blob = decode1252(dat.subarray(off, off + len));
    const nl = blob.indexOf('\n');
    if (nl < 0) continue;
    const word = blob.slice(0, nl).replace(/\r$/, '').trim();
    const text = thmlToText(blob.slice(nl + 1));
    if (!word || !text) continue;
    entries.push({ word, text });
  }
  return entries;
}

async function main() {
  const refetch = process.argv.includes('--refetch');
  console.log('Fetching module…');
  const files = unzip(await fetchZip(refetch));

  const conf = files.get('mods.d/smith.conf');
  if (!conf) throw new Error('Module config mods.d/smith.conf missing from zip');
  const confText = conf.toString('latin1');
  if (!/^DistributionLicense=Public Domain$/m.test(confText)) {
    throw new Error('Module config does not declare DistributionLicense=Public Domain. '
      + 'Refusing to build: only the public-domain text may ship.');
  }

  const dat = files.get('modules/lexdict/rawld/smith/smith.dat');
  const idx = files.get('modules/lexdict/rawld/smith/smith.idx');
  if (!dat || !idx) throw new Error('smith.dat / smith.idx missing from zip');

  const entries = parseRawLD(dat, idx);
  if (entries.length < 2000) throw new Error(`Only ${entries.length} entries parsed — expected ~4,000+; refusing a partial build.`);

  // sanity: no markup may leak into the shipped text
  const leaked = entries.filter((e) => /<[a-zA-Z/][^>]*>/.test(e.text));
  if (leaked.length > 0) {
    console.error('Markup leaked in:', leaked.slice(0, 5).map((e) => e.word));
    throw new Error(`${leaked.length} entries still contain markup — fix thmlToText before shipping.`);
  }

  // Group by initial letter — these become the source's books.
  const byLetter = new Map();
  for (const e of entries) {
    const letter = /^[A-Z]/i.test(e.word) ? e.word[0].toUpperCase() : '#';
    if (!byLetter.has(letter)) byLetter.set(letter, []);
    byLetter.get(letter).push(e);
  }
  const letters = [...byLetter.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([letter, es]) => ({ letter, entries: es }));

  const out = {
    metadata: { title: TITLE, license_note: LICENSE_NOTE, source_url: ZIP_URL },
    letters,
  };
  const json = JSON.stringify(out);
  await writeFile(join(HERE, 'smiths.json'), json);
  await mkdir(join(HERE, '..', '..', 'public', 'library', 'reference'), { recursive: true });
  await writeFile(join(HERE, '..', '..', 'public', 'library', 'reference', 'smiths.json'), json);
  console.log(`Wrote ${entries.length} entries across ${letters.length} letters (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
  for (const l of letters) console.log(`  ${l.letter}: ${l.entries.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
