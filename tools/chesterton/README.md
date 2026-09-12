# G.K. Chesterton — data prep

Standalone builder for the Library's **G.K. Chesterton — Christian
Apologetics** entry. Run outside the app; nothing here is part of the Tauri
runtime.

```
node build.mjs             # download (or reuse raw/ cache) and build
node build.mjs --refetch   # ignore the cache and re-download
```

Writes `chesterton.json` here and a copy to
`public/library/apologetics/chesterton.json`, which is what ships with the
app. `raw/` is a download cache and is git-ignored — delete it to force a
clean fetch.

## Scope: apologetics only

| Title | Year | Gutenberg |
|---|---|---|
| Heretics | 1905 | 470 |
| Orthodoxy | 1908 | 16769 |
| St. Francis of Assisi | 1923 | 63084 |
| The Everlasting Man | 1925 | 65688 |

Chesterton wrote across fiction, poetry, social criticism and theology. This
source is the **apologetics and theology** only. The Father Brown stories,
the poetry and the general social commentary are deliberately out of scope:
a Library row that means "Chesterton's Christian writings" stops meaning
anything the moment the detective fiction is filed under it.

Two later titles are deliberately **not** here:

- **St. Thomas Aquinas** (1933)
- **The Catholic Church and Conversion** (1926)

Neither is on Project Gutenberg as of this build, and Aquinas in particular
sits close enough to the rolling US public-domain cutoff (works published
1930 or earlier are public domain as of 1 January 2026) that it must not be
eyeballed. If either is added later, `assertGutenbergPublicDomain()` is the
gate that decides it — not manual judgement.

## Licence is guarded, not assumed

Every title is public domain in the US, with Project Gutenberg's own vetting
as the trust basis — the same basis the Josephus and Fox's Book of Martyrs
bundles rely on. `build.mjs` refuses to build a file that doesn't carry
Gutenberg's licence boilerplate, doesn't declare `Author: G. K. Chesterton`,
or doesn't name the title that was asked for. A mistyped ebook number fails
loudly instead of shipping somebody else's book.

Gutenberg's own header/footer boilerplate is stripped and never reaches
`entries.text`.

## Four parsers, not one sniffer

The four transcriptions mark their chapters four different ways, and there is
no honest common regex:

| Book | Heading shape |
|---|---|
| Heretics | `I.  Introductory Remarks…` at column 0 |
| Orthodoxy | `CHAPTER I.--_Introduction in Defence…_` |
| The Everlasting Man | `CHAPTER I` with the title on the next line |
| St. Francis of Assisi | indented `_Chapter I_` / `_The Problem of St. Francis_` |

So each gets its own small named parser. Each book's parsed shape is then
asserted — chapter count, a title on every numbered chapter, a word-count
floor — so a Gutenberg re-release that changes a heading's spelling fails the
build instead of quietly shipping a book with half its chapters swallowed
into the one before.

Non-Chesterton matter each transcription carries is dropped: the repeated
tables of contents, the transcribers' biography of Chesterton in *Heretics*,
the transcriber's note at the end of *The Everlasting Man*, and the
publisher's back-matter catalogue and printer's colophon in *St. Francis*.

## The Everlasting Man's parts

It is the only one of the four with a part division (two parts, of eight and
six chapters, plus a prefatory note, introduction, conclusion and two
appendices). The part is folded into the chapter's **label** — "Part 1,
Chapter 3" — rather than given a TOC level of its own. The `toc_entries`
machinery would carry a third level quite happily; Josephus uses one. But
this is the only book in the source that has parts, and a dropdown whose
depth changes between books reads as a glitch.

## Output shape

One **compound work**: a single source with four books under it and a
two-level `Title → Chapter` table of contents.

```
titles[]                    4 books
  chapters[]                58 in total
    paragraphs[]            918 in total ← one entries row each
```
