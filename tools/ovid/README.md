# Ovid's Metamorphoses — data prep

Standalone builder for the Library's **Ovid — Metamorphoses** entry.
Run outside the app; nothing here is part of the Tauri runtime.

```
node build.mjs             # parse raw/ and build
node build.mjs --inspect   # report the structure found in raw/ and stop
node build.mjs --audit     # also print per-unit paragraph and note counts
```

Writes `ovid.json` here and a copy to
`public/library/historical/ovid.json`, which is what ships with the app.
`raw/` holds the two source files and is git-ignored.

Current build: **136 fables in 123 units across 15 books, 788 paragraphs of
translation, 350 paragraphs of Riley's Explanations, 1,273 footnotes** —
2,411 entries, 1.5MB, comfortably inside the 4.2MB ceiling Josephus set.

## Which edition this is

| | | |
|---|---|---|
| Books I–VII | [#21765](https://www.gutenberg.org/ebooks/21765) | George Bell & Sons reprint, London, 1893 |
| Books VIII–XV | [#26073](https://www.gutenberg.org/ebooks/26073) | David McKay reprint, Philadelphia, 1899 |

Both carry **Henry T. Riley's** literal English prose translation, first
published in 1851 in Bohn's Classical Library. Riley died in 1878 and both
reprints are pre-1928 US publications, so this is public domain twice over —
a normal addition to the Library's public-domain-only catalogue, not an
exception like the Talmud.

`build.mjs` **hard-fails** if a file's header doesn't name Riley, the same
discipline `tools/josephus` applies to Whiston. The modern translations —
Melville, Lombardo, Martin, Raeburn — are separately copyrighted and must
never be substituted in.

## Why this parses the HTML, not the plain text

Gutenberg offers both. The HTML is not merely more convenient here — it is
the only shape that carries the structure this bundle needs:

| | plain text | HTML |
|---|---|---|
| book / fable boundaries | guess from line shape | `name="bookXIV"`, `name="bookXIV_fableIII"` |
| footnote → fable | infer from Latin line ranges | `href="#note8_3"`, exact |
| Riley's commentary | guess from an `EXPLANATION.` line | `p.explanation` |
| fable synopsis | indistinguishable from prose | `p.synopsis` |
| page/line locators | strip by regex, mid-sentence | `span.pagenum`, `span.linenum` |

The last row is the one that would have done real damage. The reprints
interleave locators inside sentences —

> …the whole universe,<sup>2</sup> **I. 6-26** which men…

— so a plain-text build has to strip them by pattern. But Riley *also* cites
classical works in exactly that form inside his own notes: *"See the story of
Aristæus and the recovery of his bees, in the Fourth Book of Virgil's
Georgics, **I. 281-314**."* A regex tight enough to catch the furniture
catches the citation too, and silently mangles Riley. Because the locators
are wrapped in their own spans, this build removes them by *element* and
leaves the citation untouched. That case is checked after every build.

The inline footnote anchors matter almost as much: each marker links to the
note it points at, so a note is filed under the unit whose prose carries its
marker. The mapping is **exact**, not inferred from line ranges, and the
build fails if any note is left unclaimed. All 1,273 map.

## The two files are not marked up alike

Books I–VII head each book with `<h2>` inside a `div.chapter`. Books VIII–XV
use `<h4 class="chapter">` and have **no chapter div at all**. Neither the
heading level nor the wrapper is a safe signal, so the parser keys on the
anchor names, which both files share.

Riley's own footnotes are `note<book>_<n>`; the Gutenberg transcriber's added
notes are `note<book>_<LETTER>`. That one difference is what keeps them
apart — and it is why the transcriber's supplementary notes are excluded
while Riley's are kept.

## Fables are split on their printed heading, not on their anchors

Riley sometimes prints **two or three fables under one heading**:

- `FABLES VI AND VII.` (Book II)
- `FABLES V. AND VI.` (Books XI, XII, XIII)
- `FABLES IV. V. AND VI.` (Book XV)

and the two files disagree about how to anchor that. Book II gives such a
heading a **single** anchor (`bookII_fableVI`, with no `fableVII` anywhere);
Book XIII gives **one per fable** (`fableIII` and `fableIV` inside the same
`<h5>`). So counting anchors yields a different set of units in each file,
and splitting on them cuts a combined heading in half — leaving a phantom
unit holding no prose at all.

The heading is what the printed book divides on, so it is what this divides
on. Every numeral in the heading is a fable the unit covers.

### Ordinal and citation are different numbers, deliberately

This is the part worth not collapsing:

- **`entries.chapter` carries the unit's ordinal** — its position in the
  book. It is the pane's *loading* unit, so it must be dense and unique
  within its book; taken from position, it cannot repeat, and two units can
  therefore never merge. That is the fault Fox's Book of Martyrs exposed on
  first contact with its real text, where two duplicated chapter numerals
  would have fused two pairs of chapters.
- **`position_ref` carries Riley's own numbering** — `II.8`, or `II.6-7`
  where one heading covers two fables, or `XV.4-6` where it covers three.

Numbering the units by position *and* citing them by position would have
renumbered every fable after a combined heading: Riley's Fable VIII in Book
II would have been cited `II.7`, and so on to the end of the book. Splitting
the two keeps the loading unit safe and the citation honest.

## What is excluded, and logged

Every exclusion is recorded in `metadata.exclusions` rather than dropped
silently — this project's standing audit-trail rule.

- Both publishers' introductions (`div.intro`) and the **Synoptical View**, a
  book-by-book plot synopsis, which falls away with everything before the
  first book anchor. Editorial framing, not the poem; the generated
  `toc_entries` supersede the synopsis anyway.
- The Gutenberg transcriber's own apparatus: `div.mynote` / `p.mynote`
  (including notes *about* Riley's notes, which sit inside the footnote
  blocks rather than in the front matter, so cutting front matter alone would
  not catch them) and `div.endnote` (supplementary notes he added himself).
- Back matter from the first of the `texts` / `errors` / `lines` / `names` /
  `footnotes` anchors to the end: his note on the texts used, an errata list,
  and three indexes.

Riley's `<i>` — the words he supplied that the Latin only implies — is
unwrapped rather than dropped: `entries.text` is plain text everywhere in
this app and no pane renders markup, so the emphasis is lost but the words
are kept, the same call the Talmud import made with Sefaria's `<b>` and Foxe
with Gutenberg's `_underscores_`. Greek is kept as its own characters.

## One real anomaly in the source

Book XIII's printed fable numbering reads **1, 3, 4, 5, 6, 7, 8** — no Fable
II. The Gutenberg transcriber suspected the same thing and marked the
heading `<ins class="correction" title="error for 'Fables I. and II.'?">`,
i.e. the McKay reprint most likely dropped "and II." from a combined heading.

The build **reports** this in `metadata.source_anomalies` rather than
guessing at it. Reading order and loading units are unaffected — only the
printed citation is, and Book XIII's unit 1 is cited `XIII.1` rather than
`XIII.1-2` because `XIII.1` is what the page actually prints. Recording the
doubt is better than encoding a guess as a citation.

## The build refuses to ship a half-read poem

`validate()` asserts the parsed shape against what the printed work contains:
**15 books numbered I–XV with no gaps**, every book with at least one unit,
every unit with prose, and **every footnote claimed by a marker in the text**.
That last one is the sharpest check in the file: an unclaimed note means a
marker was missed, which means prose was missed. Each volume is separately
asserted to yield exactly the books it should, so supplying the wrong file is
a build failure rather than a bundle with eight books in it.
