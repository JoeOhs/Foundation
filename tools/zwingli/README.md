# Zwingli — Selected Works builder

Parses *Selected Works of Huldreich Zwingli*, edited by Samuel Macauley
Jackson (University of Pennsylvania, Philadelphia, 1901), into
`public/library/reformation/zwingli.json`, which `src/zwingliImport.ts`
installs.

```
node build.mjs           build the bundle and zwingli-exclusions.txt
node build.mjs --audit   also print the Work → Section outline
```

## Source

`raw/` is gitignored. It needs one file, supplied by hand. **The script makes
no network call.**

| File | Source |
|---|---|
| `translationsrepr01pennuoft_djvu.xml` | `archive.org/download/translationsrepr01pennuoft/` |

No transcription of this volume exists, so this is OCR. It is the DjVu XML
rather than the plain `_djvu.txt` because the plain text loses the type size
and indents the build depends on.

## What it is, and is not

A selection of five documents, 1522–1527, which Jackson says he chose because
they had never been translated. It is **not** a collected works and not the
first volume of one. The table of contents, preface and title page all agree.

## How the page is read

- **Footnotes vs. body**: line pitch over page height, on blocks of 3+ lines
  (footnotes 16–23.3, body 24–25). Shorter blocks use word height against the
  page's confirmed body text, and inherit footnote status from a footnote
  above them. A leading `*`, `•`, `§` or OCR'd dagger (`t`) also marks one.
- **Paragraphs**: DjVu blocks often run a page's paragraphs together. A break
  is a line indented 30–80 px past the lines around it (the scan is skewed),
  following a line that ends a sentence.
- **Headings**: short all-capitals lines. Declared ones in `WORKS` open a
  section. Every other one (speaker names in the Disputation, the Articles'
  topic headings) becomes a paragraph of its own above the text it labels.
- **Page turns**: a page's first paragraph joins the previous one if that
  one stopped mid-sentence or this one opens in lower case.

## Gates

The build fails if the scan has fewer than 270 pages. It also fails if any
document locator in `WORKS` is not found in order, if any declared section is
missing, if any section is empty, or if the Sixty-seven Articles do not come
out as exactly 67 numbered paragraphs.

## Excluded

These are logged to `zwingli-exclusions.txt`: front matter, table of
contents, running heads, page numbers, footnotes and the publisher's series
advertisements. **Jackson's special introductions to each document are among
the footnotes**, because the edition prints them in footnote type, attached
to the title's asterisk and mixed in with source citations.

## Known OCR residue

Misread letters survive (`toth` for 10th, `$d` for 3d, `Zvvingli`). Every
line-end hyphen is closed up, so a compound broken at its own hyphen loses
it. One named correction is applied: `LXVIL` → `LXVII.`.
