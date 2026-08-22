# Talmud builder

Standalone data-prep for the **William Davidson Talmud** — Rabbi Adin
Even-Israel Steinsaltz's English translation of the Babylonian Talmud
(Bavli), published by [Sefaria](https://www.sefaria.org/) and underwritten by
the William Davidson Foundation.

Run manually, outside the app. The app itself never talks to Sefaria: it reads
the bundles this script writes into `public/library/rabbinic/`.

```bash
node build.mjs
```

| flag | effect |
| --- | --- |
| *(none)* | download (or reuse the `raw/` cache) and build |
| `--refetch` | ignore the cache and re-download |
| `--no-links` | skip the Talmud↔Tanakh link scrape (fast: 37 requests) |

## Licence — the one exception

This is the **only non-public-domain text in Foundation's Library**, included
as a deliberate, signed-off exception. It is **CC BY-NC 4.0**: shareable and
adaptable with attribution, **non-commercial use only**. Foundation is a
personal, offline, non-commercial app, so it sits inside those terms — but
that is a fact about this app, not a general licence to add more non-PD texts.
**Do not generalise this exception to other sources without the same explicit
sign-off.**

`build.mjs` **hard-fails** if Sefaria's metadata reports anything other than
the `CC-BY-NC` licence token, or a version that is not the William Davidson
edition. An upstream licence change breaks the build rather than shipping
silently. Note that Sefaria carries no version number in that field — the
"4.0" comes from their site-wide terms — so the guard pins the exact token
they publish.

Why not a public-domain edition: the only one is Michael Rodkinson's 1918
translation, which covers roughly a third of the tractates and was harshly
criticised by its contemporaries. Steinsaltz is complete and modern, and that
completeness decided it.

## Output

Six bundles, one per Seder — not one monolith. The Talmud is ~43 MB; a single
blob would be ~3.5× the largest bundle the Library ships (JFB, 12 MB).
Per-Seder keeps the biggest install inside that ceiling and lets a user take
the orders they actually study, the way the Church Fathers ship as 37
independently installable volumes.

| bundle | tractates | dafim | size |
| --- | --- | --- | --- |
| `talmud-zeraim.json` | 1 | 125 | 1.3 MB |
| `talmud-moed.json` | 11 | 1,413 | 11.1 MB |
| `talmud-nashim.json` | 7 | 1,209 | 9.0 MB |
| `talmud-nezikin.json` | 8 | 1,362 | 10.8 MB |
| `talmud-kodashim.json` | 9 | 1,097 | 9.5 MB |
| `talmud-tahorot.json` | 1 | 143 | 1.4 MB |

37 tractates, 5,349 dafim, 81,481 paragraphs. Consumed by
`src/talmudImport.ts`, which is a dedicated fixed-schema importer and is
deliberately **not** routed through `src/importer.ts`'s format sniffer.

`links.json` holds **24,345** Talmud↔Tanakh citation links (1.9 MB), captured
during the same pass, covering all 37 tractates and 40 Tanakh books. **Nothing
consumes it yet** — the verse-citation feature that will is pinned in
`ROADMAP.md`, and scraping it alongside the text is far cheaper than a second
full pass later.

Note that `category === 'Tanakh'` alone is **not** a sufficient filter: Sefaria
shelves commentaries *on* Tanakh under the same category, and it admitted 49
rows pointing at Rabbi Sacks's *Lessons in Leadership* and *Steinsaltz
Introductions to Tanakh* on the first full scrape. Each link's `index_title` is
therefore also checked against the canonical Tanakh book list read from
Sefaria's own index.

The citation density is extremely uneven — Leviticus draws 6,357 links,
Obadiah 9 — which is the reason the pinned feature calls for small
footnote-style markers rather than a JFB-style systematic strip.

## Notes on the parse

- **Daf indexing.** Sefaria indexes a tractate's amudim from a notional daf 1,
  which no printed tractate has — the text always opens at 2a — so indices 0
  and 1 come back empty and every real amud sits at
  `(daf - 1) * 2 + (amud === 'b' ? 1 : 0)`. Verified against Berakhot, whose
  2a lands at index 2 and whose final 64a lands at index 126.
- **Markup is stripped.** Sefaria marks Steinsaltz's explanatory expansions
  with `<b>` and transliterated terms with `<i>`. `entries.text` is plain text
  everywhere in this app and no pane renders markup, so the tags are removed
  rather than shipped as literal angle brackets. That loses the
  literal/expansion distinction — a known limitation, recorded in
  `ROADMAP.md`, not papered over here.
- **Resumable.** Raw responses are cached under `raw/` (gitignored — ~64 MB of
  tractate JSON plus one file per daf of link data), so an interrupted scrape
  picks up where it stopped. The link pass is ~5,350 requests and takes a
  couple of hours; the text pass is 37 requests and takes about a minute.
- **Per-daf links.** The whole-tractate links ref reliably 504s on Sefaria's
  side, so links are fetched a daf at a time. A failed link fetch warns and
  continues rather than sinking the run — the data is not consumed yet, so an
  incomplete capture is not a build failure.
