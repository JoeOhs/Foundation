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

## Usage

    node split.mjs              # writes split-report.txt
    node split.mjs 195 196      # prints the notes for those leaves only

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
