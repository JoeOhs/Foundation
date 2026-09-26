# John Knox builders

Two bundles, two scripts:

```
node build.mjs [--fetch] [--audit]   public/library/reformation/knox.json        (Selected Works)
node laing.mjs [--audit]             public/library/reformation/knox-laing.json  (Works, ed. Laing)
```

`build.mjs` can download its two CCEL files with `--fetch`; `laing.mjs` makes
no network call. `raw/` is gitignored.

## Selected Works (`build.mjs`)

| File | Source |
|---|---|
| `history_reformation.xml` | `ccel.org/ccel/knox/history_reformation.xml` — History I–IV, Scots Confession, First Book of Discipline, ed. Cuthbert Lennox (London, 1905), modern spelling |
| `blast.xml` | `ccel.org/ccel/knox/blast.xml` — The First Blast, ed. Edward Arber (London, 1878) |

CCEL's `prayer.xml` (from a modern Still Waters Revival Books edition) is not
used — not cleared.

## The Works, ed. David Laing, 1846–64 (`laing.mjs`)

| File | Contents | Source |
|---|---|---|
| `works1.xml` | Vol. I — History I–II, appendices | `ccel.org/ccel/knox/works1.xml` (Gutenberg #21938) |
| `laing02.html` | Vol. II — History III–V, Book of Discipline, appendices | `gutenberg.org/cache/epub/40886/pg40886-images.html` |
| `laing03.xml` … `laing06.xml` | Vols. III–VI | `archive.org/download/worksofjohnknox0Nknox/worksofjohnknox0Nknox_djvu.xml` (N = 3–6) |

Vols. III–VI have no transcription, so they are OCR, read with the shared
`tools/shared/djvu.mjs` page reader (also used by `tools/bullinger/`): margin
notes cut by position, footnotes from the first small-face line in the lower
part of the page to its foot, running heads and sheet signatures dropped.

Each work's first page is **declared by scan page index** in `OCR_VOLUMES`,
checked by hand against the volume's printed contents; the build refuses a
scan whose page count differs from the one mapped. Vol. II's pieces are cut at
declared HTML markers, found in order.

### Known OCR residue

Misread letters survive throughout (Laing prints Knox's Scots spelling, which
the OCR handles unevenly). About 40 footnote or margin-note fragments still
sit in the text, mostly where the old editions Laing reprints carry their own
side notes inside the column. Every line-end hyphen is closed up.
