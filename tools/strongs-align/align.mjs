// Prototype, run with `node align.mjs` (outside the app): measures whether
// STEPBible's word-level Hebrew tagging (TAHOT) can refine the phrase-level
// Strong's tagging we import from CrossWire's KJV. Nothing here touches the
// app or its database; it only prints numbers and writes raw/sample.txt.
//
// The problem: CrossWire tags phrases ("and, lo, my sheaf" = H485 only) and
// leaves some Hebrew words untagged. TAHOT has every Hebrew word's number,
// in Hebrew order, but with STEPBible's own English glosses, not KJV words.
// So each number TAHOT has and CrossWire lacks must be pinned to a KJV word.
//
// Method, per verse:
//   1. Numbers both sources share are anchors. A longest common subsequence
//      over the two number sequences keeps only anchors whose order agrees.
//   2. Each missing number may only land between the KJV positions of its
//      neighbouring anchors (widened one anchor each side if nothing fits),
//      on a word the OpenScriptures dictionary lists as a KJV rendering of
//      that number, which isn't itself the rendering of the span it sits in.
//
// Licences: TAHOT is CC BY 4.0 (credit STEPBible.org); CrossWire and
// OpenScriptures as in src/strongsImport.ts.
//
// Usage: node align.mjs [Book ...]   (default: Gen). Only Gen-Deu is
// downloaded so far; other TAHOT files go in raw/ the same way.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAW = join(import.meta.dirname, 'raw');
const books = process.argv.slice(2).length ? process.argv.slice(2) : ['Gen'];

function load(name) {
  const p = join(RAW, name);
  if (!existsSync(p)) throw new Error(`Missing ${p}; see the header for sources.`);
  return readFileSync(p, 'utf8');
}

// --- dictionary: KJV renderings per number ---------------------------------
const dictSrc = load('heb.js');
const dict = JSON.parse(
  dictSrc.slice(dictSrc.indexOf('=', dictSrc.indexOf('strongsHebrewDictionary')) + 1, dictSrc.lastIndexOf('module.exports'))
    .trim().replace(/;$/, ''),
);

// Crude stem so "arose"/"arise", "sheaves"/"sheaf" etc. at least meet on
// regular endings. ponytail: suffix-strip only, irregular forms miss.
const stem = (w) => w.toLowerCase().replace(/'s$/, '').replace(/(eth|est|ing|ed|es|s)$/, '');

// kjv_def entries look like "(a-)rise(-ing), [idiom] behold, lo, see".
// Only one-word entries count ("for all" must not make "for" a rendering);
// "(x-)" and "(-y)" groups are expanded both ways.
const renderCache = new Map();
function renders(num) {
  if (renderCache.has(num)) return renderCache.get(num);
  const out = new Set();
  const def = (dict[num]?.kjv_def ?? '').replace(/\[idiom\]/g, '').toLowerCase();
  for (const w of lexicon.get(num) ?? []) out.add(w);
  // Split on top-level commas only: "God (gods) (-dess, -ly)" is one entry.
  for (let e of def.split(/,(?![^(]*\))/)) {
    e = e.trim().replace(/[.;:]+$/, '');
    const bare = e.replace(/\([^)]*\)/g, '');
    const full = e.replace(/[()-]/g, '');
    for (const v of [bare, full]) if (/^[a-z']+$/.test(v)) out.add(stem(v));
  }
  renderCache.set(num, out);
  return out;
}

// --- CrossWire: verse -> tokens ---------------------------------------------
// token: { word, span } where span indexes spans[] (null = untagged text).
const osis = load('kjv.osis.xml');
function crosswireVerses(book) {
  const out = new Map();
  const re = new RegExp(`<verse osisID="(${book}\\.\\d+\\.\\d+)" sID="[^"]*"/>([\\s\\S]*?)<verse eID`, 'g');
  for (const m of osis.matchAll(re)) {
    const body = m[2].replace(/<note[\s\S]*?<\/note>/g, '');
    const tokens = [];
    const spans = [];
    const pushText = (text, span) => {
      for (const w of text.replace(/<[^>]+>/g, '').matchAll(/[A-Za-z']+/g)) tokens.push({ word: w[0], span });
    };
    let pos = 0;
    for (const w of body.matchAll(/<w [^>]*?lemma="([^"]*)"[^>]*>([\s\S]*?)<\/w>/g)) {
      pushText(body.slice(pos, w.index), null);
      const nums = [...w[1].matchAll(/strong:H0*(\d+)/g)].map((x) => `H${x[1]}`);
      if (nums.length) { spans.push({ nums, text: w[2] }); pushText(w[2], spans.length - 1); }
      else pushText(w[2], null);
      pos = w.index + w[0].length;
    }
    pushText(body.slice(pos), null);
    out.set(m[1], { tokens, spans: spans.map(releaseStrays) });
  }
  return out;
}

// How the KJV itself renders each number, learned from CrossWire's
// single-word spans across the whole OT ("said" for H559, "came" for H935):
// covers the irregular forms the dictionary's "say(-ing)" style misses. Seen
// at least twice, so one mis-tag in the source doesn't become a rendering.
const lexicon = new Map();
{
  const counts = new Map();
  for (const m of osis.matchAll(/<w [^>]*?lemma="([^"]*strong:H[^"]*)"[^>]*>(?:<divineName>)?([A-Za-z']+)(?:<\/divineName>)?<\/w>/g)) {
    for (const n of m[1].matchAll(/strong:H0*(\d+)/g)) {
      const key = `H${n[1]}|${stem(m[2])}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  for (const [key, c] of counts) {
    if (c < 2) continue;
    const [num, w] = key.split('|');
    if (!lexicon.has(num)) lexicon.set(num, new Set());
    lexicon.get(num).add(w);
  }
}

// CrossWire sometimes glues a neighbour's number onto a span (Gen 37:7:
// H8432 "midst" on "binding"). In a multi-number span, a number that renders
// none of the span's words is dropped here, so the aligner re-places it like
// any missing number. Single-number spans are kept whatever they say.
function releaseStrays(span) {
  if (span.nums.length < 2) return span;
  const words = [...span.text.replace(/<[^>]+>/g, '').matchAll(/[A-Za-z']+/g)].map((w) => stem(w[0]));
  const kept = span.nums.filter((n) => words.some((w) => renders(n).has(w)));
  return kept.length ? { ...span, nums: kept, released: span.nums.filter((n) => !kept.includes(n)) } : span;
}

// --- TAHOT: verse -> ordered numbers ----------------------------------------
// Only the {braced} main number per Hebrew word; H9xxx prefixes (and, the,
// in…) are STEPBible's own extension numbers with no Strong's entry.
const OSIS_OT = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs',
  '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek',
  'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal'];
const tahotBooks = [];
const tahot = new Map();
for (const f of ['TAHOT Gen-Deu.txt', 'TAHOT Jos-Est.txt', 'TAHOT Job-Sng.txt', 'TAHOT Isa-Mal.txt']) {
  if (!existsSync(join(RAW, f))) break; // a gap would shift the positional book mapping
  for (const line of load(f).split('\n')) {
    const m = line.match(/^(\w+\.\d+\.\d+)(?:\([^)]*\))?#\d+=\w+\t[^\t]*\t[^\t]*\t[^\t]*\t([^\t]*)/);
    if (!m) continue;
    const [bk, ch, vs] = m[1].split('.');
    if (!tahotBooks.includes(bk)) tahotBooks.push(bk);
    // TAHOT's book names ("Exo", "Deu") differ from OSIS's ("Exod", "Deut");
    // both run in canonical order, so they are zipped by position.
    m[1] = `${OSIS_OT[tahotBooks.indexOf(bk)]}.${ch}.${vs}`;
    if (!tahot.has(m[1])) tahot.set(m[1], []);
    for (const n of m[2].matchAll(/\{H0*(\d+)[A-Z]?\}/g)) {
      const num = `H${n[1]}`;
      // H9xxx: STEPBible's own affix numbers. Unrepresented words (H853, the
      // object marker) have nothing in English to land on.
      if (Number(n[1]) < 9000 && !/unrepresented/.test(dict[num]?.kjv_def ?? '')) tahot.get(m[1]).push(num);
    }
  }
}

// --- alignment ----------------------------------------------------------------
// KJV "slots": one per (span, number), in text order, with the token range.
function slotsOf({ tokens, spans }) {
  const slots = [];
  spans.forEach((s, si) => {
    const idx = tokens.flatMap((t, i) => (t.span === si ? [i] : []));
    if (!idx.length) return;
    for (const n of s.nums) slots.push({ num: n, first: idx[0], last: idx[idx.length - 1] });
  });
  return slots;
}

// LCS between TAHOT numbers and KJV slots -> Map(tahotIndex -> slot).
function anchors(heb, slots) {
  const L = heb.map(() => new Array(slots.length + 1).fill(0));
  L.push(new Array(slots.length + 1).fill(0));
  for (let i = heb.length - 1; i >= 0; i--)
    for (let j = slots.length - 1; j >= 0; j--)
      L[i][j] = heb[i] === slots[j].num ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = new Map();
  for (let i = 0, j = 0; i < heb.length && j < slots.length;) {
    if (heb[i] === slots[j].num) { out.set(i, slots[j]); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) i++;
    else j++;
  }
  return out;
}

// Place every TAHOT number the KJV tagging lacks. Returns [{ num, token }].
function align(verse, heb) {
  const slots = slotsOf(verse);
  const anc = anchors(heb, slots);
  const have = new Map();
  for (const s of slots) have.set(s.num, (have.get(s.num) ?? 0) + 1);
  const taken = new Set();
  const placed = [];
  const n = verse.tokens.length;
  heb.forEach((num, i) => {
    if (anc.has(i)) return;
    if ((have.get(num) ?? 0) > 0) { have.set(num, have.get(num) - 1); return; } // tagged, just reordered
    const r = renders(num);
    if (!r.size) return;
    const ancIdx = [...anc.keys()];
    for (let widen = 0; widen <= 1; widen++) {
      const before = ancIdx.filter((k) => k < i);
      const after = ancIdx.filter((k) => k > i);
      const lo = before.length > widen ? anc.get(before[before.length - 1 - widen]).last + 1 : 0;
      const hi = after.length > widen ? anc.get(after[widen]).first - 1 : n - 1;
      const cands = [];
      for (let t = Math.max(0, lo); t <= Math.min(n - 1, hi); t++) {
        const tok = verse.tokens[t];
        if (taken.has(t) || !r.has(stem(tok.word))) continue;
        if (tok.span !== null && verse.spans[tok.span].nums.some((x) => renders(x).has(stem(tok.word)))) continue;
        cands.push(t);
      }
      if (cands.length) {
        const want = (i / heb.length) * n; // closest to proportional position
        const t = cands.reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
        taken.add(t);
        placed.push({ num, token: t });
        return;
      }
    }
  });
  return placed;
}

// e-Sword-style rendering: "behold (H2009) we (H587) …".
function render(verse, placed) {
  const byTok = new Map(placed.map((p) => [p.token, p.num]));
  const parts = [];
  verse.tokens.forEach((t, i) => {
    parts.push(t.word);
    const lastOfSpan = t.span !== null && verse.tokens[i + 1]?.span !== t.span;
    // A released number the aligner couldn't re-place stays where CrossWire
    // put it: a slightly wrong span beats losing the number.
    const kept = lastOfSpan ? verse.spans[t.span] : null;
    const back = kept?.released?.filter((x) => !placed.some((p) => p.num === x)) ?? [];
    const tags = [...(byTok.has(i) ? [`+${byTok.get(i)}`] : []), ...(kept ? [...kept.nums, ...back] : [])];
    if (tags.length) parts.push(`(${tags.join(' ')})`);
  });
  return parts.join(' ');
}

// --- run -------------------------------------------------------------------
const verses = new Map();
for (const b of books) for (const [k, v] of crosswireVerses(b)) if (tahot.has(k)) verses.set(k, v);
if (!verses.size) throw new Error(`No verses for ${books.join(', ')} with both CrossWire and TAHOT data.`);

// Coverage: how many missing numbers get placed.
let missing = 0, placedN = 0;
const results = new Map();
for (const [ref, v] of verses) {
  const heb = tahot.get(ref);
  const counts = new Map();
  for (const s of slotsOf(v)) counts.set(s.num, (counts.get(s.num) ?? 0) + 1);
  for (const x of heb) { if ((counts.get(x) ?? 0) > 0) counts.set(x, counts.get(x) - 1); else missing++; }
  const p = align(v, heb);
  placedN += p.length;
  results.set(ref, p);
}

// Accuracy on known answers: drop one correct single-word, single-number,
// once-per-verse tag, re-align, and see whether it comes back to its word.
let tried = 0, back = 0, wrong = 0;
for (const [ref, v] of verses) {
  const heb = tahot.get(ref);
  v.spans.forEach((s, si) => {
    const idx = v.tokens.flatMap((t, i) => (t.span === si ? [i] : []));
    if (idx.length !== 1 || s.nums.length !== 1) return;
    const num = s.nums[0];
    if (heb.filter((x) => x === num).length !== 1 || v.spans.filter((o) => o.nums.includes(num)).length !== 1) return;
    const held = { tokens: v.tokens.map((t, i) => (i === idx[0] ? { ...t, span: null } : t)), spans: v.spans };
    const hit = align(held, heb).find((p) => p.num === num);
    tried++;
    if (!hit) return;
    if (hit.token === idx[0]) back++; else wrong++;
  });
}

const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
console.log(`Books: ${books.join(', ')}  (${verses.size} verses)`);
console.log(`Missing numbers placed: ${placedN} of ${missing} (${pct(placedN, missing)})`);
console.log(`Held-out known tags: ${tried} tried — correct ${back} (${pct(back, tried)}), wrong word ${wrong} (${pct(wrong, tried)}), not placed ${tried - back - wrong}`);
console.log(`Precision when it places: ${pct(back, back + wrong)}`);
if (verses.has('Gen.37.7')) console.log(`\nGen 37:7  ${render(verses.get('Gen.37.7'), results.get('Gen.37.7'))}`);

// Fixed-seed sample of 100 verses for a by-hand comparison against e-Sword.
let seed = 37;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const refs = [...verses.keys()];
const sample = new Set();
while (sample.size < Math.min(100, refs.length)) sample.add(refs[Math.floor(rand() * refs.length)]);
const lines = [...sample].sort((a, b) => refs.indexOf(a) - refs.indexOf(b))
  .map((r) => `${r}  ${render(verses.get(r), results.get(r))}`);
writeFileSync(join(RAW, 'sample.txt'), `+Hxxx = number added from TAHOT; others are CrossWire's.\n\n${lines.join('\n\n')}\n`);
console.log(`\nWrote raw/sample.txt (${lines.length} verses).`);
