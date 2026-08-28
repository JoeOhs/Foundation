# Ovid's Metamorphoses — data prep

Standalone builder for the Library's **Ovid — Metamorphoses** entry.
Run outside the app; nothing here is part of the Tauri runtime.

```
node build.mjs             # download (or reuse raw/ cache) and build
node build.mjs --refetch    # ignore the cache and re-download
node build.mjs --inspect    # print candidate structural lines and stop
node build.mjs --audit      # also print per-fable line ranges and footnote counts
```

Writes `ovid.json` here and a copy to
`public/library/historical/ovid.json`, which is what ships with the app.
`raw/` is a download cache and is git-ignored — delete it to force a clean
fetch.

## Run `--inspect` before trusting a build

The structural patterns in `build.mjs` — book, fable, explanation, footnote
and locator shapes — were written against the printed edition's known layout,
**not** against a byte-for-byte reading of these two transcriptions, because
Project Gutenberg was unreachable from the environment the importer was
written in. `--inspect` downloads both files and prints every line the
patterns match, plus every unmatched ALL-CAPS line (the likeliest sign of a
heading convention the patterns don't know about). Check that output against
the regexes before shipping a bundle.

That is not a formality. Everything downstream of the parse — which fable a
paragraph belongs to, which fable a footnote is filed under — is derived from
these patterns, and a pattern that silently matches nothing produces a bundle
that installs cleanly and is missing half the poem. `validate()` catches the
gross failures (see below); `--inspect` is what catches the subtle ones.

## Which edition this is

Two Project Gutenberg texts, split the way Josephus's four are, folded into
one Library entry:

| | | |
|---|---|---|
| Books I–VII | [#21765](https://www.gutenberg.org/ebooks/21765) | George Bell & Sons reprint, London, 1893 |
| Books VIII–XV | [#26073](https://www.gutenberg.org/ebooks/26073) | David McKay reprint, Philadelphia, 1899 |

Both carry **Henry T. Riley's** literal English prose translation, first
published in 1851 in Bohn's Classical Library. Riley died in 1878 and both
reprints are pre-1928 US publications, so this is public domain twice over —
a normal addition to the Library's public-domain-only catalogue, not an
exception like the Talmud.

`build.mjs` **hard-fails** if a downloaded file's Gutenberg header doesn't
name Riley, the same discipline `tools/josephus` applies to Whiston. The
modern translations — Melville, Lombardo, Martin, Raeburn — are separately
copyrighted and must never be substituted in, however much more readable
they may be.

## Structure

15 books, each a run of numbered **Fables**. Each fable is prose, then
Riley's own `EXPLANATION.` of it. Each book closes with a numbered footnote
block. The citation is `Book.Fable` — `I.7` — a `position_ref` anchor, not a
Bible reference, the same shape as Josephus's Book.Chapter.Section and the
Talmud's daf/amud.

Books are headed with the ordinal spelled out (`BOOK THE THIRTEENTH.`), so
the ordinal words are the lookup; a numeral form is accepted as a fallback so
a differently-set reprint doesn't silently yield zero books.

## Page and line locators are stripped — but harvested first

The reprints interleave page/line locator numbers mid-sentence:

> …the whole universe,2 **I. 6-26** which men…

These are typesetting artifacts, not Ovid's or Riley's words, and they are
stripped from the reading text entirely. There is no parallel to preserve
here, unlike JFB's verse ranges.

They are **harvested before they are stripped**, though, because they are the
only thing in the file that records which Latin lines a given fable covers.
That range is what files each footnote under its owning fable.

## Footnotes are captured, not excluded — and mapped, not guessed

The opposite call from Josephus, for a concrete reason rather than a change
of heart. Whiston's notes are dropped because the transcription fuses their
markers onto the preceding word as bare digits, with no way to tell a marker
from a numeral belonging to Josephus (`Genesis 44:20`). Riley's are cleanly
delimited: bracketed markers in the text, numbered endnotes that open by
naming the Latin line they hang on (`Ver. 5.`).

Notes are numbered **per book**, keyed to a Latin line, not to a fable. So
the mapping is derived: a note's `Ver. N` is matched against each fable's
harvested line range, and the note is filed under the fable that contains it.

A note that **can't** be placed — no `Ver.` at all, or no fable range
covering it — is not guessed at. It goes to the book's last fable under an
explicit `Notes — Book I (unmapped)` label, so it is visible and findable
rather than silently filed against the wrong passage. Every unmapped note is
counted in `metadata.unmapped_footnotes` and reported in
`metadata.exclusions`. If `--audit` shows unmapped counts running high for a
book, that is a signal the locator harvest failed for it, not that Riley
wrote vague notes.

## Front matter is excluded, and logged

Both publishers' introductions (Bell 1893, McKay 1899) and the **Synoptical
View** — a book-by-book plot synopsis — are editorial framing, not fable
content, and the generated `toc_entries` supersede the synopsis anyway. They
are dropped at the first `BOOK THE …` heading, and what was dropped is
recorded in `metadata.exclusions` rather than vanishing silently. Same
audit-trail standard as Whiston's Josephus front matter and JFB's
introductions.

## The build refuses to ship a half-read poem

`validate()` asserts the parsed shape against what the printed work is known
to contain: **15 books, numbered 1–15 with no gaps**, every book with at
least one fable, every fable with at least one paragraph of prose. Each
volume is separately asserted to yield exactly the books it is supposed to
(`21765` → I–VII, `26073` → VIII–XV), so downloading the wrong file is a
build failure rather than a bundle with eight books in it. Any mismatch stops
the build.
