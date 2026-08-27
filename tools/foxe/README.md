# Fox's Book of Martyrs — data prep

Standalone builder for the Library's **Fox's Book of Martyrs** entry.
Run outside the app; nothing here is part of the Tauri runtime.

```
node build.mjs             # download (or reuse raw/ cache) and build
node build.mjs --refetch   # ignore the cache and re-download
node build.mjs --audit     # also print every detected sub-entry heading and
                           # every bracketed editorial aside, for review
```

Writes `foxe.json` here and a copy to
`public/library/historical/foxe.json`, which is what ships with the app.
`raw/` is a download cache and is git-ignored — delete it to force a clean
fetch.

## Which edition this is

Project Gutenberg [#22400](https://www.gutenberg.org/ebooks/22400) — *Fox's
Book of Martyrs, Or A History of the Lives, Sufferings, and Triumphant
Deaths of the Primitive Protestant Martyrs*, credited to John Foxe,
published by The John C. Winston Co. Released by Gutenberg on 25 August
2007; produced by the Online Distributed Proofreading Team (pgdp.net).

**This is not Foxe's own text.** It is a 19th-century compilation and
abridgement *built on* Foxe's work — its own preface says so outright
("This work is strictly what its title page imports, a COMPILATION…") — and
its unnamed editor extended it to cover persecution history down to 1830.
Foxe died in 1587, and his *Actes and Monuments* was published in
1563/1570. Don't let a title or a blurb flatten that distinction; the
bundle's `license_note` carries it into `sources.license_note`, and the
Library panel repeats it.

Chosen over the better-known 1926 Forbush edition, whose clean-text
availability is weaker (scans and OCR rather than a DP-proofread plain
text), and over sourcing *Actes and Monuments* directly: far larger, Early
Modern English, and no equivalently clean public-domain digitisation
currently in hand.

| | |
|---|---|
| Primary | `https://www.gutenberg.org/cache/epub/22400/pg22400.txt` |
| Mirror | `https://archive.org/download/foxsbookofmartyr22400gut/pg22400.txt` |

The mirror is a fallback only. The two have been checked identical by hand,
not by the build, so `build.mjs` prints a loud warning when it falls back —
re-verify before trusting a bundle built that way.

## Licence

Public domain: pre-1928 US publication. Project Gutenberg's own licence
covers the digitisation and imposes no further restriction, so this is a
normal addition to the Library's public-domain-only catalogue — not an
exception like the Talmud. `build.mjs` **hard-fails** if the downloaded file
no longer carries Gutenberg's standard licence boilerplate ("This eBook is
for the use of anyone anywhere…"), the same discipline `tools/jfb` and
`tools/smiths-dictionary` apply to their OSIS `DistributionLicense` fields.

## Structure, and why the parser distrusts the CONTENTS page

23 numbered chapters, most containing named sub-entries (individual
martyrs, persecutions, events). The front-matter CONTENTS section implies
that shape but is **not a parsing spec** — the body doesn't mark sub-entries
uniformly:

- Chapter I names apostles as `_I. St. Stephen_` — roman numeral + name.
- Chapter II names persecutions as
  `_The First Persecution under Nero, A. D. 67._` — ordinal word +
  descriptive title.
- Chapter III uses a bare descriptive title with **no numbering scheme at
  all**: `_Persecutions under the Arian Heretics._`,
  `_Persecution under Julian the Apostate._`

All three are the same underlying thing: a short, wholly-italicised block
standing alone as its own paragraph, immediately followed by body text. The
parser detects that *shape* and nothing else. In particular it applies **no
lexical test** — keying on a roman numeral or an ordinal word would silently
miss every Chapter III heading, and there may be further conventions in the
chapters not yet read.

Trailing punctuation sits on **either side** of the closing marker,
inconsistently:

| | |
|---|---|
| inside | `_II. James the Great._` |
| outside | `_IV. Matthew_,`  `_IX. Peter_,`  `_The Eighth Persecution, under Valerian, A. D. 257_,` |

So the block is *not* required to end with an underscore — only for the tail
after the closing marker to be punctuation. Requiring it drops every heading
of the second shape without a trace. The punctuation is trimmed off the
label whichever side it sat on: a comma in `_IV. Matthew_,` belongs
grammatically to the sentence that follows ("Whose occupation was…"), but
the label is used as a TOC row and as the `position_ref` citation, where a
dangling comma is noise. **The paragraph text is left exactly as the source
has it** — nothing is absorbed into or removed from `entries.text` to
compensate. Chapter headers (`CHAPTER I.` plus an ALL-CAPS title
line) are consistent throughout and are the reliable top-level split point;
CONTENTS repeats them, so the body is taken as the last run of chapter
headers counting from I without gaps.

Chapters **IX, XI and XV** have no named sub-entries — a single continuous
narrative apiece. That's expected, and `build.mjs` asserts it, so a genuine
failure of heading detection can't hide behind "this chapter just has none".

Front matter (title page, preface) and the CONTENTS section are not
imported: editorial framing, not primary reading content, and the generated
`toc_entries` supersede CONTENTS. Same precedent as skipping OSIS headers
and CCEL "Title Page" containers.

## Editorial asides are kept, not stripped

The compiler interjects in his own voice inside brackets, signed `--_Ed._`:

> [It is, however, very uncertain, whether Peter ever visited Rome at
> all… --_Ed._]

These stay in `entries.text`. They are part of this edition, not a
proofreading artifact and not a footnote of the kind stripped from Josephus
(Whiston's) or the Church Fathers (Roberts/Donaldson's). Run
`node build.mjs --audit` to list every signed aside *and* every other long
bracketed passage before assuming any blanket rule about brackets.

Gutenberg's `_underscore_` italics are unwrapped, since `entries.text` is
plain text everywhere in this app and no pane renders markup — the same call
the Talmud import made with Sefaria's `<b>` markup.

## The build refuses to ship a half-read book

`validate()` asserts the parsed shape against what the printed book is known
to contain: 23 chapters, every chapter with a title and at least one
paragraph, named sub-entries present in every chapter except IX/XI/XV. Any
mismatch is a build **failure**, not a warning. A parser that has drifted
from the text should stop the build, not produce a bundle that installs
cleanly and is quietly missing half the martyrs.
