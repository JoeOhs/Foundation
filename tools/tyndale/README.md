# Tyndale — margin-split prototype

Measures whether the Parker Society *Works of William Tyndale* (ed. Walter,
1848–50) can be built from Internet Archive OCR. Not a builder yet: it
writes a report and nothing else. See the Tyndale entry in ROADMAP.md for
the verdict.

## Input (not committed; `raw/` is gitignored)

    curl -L -o raw/vol1.hocr https://archive.org/download/doctrinaltreatis00tynduoft/doctrinaltreatis00tynduoft_hocr.html

Page images for hand-checking: 
`https://archive.org/download/doctrinaltreatis00tynduoft/page/n<leaf>_w1100.jpg`
(the leaf is the hOCR page index, starting at 0).

## Usage

    node split.mjs            # writes split-report.txt (notes per leaf)
    node split.mjs 195 196    # prints the margin notes found on those leaves

## What it found

The body column is found per leaf from where the justified lines end, and
words outside it are taken as margin. That part works: on four hand-checked
leaves (100, 195, 196, 450) it found all 21 printed margin notes at the
right height. **The words inside them are mostly not in the OCR.** The
notes are set in small type, about two note lines per body line, and the
OCR read each margin as an extension of the body line beside it. Every
second note line is dropped or merged (`desePaier.must` = "despair." +
"else he must"). The `_abbyy.gz` output has the same damage, because the
hOCR was derived from it. Of 16 topic glosses, about 1 survives intact.

## Re-OCR of the margin (trial)

Cropping the margin strip from the full-resolution page image
(`.../page/n<leaf>.jpg`, 2574 × 4134, the same coordinates as the hOCR)
and running Tesseract 5 (`tesseract.js`, `eng`, PSM 6) on the crop alone
reads all 21 notes on the four test leaves. About 12 of ~190 words are wrong,
half of them the small-caps `W. T.` attribution mark. Numbers and next
step are in ROADMAP.md.
