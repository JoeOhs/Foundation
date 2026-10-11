# Tyndale — margin splitter

Splits the Parker Society *Works of William Tyndale* (ed. Walter, 1848–50)
into body text and marginal notes, and re-reads the notes with Tesseract.
Not a builder yet: it writes a report and nothing else. See the Tyndale
entry in ROADMAP.md for the measurements and the open decision.

## Input (not committed; `raw/` is gitignored)

    npm install
    curl -L -o raw/vol1.hocr https://archive.org/download/doctrinaltreatis00tynduoft/doctrinaltreatis00tynduoft_hocr.html
    curl -L https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz | gunzip > raw/eng.traineddata

Full-resolution page images go in `raw/img/` as `n<leaf>.jpg`, where the
leaf is the hOCR page index starting at 0:

    curl -L -o raw/img/n195.jpg https://archive.org/download/doctrinaltreatis00tynduoft/page/n195.jpg

Only leaves with an image are re-read, so a sample can be measured without
fetching all 624. The script itself makes no network calls.

Vol. II (`--vol 2`) has no hOCR on Internet Archive; it reads the DjVu XML,
with images in `raw/img2/`:

    curl -L -o raw/vol2.djvu.xml https://archive.org/download/expositionsnotes00tynduoft/expositionsnotes00tynduoft_djvu.xml
    curl -L -o raw/img2/n264.jpg https://archive.org/download/expositionsnotes00tynduoft/page/n264.jpg

## Usage

    node split.mjs                  # writes split-report.txt
    node split.mjs 195 196          # prints the notes for those leaves only
    node split.mjs --vol 2 [leaves] # the same for Vol. II (split-report-vol2.txt)

## How it works

1. **Body column.** Found per leaf from where the justified lines end and
   start (the densest cluster of word edges), from the hOCR.
2. **Why the hOCR margin is not used.** The notes are set in small type, about
   two note lines per body line. The OCR read each margin as an extension
   of the body line beside it, so every second note line is dropped or
   merged (`desePaier.must` = "despair." + "else he must"). The `_abbyy.gz`
   output has the same damage, because the hOCR was derived from it.
3. **Re-OCR.** The margin strip is cropped from the page image (same
   coordinates as the hOCR) and read by Tesseract 5 (`tesseract.js`, `eng`,
   PSM 6), twice: at 3 px and 10 px outside the body edge. The gutter is
   too narrow for any single inset (see `INSETS` in split.mjs).
4. **Notes.** Lines are grouped into notes: a note ends at its `W. T.` /
   `Ant. ed.` mark, a citation stands alone, and otherwise a large vertical
   gap starts a new note. The small-capital marks, which Tesseract misreads
   constantly, are repaired by rule.
5. **Checks.** Each note is flagged for hand reading if a word is not in the
   volume's body text, a lone letter is left over, a line-break hyphen
   won't join, a word is low-confidence, or a citation doesn't name a book
   with a roman chapter. For each note, the reading with fewer suspect
   words is kept.

## Vol. I marginal notes (done)

`vol1.notes.txt` is the proofread transcription of every Vol. I marginal
note: 2,112 notes on 588 leaves, each checked against the scan. Its header
gives the format and correction policy. `node split.mjs --draft` produced
the starting draft and refuses to overwrite the file now that it holds
proofread work.

## The Vol. I bundle (`build.mjs`)

    node build.mjs --ocr        # read each page's text column with Tesseract (cached in raw/body/)
    node build.mjs              # write public/library/reformation/tyndale-vol1.json
    node build.mjs --headings   # list heading-like lines, to check the declared works

**Body text.** IA's OCR is used only to find each page's text column. It
can't supply the text, because it read the margin notes into the lines
beside them ("speak evil of it, and do but all the shame", leaf 244). So
each column is cropped from the page image and read by Tesseract on its
own, cropped to 4 px past the column's right edge.

**Works.** Each work starts at a declared leaf and height (`PIECES`),
because many prologues begin part-way down a page. Each also has a
check word that must appear in its opening, so a drifted start stops the
build. Walter's Biographical Notice and his introductory notices are kept
as pieces labelled "(Walter)".

**Left out**, all logged to `tyndale-exclusions.txt`: the Advertisement,
title blocks, running heads, sheet signatures, and Walter's footnotes.
Footnotes are found as a block at the foot of the page, under a gap,
opening with a marker (`[1`, often misread `[l`, `t1`, `C1`) and never
larger than the text. A note that spills over from the previous page is
taken only when every line down to the next clear marker is set small,
so Tyndale's own small-type subheads ("Of Order.") survive.

**Marginal notes** come from `vol1.notes.txt`, never from OCR. Each goes
on `entries.heading` of the paragraph whose line it sits beside. Notes
broken across a page are joined first.
