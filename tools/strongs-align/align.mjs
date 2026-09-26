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
//   2. Each missing number may only land between (and within) its
//      neighbouring anchors' KJV phrases, widened one anchor each side if
//      nothing fits, on a word the KJV renders that number with — the
//      number's usual rendering first, then nearest its expected position.
//
// Licences: TAHOT is CC BY 4.0 (credit STEPBible.org); CrossWire and
// OpenScriptures as in src/strongsImport.ts.
//
// Usage: node align.mjs [OSIS book ...]   (default: Gen). raw/ holds
// kjv.osis.xml, heb.js (OpenScriptures Hebrew dictionary) and the four
// "TAHOT <range>.txt" files from github.com/STEPBible/STEPBible-Data under
// "Translators Amalgamated OT+NT/".

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const RAW = join(import.meta.dirname, 'raw');
const args = process.argv.slice(2);
const CHECKLIST = args.includes('--checklist');
const SCORE = args.includes('--score');
const bookArgs = args.filter((a) => !a.startsWith('--'));
const books = bookArgs.length ? bookArgs : ['Gen'];

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
const stem = (w) => w.toLowerCase().replace(/'s$/, '').replace(/(?<=[a-z]{3})(eth|est|ing|ed|es|s)$/, '');

// kjv_def entries look like "(a-)rise(-ing), [idiom] behold, lo, see".
// Only one-word entries count ("for all" must not make "for" a rendering);
// "(x-)" and "(-y)" groups are expanded both ways.
const dictCache = new Map();
function dictRenders(num) {
  if (dictCache.has(num)) return dictCache.get(num);
  const out = new Set();
  const def = (dict[num]?.kjv_def ?? '').replace(/\[idiom\]/g, '').toLowerCase();
  // Split on top-level commas only: "God (gods) (-dess, -ly)" is one entry.
  for (let e of def.split(/,(?![^(]*\))/)) {
    e = e.trim().replace(/[.;:]+$/, '');
    const bare = e.replace(/\([^)]*\)/g, '');
    const full = e.replace(/[()-]/g, '');
    for (const v of [bare, full]) if (/^[a-z']+$/.test(v)) out.add(stem(v));
  }
  dictCache.set(num, out);
  return out;
}

// Dictionary renderings plus the ones learned from the KJV itself (below).
const renderCache = new Map();
function renders(num) {
  if (!renderCache.has(num)) renderCache.set(num, new Set([...dictRenders(num), ...(lexicon.get(num)?.keys() ?? [])]));
  return renderCache.get(num);
}

// --- CrossWire: verse -> tokens ---------------------------------------------
// token: { word, span } where span indexes spans[] (null = untagged text).
const osis = load('kjv.osis.xml');
function crosswireVerses(book) {
  const out = new Map();
  const re = new RegExp(`<verse osisID="(${book}\\.\\d+\\.\\d+)" sID="[^"]*"/>([\\s\\S]*?)<verse eID`, 'g');
  for (const m of osis.matchAll(re)) {
    // Words the KJV prints in italics (supplied by the translators, no Hebrew
    // behind them) are marked with \u0001 so nothing is placed on them.
    const body = m[2].replace(/<note[\s\S]*?<\/note>/g, '')
      .replace(/<transChange type="added">([\s\S]*?)<\/transChange>/g, (_, x) => x.replace(/[A-Za-z']+/g, '\u0001$&'));
    const tokens = [];
    const spans = [];
    const pushText = (text, span) => {
      for (const w of text.replace(/<[^>]+>/g, '').matchAll(/\u0001?[A-Za-z']+/g)) {
        tokens.push({ word: w[0].replace('\u0001', ''), span, added: w[0][0] === '\u0001' });
      }
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
    if (!lexicon.has(num)) lexicon.set(num, new Map());
    lexicon.get(num).set(w, c);
  }
}

// How often the KJV renders `num` as `word`, relative to its most common
// rendering: 1 = its usual word, near 0 = rare; dictionary-only words 0.
function usage(num, word) {
  const m = lexicon.get(num);
  if (!m) return 0;
  return (m.get(stem(word)) ?? 0) / Math.max(...m.values());
}

// The reverse question, and the one that matters when choosing a word: of all
// the times the KJV uses this word for SOME tagged number, how often is it
// this number? "in" is H5921 now and then; "and" essentially never, because
// the Hebrew "and" is the prefix vav, which Strong's does not number.
const wordTotals = new Map();
function share(num, word) {
  const w = stem(word);
  if (!wordTotals.size) {
    for (const m of lexicon.values()) for (const [k, c] of m) wordTotals.set(k, (wordTotals.get(k) ?? 0) + c);
  }
  const total = wordTotals.get(w) ?? 0;
  if (!total) return 0;
  return (lexicon.get(num)?.get(w) ?? 0) / total;
}

// English words that render a Hebrew prefix or the article, never a word with
// a Strong's number of its own: STEPBible numbers them H9002/H9009/H9003 and
// the answer key never accepted one (0 of 26 for "and"). Nothing is placed here.
const PREFIX_WORDS = new Set(['and', 'the', 'a', 'an']);
const MIN_SHARE = Number(process.env.MIN_SHARE ?? 0);

// Small function words are where every surviving error sits: several numbers
// each render "in", "to", "with", "ye", so position alone can't tell them
// apart. A number is only placed on one of these when the word is among that
// number's dominant KJV renderings.
const FUNCTION_WORDS = new Set([
  'in', 'to', 'unto', 'with', 'by', 'at', 'of', 'for', 'from', 'upon', 'on', 'among', 'into',
  'i', 'we', 'ye', 'he', 'she', 'it', 'they', 'thou', 'thee', 'you', 'him', 'her', 'them', 'us', 'me',
  'this', 'that', 'these', 'those', 'there', 'here', 'then', 'now', 'so', 'as', 'not', 'no', 'all',
]);
const FUNC_MIN_USAGE = Number(process.env.FUNC_MIN_USAGE ?? 0);
const AMBIG_SKIP = process.env.AMBIG_SKIP !== '0';
const DOMINANT = Number(process.env.DOMINANT ?? 0.8);

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

// --- TAHOT: verse -> ordered numbers, glosses, and affix words --------------
// Each Hebrew word is split into parts ("in/ own land/ my" =
// H9003/{H776G}/H9020). The {braced} part carries the Strong's number; the
// H9xxx parts are STEPBible's own affix numbers (and, the, in, my…) with no
// Strong's entry. Their English glosses are words the KJV spends on the
// affixes, so they are spoken for (see `align`). <angled> gloss words are
// ones English leaves unsaid.
const OSIS_OT = ['Gen', 'Exod', 'Lev', 'Num', 'Deut', 'Josh', 'Judg', 'Ruth', '1Sam', '2Sam', '1Kgs', '2Kgs',
  '1Chr', '2Chr', 'Ezra', 'Neh', 'Esth', 'Job', 'Ps', 'Prov', 'Eccl', 'Song', 'Isa', 'Jer', 'Lam', 'Ezek',
  'Dan', 'Hos', 'Joel', 'Amos', 'Obad', 'Jonah', 'Mic', 'Nah', 'Hab', 'Zeph', 'Hag', 'Zech', 'Mal'];
// TAHOT glosses in modern English; the KJV words each may appear as.
const KJV_FORMS = {
  you: ['you', 'ye', 'thou', 'thee'], your: ['your', 'thy', 'thine', 'you', 'ye', 'thee'],
  my: ['my', 'mine', 'me'], its: ['its', 'it', 'his', 'her', 'thereof'], it: ['it', 'him', 'her'],
};
const glossWords = (g) => g.replace(/<[^>]*>/g, ' ').toLowerCase().match(/[a-z']+/g) ?? [];
const kjvForms = (w) => KJV_FORMS[w] ?? [w];
const tahotBooks = [];
const tahot = new Map(); // ref -> { nums: [..], gloss: [Set], affix: Map(stem -> count) }
for (const f of ['TAHOT Gen-Deu.txt', 'TAHOT Jos-Est.txt', 'TAHOT Job-Sng.txt', 'TAHOT Isa-Mal.txt']) {
  if (!existsSync(join(RAW, f))) break; // a gap would shift the positional book mapping
  for (const line of load(f).split('\n')) {
    const m = line.match(/^(\w+\.\d+\.\d+)(?:\([^)]*\))?#\d+=\w+\t[^\t]*\t[^\t]*\t([^\t]*)\t([^\t]*)/);
    if (!m) continue;
    const [bk, ch, vs] = m[1].split('.');
    if (!tahotBooks.includes(bk)) tahotBooks.push(bk);
    // TAHOT's book names ("Exo", "Deu") differ from OSIS's ("Exod", "Deut");
    // both run in canonical order, so they are zipped by position.
    const ref = `${OSIS_OT[tahotBooks.indexOf(bk)]}.${ch}.${vs}`;
    if (!tahot.has(ref)) tahot.set(ref, { nums: [], gloss: [], sole: [], affix: new Map() });
    const v = tahot.get(ref);
    const glosses = m[2].split('/');
    const parts = m[3].split('/').map((x) => x.replace(/\\.*/, '')); // "\H9014" links, "\H9016" verse end
    parts.forEach((part, pi) => {
      // Parts and glosses normally pair up; if not, only the main part is kept.
      const g = glosses.length === parts.length ? glossWords(glosses[pi]) : [];
      const n = part.match(/^\{?H0*(\d+)[A-Z]?\}?$/);
      if (!n) return;
      if (Number(n[1]) >= 9000) {
        for (const w of g) for (const f of kjvForms(w)) v.affix.set(stem(f), (v.affix.get(stem(f)) ?? 0) + 1);
        return;
      }
      const num = `H${n[1]}`;
      // Unrepresented words (H853, the object marker) have nothing in English to land on.
      if (!part.startsWith('{') || /unrepresented/.test(dict[num]?.kjv_def ?? '')) return;
      v.nums.push(num);
      // In a multi-word gloss ("he said", "to him") the small words are the
      // verb's person or a helper, not what the number means.
      const main = g.length > 1 ? g.filter((w) => !FUNCTION_WORDS.has(w)) : g;
      v.gloss.push(new Set(main.flatMap(kjvForms).map(stem)));
      v.sole.push(g.length === 1 ? stem(g[0]) : null);
    });
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
function align(verse, { nums: heb, gloss, sole, affix }) {
  const slots = slotsOf(verse);
  const anc = anchors(heb, slots);
  // Tags not used as anchors: those may still cover a number TAHOT has
  // elsewhere in the verse. Anchored ones are spoken for (Gen 1:2 has H5921
  // twice and CrossWire tags it once — counting that tag twice lost the other).
  const anchored = new Set(anc.values());
  const have = new Map();
  for (const s of slots) if (!anchored.has(s)) have.set(s.num, (have.get(s.num) ?? 0) + 1);
  const taken = new Set();
  const placed = [];
  const n = verse.tokens.length;
  // Words the KJV spends on Hebrew affixes (2Chr 9:5 "in mine own land" is
  // H9003+H776; the verse's two "of"s are the two H5921s). A word is spoken
  // for when the verse has no more of it than TAHOT has affixes glossing it.
  // ponytail: by count, not position; with one "in" affix and two "in"s,
  // either may still take a number.
  const tally = new Map();
  for (const t of verse.tokens) tally.set(stem(t.word), (tally.get(stem(t.word)) ?? 0) + 1);
  const spoken = (w) => tally.get(stem(w)) <= (affix.get(stem(w)) ?? 0);
  heb.forEach((num, i) => {
    if (anc.has(i)) return;
    if ((have.get(num) ?? 0) > 0) { have.set(num, have.get(num) - 1); return; } // tagged, just reordered
    const r = renders(num);
    if (!r.size && !sole[i]) return;
    const ancIdx = [...anc.keys()];
    for (let widen = 0; widen <= 1; widen++) {
      const before = ancIdx.filter((k) => k < i);
      const after = ancIdx.filter((k) => k > i);
      // Inclusive of the bounding anchors' own phrases: the missing word often
      // sits inside one ("upon" in "upon the earth", H776, Gen 2:5). Searching
      // the gap first was tried: it barely helps precision and loses Gen 2:5
      // to the "to" in the gap.
      const lo = before.length > widen ? anc.get(before[before.length - 1 - widen]).first : 0;
      const hi = after.length > widen ? anc.get(after[widen]).last : n - 1;
      const cands = [];
      let funcOnly = 0; // how many candidates are small function words
      for (let t = Math.max(0, lo); t <= Math.min(n - 1, hi); t++) {
        const tok = verse.tokens[t];
        // A one-word TAHOT gloss is a rendering even if the KJV lexicon lacks
        // it (H5921 "on"); multi-word ones ("is broad") only break ties below.
        const g = sole[i] === stem(tok.word);
        if (taken.has(t) || tok.added || (!r.has(stem(tok.word)) && !g)) continue;
        if (PREFIX_WORDS.has(tok.word.toLowerCase()) || spoken(tok.word)) continue;
        // Outside its neighbouring anchors, position says little: only a word
        // TAHOT glosses the number with may take it there (2Kgs 5:26 "with").
        if (widen && !gloss[i].has(stem(tok.word))) continue;
        // A rendering seen only rarely in the KJV (H5921 as "and") is more
        // likely a CrossWire slip than a real rendering; dictionary ones stay.
        const u = usage(num, tok.word);
        if (u < 0.01 && !g && !dictRenders(num).has(stem(tok.word))) continue;
        // …and this number must account for a real share of the times the KJV
        // uses this word at all, or the word belongs to some other number.
        if (share(num, tok.word) < MIN_SHARE) continue;
        if (FUNCTION_WORDS.has(tok.word.toLowerCase()) && u < FUNC_MIN_USAGE && !gloss[i].has(stem(tok.word))) continue;
        if (FUNCTION_WORDS.has(tok.word.toLowerCase())) funcOnly++;
        // Inside another number's span, the word goes to whichever number
        // renders it more typically: "upon" in "upon the face" (H6440) is
        // H5921's usual word, and only incidentally H6440's.
        if (tok.span !== null && verse.spans[tok.span].nums.some((x) => usage(x, tok.word) >= u && renders(x).has(stem(tok.word)))) continue;
        cands.push(t);
      }
      // A function word picked out of several candidates is a guess between
      // words that all render the number; leaving the number on CrossWire's
      // phrase beats guessing. Unambiguous ones (one candidate) still land.
      // …unless one candidate is the number's dominant KJV rendering ("upon"
      // for H5921, Gen 2:5): that is evidence, not a coin toss.
      // TAHOT's own gloss for the number ("on" for H5921A) is evidence too.
      const glossed = (t) => gloss[i].has(stem(verse.tokens[t].word));
      if (AMBIG_SKIP && cands.length > 1 && funcOnly > 0
          && !cands.some((t) => glossed(t) || usage(num, verse.tokens[t].word) >= DOMINANT)) {
        const func = cands.filter((t) => FUNCTION_WORDS.has(verse.tokens[t].word.toLowerCase()));
        if (func.length > 1 || func.length === cands.length) continue;
      }
      if (cands.length) {
        // TAHOT's gloss first, then the KJV's usual rendering of the number
        // (H5921: "upon" over "to", Gen 2:5), then nearest its proportional
        // position.
        const want = (i / heb.length) * n;
        const score = (t) => [+glossed(t), usage(num, verse.tokens[t].word), -Math.abs(t - want)];
        const better = (a, b) => { for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] > b[k]; return false; };
        const t = cands.reduce((a, b) => (better(score(b), score(a)) ? b : a));
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
  const heb = tahot.get(ref).nums;
  const counts = new Map();
  for (const s of slotsOf(v)) counts.set(s.num, (counts.get(s.num) ?? 0) + 1);
  for (const x of heb) { if ((counts.get(x) ?? 0) > 0) counts.set(x, counts.get(x) - 1); else missing++; }
  const p = align(v, tahot.get(ref));
  placedN += p.length;
  results.set(ref, p);
}

// Accuracy on known answers: drop one correct single-word, single-number,
// once-per-verse tag, re-align, and see whether it comes back to its word.
let tried = 0, back = 0, wrong = 0;
for (const [ref, v] of verses) {
  const heb = tahot.get(ref).nums;
  v.spans.forEach((s, si) => {
    const idx = v.tokens.flatMap((t, i) => (t.span === si ? [i] : []));
    if (idx.length !== 1 || s.nums.length !== 1) return;
    const num = s.nums[0];
    if (heb.filter((x) => x === num).length !== 1 || v.spans.filter((o) => o.nums.includes(num)).length !== 1) return;
    const held = { tokens: v.tokens.map((t, i) => (i === idx[0] ? { ...t, span: null } : t)), spans: v.spans };
    const hit = align(held, tahot.get(ref)).find((p) => p.num === num);
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
// Verses checked by hand against e-Sword; eyeball these after any change.
for (const ref of ['Gen.1.2', 'Gen.2.5', 'Gen.37.7']) {
  if (verses.has(ref)) console.log(`\n${ref}  ${render(verses.get(ref), results.get(ref))}`);
}

// --score: measure against answer-key.json — real verdicts on the aligner's
// own placements, checked by hand against e-Sword (yes = right word, no =
// wrong word, unsure = e-Sword tags the phrase, so it cannot settle the word,
// and the item is excluded). The key holds only our output plus a verdict.
// An item the aligner no longer places counts as neither right nor wrong: it
// shows as "no longer placed", a coverage loss rather than an error.
if (SCORE) {
  const keyPath = join(import.meta.dirname, 'answer-key.json');
  if (!existsSync(keyPath)) throw new Error(`Missing ${keyPath}`);
  const key = JSON.parse(readFileSync(keyPath, 'utf8'));
  const placedIds = new Map();
  for (const [ref, ps] of results) for (const p of ps) placedIds.set(`${ref}-${p.token}`, p.num);
  let right = 0, wrong = 0, gone = 0, moved = 0, excluded = 0;
  const stillWrong = [];
  for (const [id, k] of Object.entries(key)) {
    if (k.v === 'unsure') { excluded++; continue; }
    const now = placedIds.get(id);
    if (now === undefined) { gone++; continue; }
    if (now !== k.num) { moved++; continue; } // same word, different number
    if (k.v === 'yes') right++;
    else { wrong++; stillWrong.push(`${id} ${k.word}=${k.num}`); }
  }
  const scored = right + wrong;
  console.log(`\nAgainst answer-key.json (${Object.keys(key).length} judged, ${excluded} excluded as unsure):`);
  console.log(`  right ${right}, wrong ${wrong} — precision ${((100 * right) / scored).toFixed(1)}% of ${scored} scored`);
  console.log(`  no longer placed ${gone}, number changed ${moved}`);
  if (stillWrong.length) console.log(`  still wrong: ${stillWrong.slice(0, 40).join('; ')}${stillWrong.length > 40 ? ` … +${stillWrong.length - 40}` : ''}`);
}

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

// --checklist: added numbers in random verses as yes/no items for the
// by-hand answer key. Only the aligner's own additions are judged; CrossWire's
// tags aren't in question. The first round (150 verses) wrote
// raw/checklist.json; once answer-key.json exists, only placements it hasn't
// judged are listed, ~100 items, in raw/checklist2.json.
if (CHECKLIST) {
  const keyPath = join(import.meta.dirname, 'answer-key.json');
  const key = existsSync(keyPath) ? JSON.parse(readFileSync(keyPath, 'utf8')) : null;
  const fresh = (ref, p) => !key || key[`${ref}-${p.token}`]?.num !== p.num;
  let s2 = 7;
  const rand2 = () => ((s2 = (s2 * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const withAdds = refs.filter((r) => results.get(r).some((p) => fresh(r, p)));
  const picked = new Set();
  let items = 0;
  while (key ? items < 100 && picked.size < withAdds.length : picked.size < Math.min(150, withAdds.length)) {
    const ref = withAdds[Math.floor(rand2() * withAdds.length)];
    if (picked.has(ref)) continue;
    picked.add(ref);
    items += results.get(ref).filter((p) => fresh(ref, p)).length;
  }
  const verseOut = [...picked].sort((a, b) => refs.indexOf(a) - refs.indexOf(b)).map((ref) => {
    const v = verses.get(ref);
    return {
      ref,
      words: v.tokens.map((t) => t.word),
      adds: results.get(ref).filter((p) => fresh(ref, p)).map((p) => {
        const d = dict[p.num] ?? {};
        return { id: `${ref}-${p.token}`, token: p.token, num: p.num, lemma: d.lemma ?? '', xlit: d.xlit ?? '', kjv: d.kjv_def ?? '' };
      }),
    };
  });
  const out = key ? 'checklist2.json' : 'checklist.json';
  writeFileSync(join(RAW, out), JSON.stringify(verseOut));
  console.log(`Wrote raw/${out} (${verseOut.length} verses, ${verseOut.reduce((n, v) => n + v.adds.length, 0)} items).`);
}
