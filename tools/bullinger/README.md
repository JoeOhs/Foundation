# Bullinger — The Decades builder

Parses *The Decades of Henry Bullinger*, translated by H. I. and edited for
the Parker Society by Thomas Harding (Cambridge, 1849–52), into
`public/library/reformation/bullinger.json`, which
`src/bullingerDecadesImport.ts` installs.

```
node build.mjs           build the bundle and bullinger-exclusions.txt
node build.mjs --audit   also print the Book → Piece outline
```

## Source

`raw/` is gitignored. It needs four files, supplied by hand. **The script
makes no network call.** The edition is "5 v. in 4": Decades I–II share the
first volume.

| File | Contents | Source |
|---|---|---|
| `decadesofhenrybu00bulluoft_djvu.xml` | Preface, Four Synods, Decades I–II | `archive.org/download/decadesofhenrybu00bulluoft/` |
| `decadesofhenrybu03bulluoft_djvu.xml` | Dedication to Edward VI, Decade III | `archive.org/download/decadesofhenrybu03bulluoft/` |
| `decadesofbulling04bulluoft_djvu.xml` | Decade IV | `archive.org/download/decadesofbulling04bulluoft/` |
| `decadesofhenrybu05bulluoft_djvu.xml` | Biographical Notice, Decade V, Appendix dedications | `archive.org/download/decadesofhenrybu05bulluoft/` |

No transcription exists, so this is OCR. (`decadesofhenrybu04bulluoft`, the
same scan as the Decade IV file, returned a server error when this was built.)

## How the page is read

These scans' DjVu blocks often hold a whole page, so the page is read line
by line, not block by block.

- **Margin notes**: the column is the median left and right edge of the
  page's full lines; a word wholly outside it is dropped and logged.
- **Footnotes**: from the first line that opens with a bracketed numeral or
  its OCR misreadings (`[!`, `{!`, `[s `), a lone `[BULLINGER.` signature,
  an editor's `Lat.]` gloss, or a line of small type in the lower half of
  the page — to the foot of the page.
- **Paragraphs**: a line indented 40–140 px past its neighbours, after one
  that ended a sentence.
- **Sermons**: `THE FIRST SERMON.` … `THE TENTH SERMON.` opens a piece. The
  all-capitals subject heading above it becomes its title. Other capitals
  lines become a paragraph of their own.

## Gates

The build fails if a volume has too few pages, or if any declared marker is
missing. It also fails unless all five Decades appear in order with ten
sermons each, in order, each with a subject heading and some text.

## Known OCR residue

Misread letters survive. About 16 footnote fragments whose bracket was lost
still sit in the text. Every line-end hyphen is closed up. The misreadings
in the fifty sermon titles are corrected by hand (`TITLE_FIXES`); the
body text is left as the OCR read it.
