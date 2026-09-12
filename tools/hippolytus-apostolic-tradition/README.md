# Hippolytus — The Apostolic Tradition — data prep

Standalone builder for the Library's **Hippolytus — The Apostolic Tradition
(tr. Easton, 1934)** entry. Run outside the app; nothing here is part of the
Tauri runtime.

```
node build.mjs             # download (or reuse the raw/ cache) and build
node build.mjs --refetch   # ignore the cache and re-download
```

Writes `hippolytus-apostolic-tradition.json` here and a copy to
`public/library/patristic/hippolytus-apostolic-tradition.json`, which is what
ships with the app. `raw/` is a download cache and is git-ignored — delete it
to force a clean fetch.

Source: Project Gutenberg ebook
[#61614](https://www.gutenberg.org/files/61614/61614-h/61614-h.htm), produced
by Stephen Hutcheson and the Distributed Proofreaders.

## Not an Ante-Nicene Fathers volume

The entry is shelved under Church Fathers → Ante-Nicene Fathers and listed
after Vol. 9, but it is **not one of the numbered volumes and not "Vol. 10"**
— Vol. 10 is the Roberts/Donaldson General Index, which the Library omits for
unrelated reasons. Hippolytus had not been identified as this work's author
when the ANF translation was made in the 1880s, and no critical text of it
existed; ANF Vol. 5 carries his *Refutation of All Heresies* and his extant
fragments and nothing of the Apostolic Tradition.

## Licence

Public domain in the US, verified individually rather than assumed — this is
the project's second copyright edge case after the Talmud.

The work survives only through derivative later manuscripts (a Latin
palimpsest at Verona, plus Sahidic, Arabic and Ethiopic versions), so every
usable English text is a modern scholarly reconstruction. The edition used is
**Burton Scott Easton's**, published 1934 by Cambridge University Press.

- It was **printed in the United States** and carries a US copyright notice,
  making it a domestic 1909-Act work rather than a foreign-first-publication
  case needing URAA restoration analysis. That distinction matters: Easton did
  not die until 1950, and UK copyright runs life + 70.
- As a 1909-Act work it needed a renewal filed inside a 28-year window, which
  for a 1934 publication falls somewhere in 1961–1962 depending on the month.
  **All four candidate half-year volumes** of the Library of Congress's
  *Catalog of Copyright Entries, Third Series* (Renewals) were checked by
  hand, and **no entry for Easton appears in any of them**:

  | Window | Catalog |
  |---|---|
  | Jan–Jun 1961 | [books.google.com/books?id=pyMhAQAAIAAJ&pg=PA807](https://books.google.com/books?id=pyMhAQAAIAAJ&pg=PA807) |
  | Jul–Dec 1961 | [books.google.com/books?id=2iQhAQAAIAAJ&pg=PA1843](https://books.google.com/books?id=2iQhAQAAIAAJ&pg=PA1843) |
  | Jan–Jun 1962 | [books.google.com/books?id=XiYhAQAAIAAJ&pg=PA855](https://books.google.com/books?id=XiYhAQAAIAAJ&pg=PA855) |
  | Jul–Dec 1962 | [books.google.com/books?id=8ychAQAAIAAJ&pg=PA1965](https://books.google.com/books?id=8ychAQAAIAAJ&pg=PA1965) |

- The term therefore lapsed unrenewed. Project Gutenberg reached the same
  conclusion independently, and the Online Books Page lists the title on its
  Easton author page.

**Gregory Dix's 1937 edition and the Dix/Chadwick 1968 revision are still in
copyright** (SPCK). They must never be used as a source text here, and the
wording of Easton's translation must never be checked against them.

No Library disclaimer accompanies this source: unlike the two Talmuds it is
not an exception to the Library's public-domain rule.

## What is kept and what is stripped

Kept:

- Hippolytus's text, all 38 numbered chapters across Parts I–IV and the
  "Later Additions", paragraph per entry.
- Easton's **superscript sentence numbers**. His notes, his introduction and
  the scholarly literature all cite the work as "36. 12"; without them that
  citation cannot be followed in the reading pane.
- Easton's **Introduction**, as its own book with its own TOC branch —
  Prefatory Note, The Important Books, I. Church Orders (ten subsections) and
  II. Hippolytus. A reconstructed work with this much transmission history
  behind it is not usefully read without the essay explaining it, and ANF
  Vol. 5 sets the precedent by carrying Hippolytus's own Introductory Notice
  as a first-class work entry.

Stripped, and never reaching `entries.text`:

- Gutenberg's boilerplate and the transcriber's notes.
- Easton's **notes, footnote markers and indexes** — the standing rule across
  the ANF/NPNF volumes, Whiston's Josephus and the Strong's import.
- The printed **page numbers**, which would otherwise fuse into the sentences
  they interrupt.
- The marginal **manuscript sigla** (LAT/GRE/SAH/ETH) marking which witness
  covers each line. Real information, but *marginal* information: Foundation
  has nowhere to put a margin, and dropped into the run of the text they read
  as words Hippolytus wrote.

## Section titles are Easton's, not invented

Easton gives the printed translation no section titles at all — only numbers.
He does head his **Notes** with them ("2 / THE BISHOP", "4-6 / THE EUCHARIST",
"11-15 / MINOR ORDERS"), and names the parts there too ("PART I /
Ordination"), so those are what the TOC carries. A heading covering a span of
chapters is attached to the chapter that opens the span and names the span in
the row ("Chapters 4–6. The Eucharist"); the chapters inside it stay untitled,
because he did not separately title them.

## The build refuses doubtful input

`build.mjs` hard-fails rather than shipping a text this project has not
cleared. It checks:

- Project Gutenberg's end marker for **ebook 61614** specifically.
- The transcribers' public-domain statement.
- The `author` and `DC.Title` metadata naming **Burton Scott Easton** and
  **The Apostolic Tradition of Hippolytus** — so a mistyped ebook number or a
  swapped translation fails loudly instead of shipping quietly.
- The two verso lines the clearance rests on: "Copyright 1934, Cambridge
  University Press" and "PRINTED IN THE UNITED STATES OF AMERICA".

It also pins the parsed shape: the exact chapter list of every part (the
numbering is not a simple run — there is no chapter 7, and 24, 26, 31 and 32
appear twice over), a subsection count for each introduction part, and the
number of unnumbered paragraphs dropped from "Later Additions". That last
check matters: Easton prints his discussion of each later addition directly
beneath it with no heading between them, and the two are told apart only by
his paragraphs carrying none of the superscript verse numbers every translated
paragraph has. A changed count means either his prose is reaching the text or
Hippolytus's is being thrown away.
