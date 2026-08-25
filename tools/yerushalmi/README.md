# Yerushalmi builder

Standalone data-prep for the **Jerusalem Talmud** (Talmud Yerushalmi) in
Heinrich W. Guggenheimer's English translation, published in 17 volumes by
Walter de Gruyter (Berlin, 1999–2015) and digitised and published by
[Sefaria](https://www.sefaria.org/).

Sibling of `tools/talmud/`, which does the same job for the Bavli. Run
manually, outside the app. The app itself never talks to Sefaria: it reads the
bundle this script writes into `public/library/rabbinic/yerushalmi.json`.

```bash
node build.mjs
```

| flag | effect |
| --- | --- |
| *(none)* | download (or reuse the `raw/` cache) and build |
| `--refetch` | ignore the cache and re-download |

Output: one bundle, 7.3MB — 39 tractates, 2,204 halakhot, 12,243 paragraphs
across five Sedarim.

## Licence — not a second exception

Guggenheimer's translation is **CC BY**: free to share and adapt, including
commercially, so long as the translator is credited. That is *looser* than the
Bavli's CC BY-NC 4.0, so this text does not extend the Library's one
non-commercial exception — attribution-only terms are ordinary here. It is
still not public domain, so the attribution travels with the source into
`sources.license_note` and is surfaced in the Library panel via
`SERIES_NOTES['Jerusalem Talmud']`.

Verified against Sefaria's own published corpus: all 39 tractate files carry
`"license": "CC-BY"` and the Guggenheimer `versionTitle`. `assertLicense()`
re-checks both on every build and **hard-fails** on either a different licence
token or a different edition, so an upstream change breaks the build rather
than shipping silently.

## Why this edition

Sefaria hosts two English versions of the Yerushalmi. Completeness was
measured tractate-by-tractate rather than assumed, because the *other* one has
the looser licence and would have won on terms alone:

| version | licence | coverage |
| --- | --- | --- |
| Guggenheimer | CC-BY | **39 of 39 tractates**, 12,243 segments (2 empty in the whole corpus) |
| Sefaria Community Translation | CC0 | 20 tractates, 116 segments — **0.9%** of the corpus |

The Community Translation is a crowd-filled placeholder, not an edition. The
only public-domain English Yerushalmi (Moses Schwab, 1886) covers Berakhot
alone — 1 of 39 tractates — so it is not viable as a Library source either.
Completeness decided this the same way it decided the Bavli.

## Structure

The Yerushalmi has no standard pagination, so it is cited **chapter:halakhah**
(`"Berakhot 1:1"`), not daf/amud. Sefaria's text array for it is three levels
deep (Chapter → Halakhah → Segment) against the Bavli's two, and is plainly
1-indexed — none of the notional-daf-1 offset `tools/talmud/build.mjs`'s
`dafLabel()` exists to correct. Verified against Berakhot (9 chapters),
Shabbat (24) and Niddah (4), all three matching the printed tractate.

Only five Sedarim appear because only five have Yerushalmi: Kodashim has none
at all, and Tahorot survives only as Niddah. The canonical tractate order has
to be pinned in `SEDARIM` because Sefaria's export carries none; `main()`
cross-checks that pinned list against what Sefaria actually publishes, so a
tractate renamed or added upstream fails the build instead of being silently
dropped or misshelved.

## Fetch path

Sefaria's own published export bucket
([Sefaria-Export](https://github.com/Sefaria/Sefaria-Export)) rather than their
live API. It carries the same per-version metadata the licence guard would
read off an API response (`license`, `versionTitle`, `versionSource`), needs no
key or rate-limit backoff, and is one request per tractate rather than one per
section.

## Known limitation — the footnotes

Guggenheimer's edition is a translation *and commentary*, and Sefaria splices
the commentary into the middle of the translated sentence as footnotes:
roughly a third of the characters. The build strips them. Inlining them would
weld a note into the sentence it interrupts — the same note-leak that had to
be repaired out of `entries.text` once already (the `{braces}` repair in
`src/seed.ts`). Restoring them belongs in an additive `entry_notes` path,
pinned in `ROADMAP.md`, not in `entries.text`.

`stripFootnotes()` walks `<i>` nesting depth rather than matching a regex,
because footnote bodies contain nested `<i>` tags (cited book abbreviations)
and a non-greedy `.*?</i>` stops at the first inner close — which is exactly
what the first cut of this builder shipped, leaking ~3.7MB of note text into
the reading column before the importer's verification pass caught it.

Note also that Guggenheimer uses bare angle brackets as an editorial
convention for supplied text (`<and were there until this day.>`). Those are
content and are preserved, which is why the tag strip after entity decoding is
a closed whitelist of HTML tag names rather than a general `<[^>]+>` pass.
