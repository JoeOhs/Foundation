# Jamieson, Fausset & Brown — bundle builder

Builds `public/library/jfb.json`, the bundled copy of **Commentary Critical
and Explanatory on the Whole Bible** (Robert Jamieson, A. R. Fausset and
David Brown, 1871) that installs from the Library's "Commentaries" section
and reads in the study footer's **Commentary** tab.

```
node build.mjs            # uses raw/jfb.osis.xml if cached
node build.mjs --refetch  # force a fresh download
```

## Provenance

| Field  | Value |
| ------ | ----- |
| Text   | CrossWire Bible Society `jfb` module v3.0 (`DistributionLicense: Public Domain`) |
| Source | https://gitlab.com/crosswire-bible-society/jfb (`jfb.osis.xml`, `jfb.conf`) |
| Upstream | `TextSource=https://ccel.org/ccel/j/jamieson/jfb/cache/jfb.txt` |
| Work   | Commentary Critical and Explanatory on the Whole Bible, 1871 — public domain |

Robert Jamieson (1802–1880), A. R. Fausset (1821–1910) and David Brown
(1803–1897) all died more than a century ago. The CrossWire module's
`DistributionLicense` was confirmed against CCEL's own distribution of the
same text before this was added.

This is the **abridged** JFB. The unabridged edition is reported to carry
inline Hebrew/Greek word tags; this text has none — no `<w>` elements and no
`lemma`/`morph`/`strong` attributes anywhere in the file — so there was
nothing to strip or defer.

## What is imported, and what is not

Only **verse-anchored comments**: the 19,442 blocks delimited by a
`<verse sID=…/>` … `<verse eID=…/>` milestone pair. Everything outside such a
pair anchors to no verse and cannot be placed in a verse-keyed footer, so it
is excluded:

- Jamieson's *Introduction to the Pentateuch and Historical Books*
- Fausset's *Introduction to the Poetical Books* and *…Prophetical Books*
- David Brown's *Chronological Table of the Parables of Christ* and
  *…of the Miracles of Christ*
- the per-book introductions (Revelation's runs to 32 KB)
- the OSIS header

Same call as Whiston's translator footnotes in `josephus/build.mjs` and the
editorial footnotes in the ANF/NPNF builds. Every excluded block is written
to `jfb-exclusions.txt` with its byte count and opening words, so the
decision stays auditable rather than invisible — 571 blocks, ~708 KB.

`<title type="x-s2">` headings are also dropped: all 215 distinct values are
a bare `CHAPTER n`, which is redundant in a chapter-scoped footer.

## Why a flat milestone stream, not a DOM walk

OSIS marks verses with **milestones**, not containers, and in this file a
single comment routinely opens inside one `<p>` and closes inside a later
one — Genesis 2:1 spans three paragraphs:

```xml
<p><verse sID="Gen.2.1" osisID="Gen.2.1" n="1"/><hi type="bold">1. the heavens--</hi>…</p>
<p><hi type="bold">host--</hi>…</p>
<p><hi type="bold">were finished--</hi>… <verse eID="Gen.2.1"/></p>
```

So element nesting cannot be the extraction unit: a DOM walk keyed on `<p>`
truncates that comment at "the firmament or atmosphere." The script scans the
file as a flat token stream and treats the sID/eID pair as the only boundary
that matters, rebuilding paragraph breaks from the `<p>` tags it passes.

## Verse ranges

The source pre-enumerates them, so there is no range syntax to parse:

```xml
<verse sID="Gen.2.5-6" osisID="Gen.2.5 Gen.2.6" n="5-6"/>
```

All 19,442 `osisID`s parse as `Book.Chapter.Verse`; none spans two books or
two chapters; 2,759 (14%) cover a range. The build **fails loudly** on any
that doesn't parse rather than guessing — the same "reject rather than guess"
rule as the Companion Bible notation parser.

## Guards

- **Refuses to run** unless `jfb.conf` still declares
  `DistributionLicense=Public Domain`.
- Fails on any `osisID` that isn't `Book.Chapter.Verse`, names an unknown
  book, or spans two books or chapters.
- Fails on an unterminated verse span, or on any comment that parses to
  empty text.

## Output shape

```
{ metadata: { title, author, license_note, source_url, comment_count },
  books: [ { book: "Genesis",
             comments: [ { chapter: 2, verse: 5, verses: "5-6",
                           heading: null, text: "**5-6. rain, mist--**…" } ] } ] }
```

`src/jfbImport.ts` installs this as one `footer-commentary`-type,
`commentary`-category source with no tables of its own: one book per Bible
book, one entry per comment block.

- `entries.verse` — the first verse covered (what the strip sorts on)
- `entries.position_ref` — the whole covered range (`"5-6"`), in the notation
  `versesInRefRange()` in `src/scripture.ts` already parses for the Companion
  Bible's Structure lines
- `entries.heading` — JFB's own section heading, where the source has one
  (1,275 of them), attached to the comment block that follows it
- `**…**` in the text is JFB's bold lemma (`5-6. rain, mist--`), the phrase
  being commented on; the footer renders it as the cell's lead-in

Hovering a verse in a reading pane marks and scrolls to its cell; **clicking**
one pins the strip so it stops following the cursor while you move down to
read (`pin` in `FooterCommentary.tsx`).

A comment covering a range is **one row**, not one row per verse. The footer
builds its verse → comments index from `position_ref` once per chapter load
(`buildChapterIndex` in `src/components/FooterCommentary.tsx`), which is what
resolves the overlaps: 2,713 verses are covered by more than one comment
(JFB comments on 1 Chr 1:4-23 and again on 1 Chr 1:12), and the narrower
comment renders nested inside the wider one's cell.
