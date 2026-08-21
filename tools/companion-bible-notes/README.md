# Companion Bible notes — transcription notation

Data-prep for Foundation's Companion Bible (E. W. Bullinger, d. 1913)
verse-keyed marginal notes. Run **outside** the app:

```
node build.mjs --book=philemon   # compile one book, for testing it alone
node build.mjs --all             # compile every transcribed book
```

`--all` writes `../public/library/companion-bible-notes.json` — the single
bundle that deploys with the app — and copies each referenced page scan into
`../public/library/companion-bible-notes/`. `src/companionNotesImport.ts`
installs whatever books that bundle contains as one source, one `books` row
each, so adding a book needs no code change.

`--book=` writes the same file with just that one book in it, which is how a
book gets tested on its own before being folded in. Re-run `--all` afterwards.

Nothing here is part of the app runtime or `src-tauri/`.

**Adding a book is a data task.** The step-by-step workflow, including the
verification gates and the correction policy for OCR damage, is the
`companion-bible-book` skill (`.claude/skills/companion-bible-book/`).

Transcribed so far: **Philemon**.

## Why a notation instead of JSON by hand

Structure diagrams are Bullinger's nested outlines. They're stored as data
(one `entries` row per outline line) rather than as page images, so
Foundation's existing highlight / link / note features work on individual
outline lines with no new schema. Transcribing them therefore has to be
comfortable enough to do straight from a page scan, which hand-written JSON
is not.

## Structure notation (`*.structure.txt`)

Blank lines are ignored. A line whose first non-space character is `#` is a
comment.

### Directives

Each appears on its own line, before the content lines it applies to:

| Directive | Meaning |
|---|---|
| `[[diagram: TITLE]]` | starts a new diagram |
| `[[anchor: Book C:V-V]]` | the diagram's verse range, e.g. `Philemon 1:1-25` |
| `[[pdf: FILE]]` | optional page scan, named as it appears in `thecompanionbible_202504_pdf/`; the build copies it into `public/library/companion-bible-notes/` |
| `[[pdf-page: N]]` | which page of that PDF the diagram is on (1-based; defaults to 1) |
| `[[group: LABEL]]` | closes a brace group (see below) |

### Content lines

```
<indent>LABEL | REF_RANGE | TEXT
```

- **Indent is exactly 2 spaces per level.** `depth = indent / 2`, and a
  line's parent is the nearest preceding line at `depth - 1`.
- All three fields are required *positionally* — a content line always has
  exactly two `|` separators — but `REF_RANGE` and `TEXT` may be empty.
- A line with an empty `TEXT` is a **bracket line**: one of Bullinger's
  bold letters that spans a block of members without carrying text of its
  own. Bracket lines get no `entries` row (there is nothing to read,
  highlight, or annotate); they exist only to carry the nesting.

Example:

```
J |  |
  c | 10, 11 | ONESIMUS PROFITABLE (ONESIMOS) TO THEE AND ME.
  d | 12 | RECEIVE HIM AS MYSELF.
```

### Depth and the staircase

Bullinger prints a correspondence as a **staircase**: each successive member
steps rightwards into the centre of the introversion and back out again.
Philemon's `C` block runs `G → H → J → c → d → K`, with the `K`/`K` pair at
the centre sitting deepest, then mirrors back out through `J → H → G`.

Indentation here reproduces that, because it is what the page shows and what
makes the outline readable. Two consequences:

- `parent_id` follows the **printed** nesting, not a flat sibling grouping —
  inside a staircase, `H`'s parent is `G` rather than the block that
  contains them both.
- The six top-level members (`A B C C B A`) are genuine siblings and do stay
  at depth 0.

### Brace groups

`[[group: LABEL]]` claims **every content line emitted since the previous
group marker** (or since the start of the diagram, for the first one). This
matches how the braces actually print — as a stack of consecutive spans down
the right margin — and needs no depth arithmetic.

**Re-using a label later in the file adds those lines to the same group.**
Bullinger's correspondence pairs sit at opposite ends of the outline —
Philemon's two `PAUL AND PHILEMON` spans are the first and last blocks — so
the label text is the key. There is no separate group ID.

## Prose notation (`*.notes.txt`)

One note per line:

```
VERSE | TEXT
```

Bullinger's marginal (side) notes, one entry per verse — the part meant to
be read alongside the translation. Multiple notes may share a verse number;
they keep file order.

**Verse `0`** marks a book-level *introductory* note (Bullinger prints a few
before the text itself). These are stored with no verse. Only the first is
labelled — the heading covers the whole run, so repeating it above every
paragraph would just be noise.

**`[[heading: TEXT]]`** supplies the page's own heading over those
introductory notes (for Philemon, "NOTES ON THE EPISTLE TO PHILEMON"). It
renders as `Introduction · TEXT`, once. At most one per file.

## Validation

The parser **rejects rather than guesses**. This is transcribed by hand from
a scan, where a silent misparse is far worse than a crash. It fails, with a
line number, on:

- indentation that isn't a multiple of 2 spaces
- a depth that jumps by more than one level after a *text* line (a jump
  straight after a bracket line is legal — that's the staircase stepping in)
- a content line with no shallower line before it to act as its parent
- a content line without exactly two `|` separators
- a `REF_RANGE` not matching `-?N( [,-] N)*-?` (so `1, 2`, `4-6`, `7-`,
  `-19` and `18, 19-` pass; `1;2` fails)
- a `[[group:]]` that would claim zero lines
- a `[[pdf:]]` naming a file that isn't in `thecompanionbible_202504_pdf/`,
  or a `[[pdf-page:]]` that isn't a positive whole number
- `[[anchor:]]` / `[[pdf:]]` / content lines appearing before any
  `[[diagram:]]`, or a `[[diagram:]]` with no `[[anchor:]]`
- a bracket line with no children

## Known limitation

Bullinger distinguishes the two halves of a correspondence pair
typographically — the second member's letter is set in *italic* (`K` vs
*K*). The `label` field records the plain letter only; the roman/italic
distinction is not captured. It remains visible via the diagram's
"View original page" link, which opens the scanned page itself.

## Sources

*The Companion Bible* (E. W. Bullinger, 1913). Public domain — Bullinger
died in 1913. Philemon is printed pages 1820–1822 (per the
`*_page_numbers.json`).

Four renderings of the same Internet Archive scan
(`thecompanionbible_202504`) are available here, all produced from a single
Tesseract OCR pass — so they agree on OCR errors, and cross-referencing them
resolves *reading order and completeness*, not character accuracy:

| Source | Directory | Best for |
|---|---|---|
| Page image | `images/` | the Structure diagram's visual layout |
| HOCR | `thecompanionbible_202504/` | word bounding boxes — settles columns and indentation |
| PDF | `thecompanionbible_202504_pdf/` | `pdftotext -layout` keeps the note column separate and in verse order |
| EPUB | `thecompanionbible_202504_epub/` | recovers bottom-of-page note blocks the PDF splits up |
| JSON | `thecompanionbible_202504_json/` | printed page numbers, for citation |

- **Structure diagram**: transcribed from the page image, with indentation
  cross-checked against HOCR word bounding boxes.
- **Marginal notes**: complete for all 25 verses plus the four introductory
  notes, built primarily from the PDF layout, with the EPUB and HOCR used to
  recover and place the bottom-of-page blocks. The correction policy for OCR
  damage is documented in the header of `philemon.notes.txt`.
