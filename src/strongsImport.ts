import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import { CANONICAL_BOOKS } from './bibleMeta';
import {
  clearStrongsData, findSourceByTitle, getEntryRefMap, insertStrongsDictBatch, insertStrongsWordsBatch,
} from './db';
import type { StrongsDictEntry } from './types';

// CrossWire Bible Society's KJV2003 OSIS module: the KJV text with inline
// Strong's Numbers tagging (<w lemma="strong:H0026">). CrossWire holds
// copyright on the tagging/integration and "hereby grants a general public
// license to use this text for any purpose" (kjv.conf `About` field).
const OSIS_URL = 'https://gitlab.com/crosswire-bible-society/kjv/-/raw/master/kjv.osis.xml';

// OpenScriptures' structured Strong's Hebrew/Greek dictionaries. The base
// Strong's numbering and glosses are James Strong's (d. 1894, public
// domain); this JSON/JS structuring of it is Copyright OpenScriptures,
// CC BY-SA — see https://github.com/openscriptures/strongs.
const HEBREW_DICT_URL = 'https://raw.githubusercontent.com/openscriptures/strongs/master/hebrew/strongs-hebrew-dictionary.js';
const GREEK_DICT_URL = 'https://raw.githubusercontent.com/openscriptures/strongs/master/greek/strongs-greek-dictionary.js';

// OSIS book abbreviations in the same order as CANONICAL_BOOKS, so the two
// arrays can be zipped by index instead of hand-maintaining a lookup table.
const OSIS_BOOK_IDS = [
  'Gen', 'Exod', 'Lev', 'Num', 'Deut',
  'Josh', 'Judg', 'Ruth', '1Sam', '2Sam',
  '1Kgs', '2Kgs', '1Chr', '2Chr', 'Ezra',
  'Neh', 'Esth', 'Job', 'Ps', 'Prov',
  'Eccl', 'Song', 'Isa', 'Jer', 'Lam',
  'Ezek', 'Dan', 'Hos', 'Joel', 'Amos',
  'Obad', 'Jonah', 'Mic', 'Nah', 'Hab',
  'Zeph', 'Hag', 'Zech', 'Mal',
  'Matt', 'Mark', 'Luke', 'John', 'Acts',
  'Rom', '1Cor', '2Cor', 'Gal', 'Eph',
  'Phil', 'Col', '1Thess', '2Thess', '1Tim',
  '2Tim', 'Titus', 'Phlm', 'Heb', 'Jas',
  '1Pet', '2Pet', '1John', '2John', '3John',
  'Jude', 'Rev',
];

const OSIS_TO_CANONICAL = new Map<string, string>(
  OSIS_BOOK_IDS.map((id, i) => [id, CANONICAL_BOOKS[i]]),
);

const KJV_SOURCE_TITLE = 'King James Version';

// The OSIS file's lemma attribute mixes tokens like "strong:H07225" with
// unrelated ones like "lemma.TR:ο" (Textus Receptus spelling) — this only
// keeps the Strong's ones. It also normalizes away inconsistent zero-padding:
// Hebrew tags in this file carry an extra leading zero (H07225 = H7225)
// that the OpenScriptures dictionary keys don't use (H2617, not H02617);
// parsing the number and re-stringifying it fixes both at once.
function extractLemmaNumbers(lemmaAttr: string): string[] {
  const out: string[] = [];
  for (const token of lemmaAttr.split(/\s+/)) {
    const m = token.match(/^strong:([HG])0*(\d+)$/i);
    if (m) out.push(`${m[1].toUpperCase()}${m[2]}`);
  }
  return out;
}

export interface StrongsImportRow {
  entry_id: number;
  word_index: number;
  surface_text: string;
  strongs_number: string;
}

export function parseOsis(osisText: string, refMap: Map<string, number>): { rows: StrongsImportRow[]; unmatchedVerses: number } {
  const doc = new DOMParser().parseFromString(osisText, 'text/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('The downloaded KJV+Strong’s file could not be parsed as XML.');
  }

  const rows: StrongsImportRow[] = [];
  let unmatchedVerses = 0;
  let currentRef: string | null = null;
  let currentEntryId: number | null = null;
  let wordIndex = 0;

  const nodes = doc.querySelectorAll('verse, w');
  nodes.forEach((el) => {
    if (el.tagName === 'verse') {
      const sID = el.getAttribute('sID');
      const eID = el.getAttribute('eID');
      if (sID) {
        const osisId = el.getAttribute('osisID') ?? sID;
        const [bookId, chStr, vsStr] = osisId.split('.');
        const bookName = OSIS_TO_CANONICAL.get(bookId);
        const key = bookName ? `${bookName}|${Number(chStr)}|${Number(vsStr)}` : null;
        currentEntryId = key ? refMap.get(key) ?? null : null;
        if (currentEntryId === null) unmatchedVerses++;
        currentRef = sID;
        wordIndex = 0;
      } else if (eID && eID === currentRef) {
        currentRef = null;
        currentEntryId = null;
      }
      return;
    }
    // <w> element. Self-closing / empty ones are untranslated grammatical
    // markers with nothing to show — skip without consuming a word_index.
    if (currentEntryId === null) return;
    const text = (el.textContent ?? '').trim();
    if (!text) return;
    const lemma = el.getAttribute('lemma');
    if (!lemma) return;
    const numbers = extractLemmaNumbers(lemma);
    if (numbers.length === 0) return;
    for (const n of numbers) {
      rows.push({ entry_id: currentEntryId, word_index: wordIndex, surface_text: text, strongs_number: n });
    }
    wordIndex++;
  });

  return { rows, unmatchedVerses };
}

interface RawDictEntry {
  lemma?: string;
  xlit?: string;
  translit?: string;
  pron?: string;
  strongs_def?: string;
  kjv_def?: string;
}

// Both dictionary files are `var name = {...}; module.exports = name;` —
// a plain JSON object literal wrapped in a JS assignment. We only ever
// JSON.parse the extracted object text (never eval/Function), so no code
// from the fetched file executes.
export function parseDictionaryJs(src: string, varName: string, prefix: 'H' | 'G'): StrongsDictEntry[] {
  const start = src.indexOf(varName);
  if (start === -1) throw new Error(`Unexpected dictionary format: missing "${varName}"`);
  const eq = src.indexOf('=', start) + 1;
  const end = src.lastIndexOf('module.exports');
  let objText = src.slice(eq, end === -1 ? undefined : end).trim();
  if (objText.endsWith(';')) objText = objText.slice(0, -1);
  const raw: Record<string, RawDictEntry> = JSON.parse(objText);
  return Object.entries(raw).map(([key, v]) => ({
    strongs_number: key.toUpperCase().startsWith(prefix) ? key.toUpperCase() : `${prefix}${key}`,
    lemma: v.lemma ?? null,
    transliteration: v.xlit ?? v.translit ?? null,
    pronunciation: v.pron ?? null,
    short_def: v.kjv_def ?? null,
    full_def: v.strongs_def ? v.strongs_def.trim() : null,
  }));
}

// Uses the Tauri HTTP plugin (request made by the Rust side) instead of the
// webview's fetch: gitlab.com's raw endpoint sends no CORS headers, so a
// browser-context fetch of the OSIS file fails with "TypeError: Failed to
// fetch" regardless of network state. Allowed hosts are scoped in
// src-tauri/capabilities/default.json.
async function fetchText(url: string): Promise<string> {
  const res = await httpFetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
  return res.text();
}

export async function importKjvStrongs(onProgress: (msg: string) => void): Promise<void> {
  const kjv = await findSourceByTitle(KJV_SOURCE_TITLE);
  if (!kjv) {
    throw new Error('Install the King James Version from the Library first, then add Strong’s numbers.');
  }

  onProgress('Downloading KJV with Strong’s tagging (~28 MB)…');
  const osisText = await fetchText(OSIS_URL);

  onProgress('Matching tagged words to your KJV text…');
  const refMap = await getEntryRefMap(kjv.id);
  const { rows, unmatchedVerses } = parseOsis(osisText, refMap);
  if (rows.length === 0) {
    throw new Error('No Strong’s-tagged words could be matched to the installed KJV. Try reinstalling the KJV from Library first.');
  }

  onProgress('Downloading Strong’s Hebrew & Greek dictionaries…');
  const [hebrewSrc, greekSrc] = await Promise.all([fetchText(HEBREW_DICT_URL), fetchText(GREEK_DICT_URL)]);
  const dictRows = [
    ...parseDictionaryJs(hebrewSrc, 'strongsHebrewDictionary', 'H'),
    ...parseDictionaryJs(greekSrc, 'strongsGreekDictionary', 'G'),
  ];

  onProgress('Clearing any previous Strong’s data…');
  await clearStrongsData(kjv.id);

  await insertStrongsWordsBatch(rows, (done, total) =>
    onProgress(`Storing tagged words… ${Math.round((done / total) * 100)}%`),
  );

  onProgress('Storing dictionary entries…');
  await insertStrongsDictBatch(dictRows);

  if (unmatchedVerses > 0) {
    console.warn(`Strong's import: ${unmatchedVerses} OSIS verses had no matching KJV entry and were skipped.`);
  }
}
