# Josephus — data prep

Standalone builder for the Library's **Josephus — Complete Works** entry.
Run outside the app; nothing here is part of the Tauri runtime.

```
node build.mjs             # download (or reuse raw/ cache) and build
node build.mjs --refetch   # ignore the cache and re-download
```

Writes `josephus.json` here and a copy to `public/library/josephus.json`,
which is what ships with the app. `raw/` is a download cache and is
git-ignored — delete it to force a clean fetch.

## Translation: Whiston only

Every text is **William Whiston's 1737 translation** (translator d. 1752 —
long public domain), taken from Project Gutenberg:

| Work | Gutenberg |
|---|---|
| The Wars of the Jews | 2850 |
| Antiquities of the Jews (20 books) | 2848 |
| The Life of Flavius Josephus | 2846 |
| Against Apion | 2849 |

Modern translations of Josephus — Loeb, Feldman, Mason/Brill and similar —
are **separately copyrighted and must never be substituted in**, however
much more readable they are. `build.mjs` checks each downloaded file's
Gutenberg header for `Translator: William Whiston` and refuses to build
without it.

## Whiston's footnotes are excluded

Whiston interleaved extensive translator footnotes and dissertations with
the text. These are stripped, not captured, and they never reach
`entries.text`. Three block formats are removed (`FOOTNOTES`,
`WAR BOOK n FOOTNOTES`, `Footnotes`), along with their bodies
(`36 (return) [ … ]`, `[Footnote 1: … ]`).

Inline markers are the subtle case: the transcription renders them as bare
digits fused onto the preceding word — `over1 begins`, `soul.2 This`,
`Red Sea.4 Now` — which corrupt the word if left in. Only the *fused* form
is stripped. A digit standing alone between spaces is left untouched,
because it may legitimately belong to Josephus (`Genesis 44:20`,
`the 12 tribes`), and wrongly stripping one silently rewrites the text.

They are not captured into an `entry_notes`-style table either: with no
delimiter separating a marker from a real numeral, anchoring them to a word
position would mean guessing, and a wrong guess corrupts the text. Losing
Whiston's commentary is the better trade — see the header of
`src/josephusImport.ts`.

## Output shape

One **compound work**: a single source with ~31 books under it and a
three-level `Work → Book → Chapter` table of contents.

```
parts[]                     4 works
  books[]                   Preface, Book 1…20, …
    chapters[]
      sections[]            { number, text }   ← one entries row each
```
