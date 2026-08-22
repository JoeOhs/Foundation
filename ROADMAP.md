# Roadmap

Foundation is a personal, open-source, non-commercial project. There's no
monetization plan and no pressure to ship on a schedule — this roadmap is a
running list of what's done and what's next, not a commitment.

## Done (v1)

- SQLite schema (`sources` / `books` / `entries` / `notes`) with FTS5 search.
- Single-pane reader with book/chapter navigation.
- Parallel view: up to 4 resizable, synced panes.
- Import pipeline: plain text, Markdown, JSON, CSV/TSV, XML, EPUB, with
  forgiving fallback to a freeform document when structure can't be
  detected. EPUB imports also capture the book's table of contents into a
  dedicated `toc_entries` table.
- One-time migration path for legacy SQLite-based module files the user
  already owns.
- **Dedicated imported-text panes.** Sources brought in via Import (EPUB
  and other freeform texts) get their own independently-scrolling pane —
  a static title + TOC dropdown instead of the translation/book/chapter
  selectors, always navigating locally, never joining a Bible sync group.
  Opened from a new "Imported texts" section in the Library, split out
  from the downloadable Bible-translation list; always pinned to the
  rightmost side of the panes window (`+ Pane` inserts new Bible panes
  before them, never after). Each imported source can be deleted from that
  same Library section — cascades to its highlights/notes/links and closes
  its pane if open.
- **Notes/Highlights/Links on imported texts.** Clicking a paragraph in an
  imported-text pane offers the same action bar as clicking a verse:
  highlight it, add it to a note, or bind it to another verse or section
  (any combination — verse↔verse, verse↔entry, entry↔entry). `highlights`
  and `links` anchor to either a canonical verse or a specific `entries`
  row; `notes` already had `entry_id` for this. The Highlights/Links tabs
  and the popped-out notes window all understand both anchor kinds.
- Notes anchored to verse/chapter/book (shared across translations), a
  section of an imported text, or free-floating.
- Dark mode via CSS variables, OS-aware by default.
- Full-text search across Bible translations and notes.
- Font size controls, pane-layout/theme/reference persistence.
- Windows installers (MSI + NSIS) via `tauri build`.

## Current

- **Downloadable text library** — an in-app browser (`🌐 Library`) for
  fetching additional Bible translations directly from a hand-curated,
  license-checked manifest (`src/library.ts`). Each entry has been
  individually checked for public-domain status; this is *not* a module
  marketplace — no accounts, no paid content, no arbitrary user-submitted
  uploads.
- **Categorised, searchable Library panel.** The panel was a flat list of
  every catalogue entry, which stopped scaling once the catalogue grew past
  a dozen Bibles plus commentaries, reference works and the user's own
  imports. It now groups by `sources.category` — Bibles, Commentaries,
  Reference works, Historical works, Imported — as collapsible sections,
  with **Bibles additionally split by language** (`English (9)`,
  `Arabic (1)`, …), since that's the category the project expects to grow
  most. A filter box at the top matches across every section on title *or*
  language, accepting either the name or the ISO code ("spanish", "es").
  Sections with more than three entries start collapsed so opening the
  Library doesn't dump the whole catalogue; filtering expands everything
  that matched. Catalogue entries and installed sources are merged by
  title into one row apiece, so a work never appears twice, and a
  **compound work is a single row** however many books it contains — its
  internal structure is reached through the pane's TOC dropdown, not by
  listing 31 Library rows. Install / reinstall-repair / delete behave
  exactly as before; this changed layout and grouping only.
  Schema: `sources.category` (`src/types.ts`'s `SourceCategory`) is
  deliberately *separate* from `sources.type` — `type` is behavioural
  (`type === 'bible'` drives pane roles, sync eligibility and search
  scoping via `src/sourceRoles.ts`) while `category` is organisational, and
  it carries distinctions `type` cannot: Josephus and an EPUB import must
  both be `type: 'extra-biblical'` to behave correctly, yet belong in
  different Library sections. `sources.language` already existed but had
  drifted — the seeder wrote ISO codes (`en`) while the Library manifest
  wrote display names (`English`), which would have split each language
  group in two. It's now canonically an ISO 639-1 code everywhere, with
  `src/language.ts` owning the code↔name mapping and a boot migration
  repairing existing rows.
- **Study footer with Smith's Bible Dictionary.** A height-adjustable strip
  under the reading panes (📚 Study; drag its top edge to resize,
  height/tab/open state persisted) for works consulted *about* the open
  text rather than read linearly. It spans only as far as the reading
  panes — the Concordance and Notes panels sit beside it at full height,
  never underneath it. Three tabs in the same fashion as
  Notes/Highlights/Links — **Dictionary**, **Commentary**, **Devotional** —
  with the wide shape used for a parallel layout: the headword list reads
  beside its article, not above it. The Dictionary tab is live, shipping
  **Smith's Bible Dictionary (1884)** as a bundled Library work (~4,600
  articles). The Commentary tab is live too (see below); Devotional remains
  a placeholder until footer-shaped content exists (the Companion Bible
  works keep their own panes).
  Lookup is a case-insensitive headword prefix query (`dictionaryLookup` in
  `src/db.ts` — the headword lives in `entries.position_ref`, one book per
  initial letter, so the dictionary reuses the standard
  `sources → books → entries` model with no new tables). Clicking a
  Strong's-tagged word while the footer is open feeds it the word in
  parallel with the concordance. Two new `SourceCategory` values,
  `dictionary` and `devotional`, both route "opening" a work to the footer
  instead of a pane; in the Library they file under the **Add-ons**
  section beside the Strong's add-on, not as category sections of their
  own — like Strong's, they augment study around the text rather than
  adding a pane work.
  **Provenance:** the text is the CrossWire SWORD "Smith" module —
  hand-transcribed, `DistributionLicense: Public Domain` — chosen over the
  archive.org page scans (e.g. `dictionaryofbwi01smit`), whose ABBYY OCR is
  heavily corrupted ("I'-gj^pt" for "Egypt") and covers only one volume of
  the four-volume unabridged edition. Built by
  `tools/smiths-dictionary/build.mjs` (standalone, run outside the app), which
  refuses any module not marked public domain and fails the build if any
  markup or fewer than ~4,000 entries survive parsing.
- **Footer commentary: Jamieson, Fausset & Brown (1871).** The study
  footer's Commentary tab, shipping **JFB** as a bundled Library work —
  19,442 verse-anchored comments across all 66 books. A new source *type*,
  `footer-commentary`, distinct from the `commentary` type the Companion
  Bible's notes use: both are verse-keyed, but the Companion Bible reads in
  its own pane while JFB is footer-only (`isFooterOnly` in
  `src/sourceRoles.ts` keeps it out of every pane's source picker). Both
  still file under the `commentary` *category* in the Library, which is
  organisational only — so `footerTabForSource` routes on type, not
  category, or the Companion Bible would be dragged into the footer.
  The tab is a horizontal strip of verse cells scoped to Pane 1's chapter,
  re-populating as you turn the page — read by scanning left-to-right in
  verse order, deliberately not the Dictionary tab's headword-beside-article
  shape. Hovering a verse in any reading pane marks and scrolls to its
  comment cell (and back again) through the existing `hoveredVerses`
  mechanism. **Clicking** a verse pins the strip to it: hover-follow alone
  isn't readable, because moving the mouse from a verse down to its comment
  drags the cursor across every verse in between, and each one scrolls the
  comment away before you reach it. A pin marks its cells, holds position,
  and suppresses hover entirely until released (✕ on the pin chip, or
  clearing the pane selection). A selection landing on no comment doesn't
  pin, so clicking an uncommented verse leaves the strip live rather than
  freezing it on nothing. A comment covering a verse range is **one** entries row —
  `entries.verse` holds the first verse covered, `entries.position_ref` the
  whole range ("5-6") in the notation `versesInRefRange()` already parses for
  Bullinger's Structure lines (moved to `src/scripture.ts` so both share it).
  `buildChapterIndex` builds the verse → comments index once per chapter
  load, not per hover. That index is what resolves **overlaps**: 2,713 verses
  carry more than one comment (JFB comments on 1 Chr 1:4-23 and again on
  1 Chr 1:12), and both are shown — the narrower nested inside the wider
  one's cell. One new nullable column, `entries.heading`, carries JFB's own
  section headings (1,275 of them, e.g. "Ge 2:2-7. The First Sabbath.")
  as the label above a cell; no new tables.
  **Provenance:** the CrossWire Bible Society's `jfb` OSIS module
  (`DistributionLicense: Public Domain`, derived from CCEL's transcription);
  all three authors died over a century ago. Built by `tools/jfb/build.mjs`
  (standalone, run outside the app), which refuses any module not marked
  public domain, parses the file as a flat milestone stream rather than a DOM
  tree (comments cross `<p>` boundaries — Genesis 2:1 spans three
  paragraphs), and fails loudly on any `osisID` it can't parse.
  **Excluded, deliberately:** both introductions, both of David Brown's
  chronological tables (Parables, Miracles), the per-book introductions and
  the OSIS header — none is verse-anchored, so none can be placed in a
  verse-keyed footer. Logged block by block to `tools/jfb/jfb-exclusions.txt`
  (571 blocks, ~708 KB), same audit-trail standard as the Josephus
  footnote-exclusion and ANF Vol. 10 precedents.
- **Open source** — MIT-licensed (see `LICENSE`). The license covers the app
  only; imported/downloaded texts keep their own license status.
- **KJV + Strong's numbers, with smart search.** An optional Library add-on
  (`🌐 Library → Add-ons → "KJV — add Strong's numbers"`) tags each word of
  the installed KJV with its original Hebrew/Greek Strong's number, sourced
  from the CrossWire KJV2003 OSIS module (word tagging) and the
  OpenScriptures Strong's Hebrew/Greek dictionaries (glosses) — see
  `src/strongsImport.ts` for provenance and licensing detail on both. Once
  installed, searching a word groups results by which original word it
  actually translates (e.g. "love" splits into agapē vs phileō vs chesed),
  each group showing a gloss, a verse list, and the specific occurrence
  highlighted inline — this is additive to the regular full-text search,
  which still runs and displays normally alongside it. In the reader,
  Strong's-tagged words render as individually clickable spans (click one to
  search every other occurrence of that same original word); words with no
  match (untranslated particles, or any non-KJV/non-tagged source) render
  exactly as before. A click looks the word up by its own Strong's
  number(s), not by its English text — going through the English surface
  ranked every original word sharing that rendering by frequency, so
  clicking "unto God" (H410) in Gen 35:1 led with H430 and reported a count
  that shifted with the tagged span rather than the word. Spans are located
  with punctuation folded (typographic apostrophes, en-dashes), which the
  source and the seeded text disagree on; that recovers ~2,700 otherwise
  unclickable tagged words. The ~2,000 spans still unmatched are a
  versification difference — the source puts those words in a neighbouring
  verse — and fall back to plain text, since verse text is never rebuilt
  from tags. Schema: `strongs_words` / `strongs_dict` in `src/db.ts`.
  The grouped view also docks as a **Concordance pane** (🔤) beside the Bible
  panes, scrolling in isolation, fed by word clicks when open — with the
  search modal as the lighter-weight default when it's closed, including an
  "Open in pane →" hand-off button and a total-occurrences count.
- **Translator's notes as footnotes.** The KJV's ~7,000 marginal notes
  (alternate readings, literal Hebrew/Greek renderings) are captured into
  `entry_notes` during the Strong's import and shown as small `°` markers
  with hover/click popovers — never inline in the verse text. This also
  fixed a seeding-era bug where those notes leaked into `entries.text`
  (braces stripped, note text kept); a one-time offline repair at boot
  restores the affected ~6,500 verses from the corrected seed conversion.
- **Themes + reader fonts.** Six CSS-variable themes (`src/themes.css`,
  spec in `docs/THEMES.md`) with per-theme gradient shells, and a curated set of
  system reader fonts — both in the 🎨 Appearance popover with live hover
  preview, alongside a text-size slider. **Texture system** implemented
  per docs/THEMES.md § "Texture & depth": shared SVG feTurbulence grain overlay
  on `body::after`, per-theme grain tuning (Obsidian brushed-metal lines,
  Midnight frosted-glass modals, Sunset heat-shimmer tint, Emerald edge
  vignette, Nova warm paper-grain shadows), Cosmic drift gated by
  `--texture-opacity`, and a global "Enhanced depth" toggle in the
  Appearance popover (`data-texture="off"` on `<html>`, persisted via
  `loadPref`/`savePref`). Auto-defaults to off when `prefers-reduced-motion`
  or `prefers-contrast: more` is set.
- **Highlighters.** Labeled, editable palette (`highlighters` table) applied
  to verses (`highlights`, one color per canonical verse, unique-indexed
  upsert) from the reader action bar. Highlights persist and render across
  translations as a translucent verse background; a Highlights tab in the
  Notes panel manages the palette and lists highlighted verses grouped by
  color with jump-to-verse and add-to-note. Works in the popped-out notes
  window via the same cross-window events.
- **Verse links (bindings).** Bind two verses across panes (`links` table:
  two canonical endpoints + optional `highlighter_id` for color). Bound
  verses render a dashed outline; a Links tab in the Notes panel lists
  bindings with both verses' text, Loose (delete), add-to-note, and an
  associate-highlighter swatch. Cross-window via `links:changed`.
- **Markdown notes workspace.** Notes are Markdown documents edited with a
  formatting toolbar + Write/Preview (`marked` + `DOMPurify`;
  `src/components/NoteEditor.tsx`). Shift+click selects verse ranges in the
  reader and inserts them as scripture blockquotes (`src/scripture.ts`).
  Import legacy notes from Markdown/text/RTF/HTML — converted to Markdown
  (`src/notesconvert.ts`) — and export to one Markdown file (Rust
  `write_file_text` command) through a picker
  (`src/components/NoteExportDialog.tsx`) that groups notes by anchor and
  starts fully selected, so exporting everything stays one click while any
  subset is a few checkboxes. The panel pops out into a second Tauri
  window (`?window=notes` → `src/NotesWindow.tsx`), sharing the database and
  staying live-synced over cross-window events (`src/notesbus.ts`).

## Near-term

- **Remote-fetched manifest.** The library list is currently bundled with the
  app (`LIBRARY_MANIFEST` in `src/library.ts`), so adding a translation means
  shipping a new build. Once the project has a public repo, move the
  manifest to a JSON file hosted there so the list can grow without an app
  update — still no server, no accounts, just a static file fetch.
- **More verified public-domain sources.** Seven added 2026-07-18 from
  scrollmapper/bible_databases (ASV, BSB, YLT, Darby, Douay-Rheims
  Challoner, Geneva 1599, JPS 1917 Tanakh — all individually
  license-checked; see `src/library.ts`). Still open:
  - *World English Bible* — canonical source is eBible.org, which
    distributes zipped USFX/OSIS rather than raw JSON; needs an unzip step
    in the importer plus adding `ebible.org` to the HTTP capability scope.
    (Prefer static dumps over bible-api.com, which is rate-limited and asks
    not to be bulk-scraped.)
  - *Commentaries* — CCEL hosts Matthew Henry (both the Concise and the
    full six-volume Commentary, explicitly marked public domain) and
    Jamieson-Fausset-Brown in HTML and SWORD-module form. The SWORD route
    is likely cleaner for verse-keyed import; CCEL's per-chapter HTML would
    map to the freeform importer's `position_ref` model with a scoped
    fetcher. Either way, manual license check per work before adding.
  - scrollmapper's `bible_databases_deuterocanonical` companion repo, if
    fuller Apocrypha coverage is ever wanted (DRC already carries its
    deuterocanon).
  - *Josephus — Complete Works* (William Whiston's 1737 translation, public
    domain) — **done**, and the first **compound work**: four separate
    Project Gutenberg texts (Wars 2850, Antiquities 2848, Life 2846,
    Against Apion 2849) combined into ONE `historical` source with 31 books
    and ~2,280 sections beneath it, rather than 27-odd Library entries.
    Josephus's own Book.Chapter.Section citation doesn't map to Bible
    book/chapter/verse, so it imports freeform and `position_ref`-anchored
    like an EPUB, opening in the dedicated pane with a three-level
    Work → Book → Chapter TOC dropdown. Each chapter is an `entries.chapter`
    purely as a loading unit, so the pane fetches one chapter at a time
    instead of all 2,280 sections — the same fix the Appendixes needed.
    Built by `tools/josephus/build.mjs` (standalone, run outside the app), which
    hard-fails on any edition whose Gutenberg header doesn't say
    `Translator: William Whiston` — the modern translations (Loeb, Feldman,
    Mason/Brill) are separately copyrighted and must never be substituted.
    Whiston's translator footnotes are **excluded, not captured**: three
    block formats are stripped, and inline markers — which the
    transcription fuses onto the preceding word (`Red Sea.4 Now`) — are
    removed only in that unambiguous fused form, never when a digit stands
    alone and might belong to Josephus (`Genesis 44:20`). They aren't
    captured into an `entry_notes`-style table because anchoring them would
    mean guessing which digits are markers, and a wrong guess rewrites the
    text; losing Whiston's commentary is the better trade. See
    `tools/josephus/README.md` and the header of `src/josephusImport.ts`.

    The generalisation this drove lives in `db.ts`, not in the Josephus
    importer: `insertTocEntries` used to hard-code `parsed.books[0]`, so a
    TOC could only cover a single-book source. It now resolves per book via
    `ParsedTocEntry.bookIndex`, batches its inserts, and accepts grouping
    rows (`entryIndex: -1`) that label their children without being
    jumpable — which is what makes an arbitrarily nested TOC possible.
    `toc_entries` gained a joined `book_name`, and `getEntryLocation`
    replaced `getEntryChapter`, because a compound work restarts chapter
    numbering in every book: a jump that set only the chapter would land in
    whichever book the pane happened to be showing. The Companion Bible
    commentary was already one source with many books, so it needs no
    change to adopt the same TOC treatment.
  - *Companion Bible Appendixes* (E.W. Bullinger, public domain) — all 198
    scraped and cleaned to Markdown by a standalone script
    (`tools/companion-bible-appendix/scrape.mjs`, run outside the app with
    `node scrape.mjs`; not part of `src-tauri` or the app runtime), then
    packaged and wired up as a bundled (no-network) Library entry: the
    JSON ships at `public/library/commentaries/companion-bible-appendixes.json`,
    `src/companionAppendixImport.ts` is its dedicated, fixed-schema
    importer (flattens the archival Markdown to the plain text every
    freeform entry already uses, builds one `entries` row per paragraph —
    6,800+ across the 198 appendixes, not one giant entry per appendix;
    same per-paragraph-entry fix as the EPUB importer's walkEpubBody, for
    the same reason: highlight/note/link/copy needs a paragraph-sized
    selection unit, not the whole appendix — plus a `toc_entries` row per
    appendix pointing at its first paragraph). Each appendix is also its
    own `entries.chapter` (1-198), not one giant `chapter: null` freeform
    book — the pane only loads the currently-viewed appendix's ~34
    paragraphs (`getEntries(source, book, chapter)`, same query a Bible
    chapter uses) instead of all 6,800+ at once, which was both a real
    performance cost and the "endless scroll" (fixed 2026-07-25). Jumping
    to an arbitrary entry (the TOC dropdown, a cross-reference, a
    Highlights/Links row) now goes through one shared `Pane.jumpToEntry`
    (exposed via `forwardRef`/`useImperativeHandle` so `App.tsx` can call
    it from outside): if the target isn't already on screen it looks up
    that entry's chapter (`getEntryChapter`) and switches to it first, then
    scrolls once the new chapter's entries land — `toc_entries` carries a
    `chapter` column now for exactly this. It shows up under a
    "Reference works" section in the Library panel (`src/library.ts`'s
    `BUNDLED_LIBRARY`, `src/components/LibraryPanel.tsx`, reinstallable
    like the Strong's add-on — "Reinstall / repair" clears the old copy,
    cascading to its highlights/notes/links, before installing fresh).
    Installs as `type: 'commentary'` (not `'reference'`) so it reads and
    files like Bullinger's actual notes on the text; installing it opens
    it straight into its own dedicated pane, pinned rightmost like any
    imported text, and it's excluded from the Library's "Imported texts"
    list (shown only once, under "Reference works", not duplicated). The
    Markdown flattener also converts the 54 appendixes that use tables
    into pipe-free "cell — cell" lines instead of leaking literal `|`
    characters (fixed 2026-07-25 — the original regex's `\s*$` was greedy
    enough to swallow the newline between adjacent table rows, collapsing
    them onto one line as well as leaving the pipes in). One appendix
    (#12, a long constellation-name list) has a single ~14k-character
    paragraph with no internal line breaks at all in the source scrape —
    a known outlier, not worth risky sentence-splitting heuristics to fix.
    Still open: rendering each appendix's `references` array (301
    cross-references captured structurally during scraping, currently
    unused after import)
    as clickable in-app jump links between appendixes.
- **Companion Bible verse-keyed marginal notes.** The marginal commentary
  itself (as opposed to the Appendixes above). Installs from the Library's
  "Reference works" section as a single `commentary` source containing one
  `books` row per transcribed book — **Philemon** so far, which was the
  proof-of-concept for the other 55. Two content shapes share it:
  - *Structure diagrams* — Bullinger's nested outlines, stored as **data**
    (one `entries` row per outline line) rather than as page images, so
    highlighting, binding and annotating work on an individual outline line
    through the existing `entry_id` anchor with no new schema for those three
    features. Schema: `structure_diagrams` / `structure_lines` /
    `structure_groups` / `structure_group_members` in `src/db.ts`. The
    scanned page is kept as a supplementary "View original page" link, which
    opens the archive's own page PDF in a pop-out window (`?window=refpage`,
    same pattern as the notes popout) where it can be scrolled and zoomed by
    the webview's built-in PDF viewer — the whole scanned chapter, not a
    cropped image. `tools/companion-bible-notes/build.mjs` copies the referenced
    PDF into `public/library/commentaries/companion-bible-notes/` so it ships offline. Never required: a diagram
    with no `[[pdf:]]` renders exactly the same, minus the link.
  - *Prose notes* — ordinary verse-keyed entries, no new table.

  Transcribed by hand from page scans via a small indentation-based notation
  and compiled by a standalone script (`tools/companion-bible-notes/build.mjs`, run
  outside the app with `node build.mjs`; notation documented in that
  directory's README). The parser rejects rather than guesses on ambiguous
  indentation, malformed verse ranges or unresolvable group references —
  a silent misparse of hand-transcribed content is worse than a crash.

  This is the first **verse-keyed non-Bible** source, which split the single
  `type !== 'bible'` test that used to mean two things at once into
  `isNavigable` / `isEntryAnchored` / `isDedicatedPane` in
  `src/sourceRoles.ts`: it navigates by book/chapter and joins a sync group
  like a translation, but its highlights/links/notes anchor to its own
  entries like an imported text. That anchoring is deliberate — `deleteSource`
  only removes entry-anchored rows, so verse-anchored commentary marks would
  outlive the source and show up on every translation.

  The commentary follows Pane 1's book/chapter like a translation, but is
  excluded from *scroll* sync in both directions (`scrollSyncable` in
  `src/App.tsx`): its content doesn't run parallel to the verse text — a
  Structure diagram is a block of outline lines with no verse numbers — so
  matching scroll offsets by verse only yanks a pane somewhere unrelated.

  In place of scroll sync, panes are tied together **on hover**: pointing at
  a note marks the verse it annotates in every other pane, and pointing at a
  verse marks its note — plus every outline line whose range covers it,
  since a Structure line spans a range rather than one verse
  (`versesInRefRange` in `src/components/Pane.tsx` parses Bullinger's "4-6",
  "18, 19-", "-19" forms). Shared through `hoveredVerses` in `src/App.tsx`,
  drawn as a left rule so it doesn't fight highlighter colours or the
  selection ring. This applies between any two panes, so parallel
  translations line up on hover as well.

  Bullinger's marginal notes are **complete for all 25 verses**, plus his
  four introductory notes, transcribed by cross-referencing the four
  renderings of the Internet Archive scan supplied under
  `tools/companion-bible-notes/` (page image, HOCR, PDF, EPUB — all from one OCR
  pass, so they fix reading order rather than character accuracy). The PDF's
  `-layout` output was primary, since it alone keeps the note column
  separate and in verse order. OCR damage to Bullinger's transliterated
  Greek was repaired, and two appendix cross-references were corrected
  against the appendix titles already bundled in
  `tools/companion-bible-appendix/` — Ap. 185 → 135 on *agapetos*, Ap. 182 → 132
  on *acknowledging*/*knowing*. The full correction policy, including what
  was deliberately left as-OCR'd, is in the header of `philemon.notes.txt`.

  **Bullinger's cross-references are clickable.** His notes are dense with
  them — 119 in Philemon alone — in two forms: scripture (`Eph. 3. 1`, where
  chapter and verse are separated by periods, and chains continue
  `; 4. 1` for a new chapter or `, 25` for another verse, so
  `Acts 12. 12, 25; 15. 37, 39` is four references) and appendixes
  (`Ap. 98. XII`). Bare `v. 22` resolves against the note's own book.
  `src/bullingerRefs.ts` finds them; `src/components/ReferenceText.tsx`
  renders them. Detection is render-time and **never rewrites the note** —
  the parser's segments concatenate back to `entries.text` exactly, the same
  contract `StrongsWords` keeps for a verse.

  Clicking a scripture reference drives group A, so it always lands in the
  main KJV pane. Clicking an appendix reference opens the Appendixes source,
  offering to install it first if it isn't present (it's bundled, so no
  network), and opening its pane if it isn't already showing. Appendix
  lookups go through the `toc_entries` row per appendix, so they're exact;
  the section within it (`XII`) is best-effort on top, matching a paragraph
  that opens with that label — 10 of Philemon's 39 section citations land
  exactly (including `Ap. 98. XII` → "XII. CHRIST JESUS."), and the rest fall
  back to the top of the appendix rather than guessing.

  **Adding a book is now a data task, not an engineering one.** The pipeline
  is per-book: transcribe, `node build.mjs --book=<slug>` to compile and
  validate that book alone, test it in the app, then `--all` to fold it into
  the single `public/library/commentaries/companion-bible-notes.json` that deploys with
  the app. The importer installs whatever books the bundle holds, so no code
  changes per book. The full workflow — source-selection, the staircase
  pitfall, the OCR correction policy, and the two automated verification
  gates (no invented text; every cross-reference parses) — is captured as the
  `companion-bible-book` skill in `.claude/skills/`.

  Still open:
  - The remaining 55 books.
  - Section-level appendix jumps only work where the appendix prints the
    section as its own paragraph label. Ap. 104 (Prepositions) numbers its
    entries differently, so its `iv`/`xv`/`xvii` citations open at the top.
  - Extraction is by hand. A future HOCR column-classification pass could
    draft the note column automatically; the notation and build script are
    ready for whatever produces the text, and the verification gates would
    still apply.
  - Bullinger's roman/italic distinction between the two halves of a
    correspondence pair isn't captured in `structure_lines.label`; it stays
    visible only via the scanned page.
- **Per-source search filter — DONE.** Full-text search now covers all
  installed sources (Bibles, commentaries, historical works, patristic
  volumes). Scope chips in the search modal let the user filter by
  category (Bibles, All sources, Commentaries, Reference, Historical,
  Church Fathers). Defaults to Bibles to keep common-word results
  manageable; "All sources" broadens to the full library. Strong's
  concordance grouping only appears for Bible-scoped searches.
- **Church Fathers — Ante-Nicene Fathers: COMPLETE (Vols. 1–9).**
  - Vol. 1 — Apostolic Fathers with Justin Martyr and Irenaeus (8 authors, 56 works, ~1,900 para)
  - Vol. 2 — Fathers of the Second Century: Hermas, Tatian, Athenagoras, Theophilus, Clement of Alexandria (5 authors, 18 works, ~2,980 para)
  - Vol. 3 — Latin Christianity: Its Founder, Tertullian (5 groups, 31 works, ~2,270 para)
  - Vol. 4 — Tertullian Part Fourth; Minucius Felix; Commodian; Origen (5 groups, 26 works, ~5,760 para)
  - Vol. 5 — Hippolytus, Cyprian, Caius, Novatian, Appendix (6 groups, 24 works, ~4,180 para)
  - Vol. 6 — Gregory Thaumaturgus, Dionysius, Julius Africanus, Anatolius, Minor Writers, Methodius, Arnobius (11 groups, 64 works, ~2,720 para)
  - Vol. 7 — Fathers of the Third and Fourth Centuries: Lactantius, Venantius, Victorinus, Dionysius, Apostolic Teaching, Constitutions, Liturgies (11 groups, 35 works, ~3,100 para)
  - Vol. 8 — Twelve Patriarchs, Clementina, Apocrypha, Decretals, Syriac Documents (9 groups, 119 works, ~6,490 para)
  - Vol. 9 — Recently Discovered Additions: Gospel of Peter, Diatessaron of Tatian, Apocalypse of Peter, and others (15 groups, 42 works, ~2,380 para)
  - Vol. 10 (General Index) intentionally omitted — it is a finding aid, not primary reading content; Foundation's search covers cross-volume lookup. A note in the Library panel explains the omission.

  Each installed from a bundled JSON built by `anf0N/build.mjs` from CCEL's
  public-domain ThML XML. Uses the compound-work + nested toc_entries pattern
  already built for Josephus: one `patristic` source per volume, one `books`
  row per work, Author → Work → Chapter TOC hierarchy that adapts to each
  work's actual structure. Roberts/Donaldson and Coxe footnotes are excluded,
  not captured — full exclusion to avoid partial leaking into entries.text.
  Filed in the Library under "Church Fathers" → "Ante-Nicene Fathers" (series
  sub-grouping).

- **Church Fathers — Nicene and Post-Nicene Fathers, Series I: COMPLETE (Vols. 1–14).**
  - Vol. 1 — Augustine: Prolegomena, Confessions, Letters (4 sections, 23 works, ~2,915 para)
  - Vol. 2 — Augustine: City of God, On Christian Doctrine (4 sections, 32 works, ~2,448 para)
  - Vol. 3 — Augustine: On the Holy Trinity, Doctrinal Treatises, Moral Treatises (4 sections, 18 works, ~1,580 para)
  - Vol. 4 — Augustine: Anti-Manichaean Writings, Anti-Donatist Writings (3 sections, 17 works, ~2,361 para)
  - Vol. 5 — Augustine: Anti-Pelagian Writings (18 sections, 54 works, ~2,464 para)
  - Vol. 6 — Augustine: Sermon on the Mount, Harmony of the Gospels, Homilies on the Gospels (4 sections, 11 works, ~1,955 para)
  - Vol. 7 — Augustine: Homilies on the Gospel of John, Homilies on the First Epistle of John, Soliloquies (3 sections, 5 works, ~1,652 para)
  - Vol. 8 — Augustine: Expositions on the Psalms (1 section, 3 works, ~2,940 para)
  - Vol. 9 — Chrysostom: On the Priesthood, Ascetic Treatises, Select Homilies and Letters, Homilies on the Statues (17 sections, 28 works, ~1,191 para)
  - Vol. 10 — Chrysostom: Homilies on the Gospel of St. Matthew (2 sections, 4 works, ~4,682 para)
  - Vol. 11 — Chrysostom: Homilies on the Acts of the Apostles and the Epistle to the Romans (5 sections, 7 works, ~1,437 para)
  - Vol. 12 — Chrysostom: Homilies on First and Second Corinthians (2 sections, 3 works, ~2,908 para)
  - Vol. 13 — Chrysostom: Homilies on Galatians through Philemon (4 sections, 14 works, ~3,373 para)
  - Vol. 14 — Chrysostom: Homilies on the Gospel of St. John, Homilies on Hebrews (3 sections, 7 works, ~3,892 para)

  Each installed from a bundled JSON built by `npnf1NN/build.mjs` from CCEL's
  public-domain ThML XML. Same compound-work + nested toc_entries pattern as
  Ante-Nicene Fathers: one `patristic` source per volume, Section → Work →
  Chapter TOC hierarchy adapted to each work's actual structure (Augustine's
  Confessions has Books with Chapters; Letters is a flat list). Schaff's
  editorial footnotes excluded. Filed in the Library under "Church Fathers" →
  "Nicene and Post-Nicene Fathers, Series I" (series sub-grouping).

  Vols. 5–8 needed a structural rule Vols. 1–4 did not. Those volumes mix
  treatises whose div2s are Books (holding div3 chapters) with works whose
  div2s *are* the chapters — Vol. 7's 125 Tractates on John, Vol. 6's 97
  Sermons, Vol. 8's 150 Psalm expositions. Vol. 2's one-work-per-div2 rule
  would have shattered those into dozens of one-chapter works, so
  `groupDiv2s()` decides by where the body text actually lives: mostly inside
  div3s means a Book container, mostly held directly by div2s means a flat
  run that becomes one work's chapters. The count of div3-bearing div2s is
  *not* a usable signal — four Psalms are internally subdivided (Psalm CXIX
  into its 22 acrostic stanzas), and those stay one chapter each with the
  stanza headings kept inline, so Vol. 8 lands as exactly 150 expositions,
  Psalm I–CL.

  The Chrysostom volumes (9–11) are a third structural shape, and a flatter
  one: there is no div3 anywhere in them. A div1 is a work and a div2 is a
  Book, Letter, Instruction or Homily holding its text directly, so the
  natural depth is Work → Homily rather than Augustine's Book → Chapter.
  `groupDiv2s()` lands on that unchanged, but the importer now drops the
  group header when a section holds exactly one work of its own name (Vol.
  11's 55 homilies on Acts), which would otherwise render the same title
  twice — once as a disabled header, once as the work beneath it — and push
  homilies a level deeper than they need.

  Vols. 12–14 kept the flat shape except Vol. 13, the one volume in the
  series with div3 throughout: its ten epistles are not ten div1s but three,
  matching the original three-part publication (Galatians+Ephesians;
  Philippians+Colossians+Thessalonians; Timothy+Titus+Philemon), with div2 an
  epistle and div3 a homily. `groupDiv2s()` reads that as a Book container
  and gives every epistle its own work, so all ten stay delineated.

  Where a homily's number lives is the thing that varied most, and
  `divTitle()` — applied at div2 and div3 alike, since which level holds a
  homily also varies — handles the three cases found:
  - **Vol. 10** puts the sequence in `shorttitle` ("Homily II") and the
    scripture in `title` ("Matthew I. 1.", repeated three times running).
  - **Vol. 14** leaves `shorttitle` empty and repeats `title` ("John 1.1"
    three times), so neither attribute distinguishes its homilies. The number
    comes from each homily's own opening paragraph ("Homily II.") — source
    text, not inference. 88 John homilies, zero duplicate titles after
    folding.
  - **Vols. 9, 11, 12** already carry both in `title`; **Vol. 13**'s 114
    scripture-range titles are distinct already, so folding there is about
    reading consistently beside the others, not rescuing ambiguity.

  Footnote conventions are likewise not uniform — three turned up across the
  series: `<note id n place>` (most volumes), `<note id n>` (Vol. 10) and
  `<note anchored id n place>` (Vol. 13). The strip is attribute-agnostic so
  none of it broke, but every volume was audited rather than assumed: in all
  fourteen `<note>` is the only apparatus element, every one is balanced,
  none nested, none self-closing, and all sit inside a `<p>` — which is why
  stripping must precede paragraph extraction.

  All 14 volumes now share **one importer generation**. The data-prep
  scripts had drifted into seven variants and the importers into three, so
  Vols 1–4 still showed doubled book names ("Editor's Preface — Editor's
  Preface") and sat a TOC level deeper than the collapse rule intends, and
  Vols 1–8 never got the label folding. Every `npnf1NN/build.mjs` and
  `src/npnf1NNImport.ts` is now byte-identical bar its own constants and
  provenance note (verified by hashing with ids and titles normalised away
  — a single hash across all fourteen). Rebuilding Vols 1–11 through it:

  - Vols 1–4 gain descriptive TOC titles. Their original builder preferred
    `shorttitle`, which CCEL uses for truncated labels, so the City of God
    read "Book I" / "Chapter 1" and now reads "Book I. Augustin censures the
    pagans…" / "Chapter 1. Of the Adversaries…".
  - Vol 1's Prolegomena collapses from four one-chapter works into one work
    of four chapters (23 works → 19).
  - Vols 2 and 4 drop their "Editor's Preface" group (13 paragraphs each).
    Their own skip lists always named it, but a broken character class meant
    the curly apostrophe never normalised. Vols 5–14 have excluded it all
    along; this makes 2 and 4 agree. Reversible by dropping
    `"editor's preface"` from `isSkippableDiv1`.
  - Duplicate chapter titles in Vols 5, 6 and 7 are resolved by folding.

  Note for any future re-import: `entries` carries FTS5 triggers, so a
  volume can only be rebuilt from inside the app (the Tauri SQL plugin has
  FTS5; a plain SQLite client does not). And the Library's reinstall path
  deletes the source row and inserts a new one, so it does **not** preserve
  `source_id` — any highlights, links or notes anchored to that volume are
  cascaded away with it. Harmless while a volume carries no user data, but
  it needs an in-place rebuild before re-importing anything a user has
  annotated.

- **Church Fathers — Nicene and Post-Nicene Fathers, Series II: COMPLETE
  (Vols. 1–14).** This volume set completes the whole Church Fathers
  collection: Ante-Nicene Fathers (9 volumes), NPNF Series I (14) and
  NPNF Series II (14) — **37 volumes**, all installed from bundled JSON
  with no network call at read time.
  - Vol. 1 — Eusebius: Church History, Life of Constantine the Great,
    Oration in Praise of Constantine (2 sections, 3 work groups, 32 works,
    674 chapters, 4,974 para)
  - Vol. 2 — Socrates, Sozomenus: Church Histories (2 sections, 22 works,
    511 chapters, 2,354 para)
  - Vol. 3 — Theodoret, Jerome and Gennadius, Rufinus and Jerome:
    Historical Writings (3 sections, 3 work groups, 39 works, 871
    chapters, 5,497 para)
  - Vol. 4 — Athanasius: Select Works and Letters (21 sections, 4 work
    groups, 59 works, 407 chapters, 4,309 para)
  - Vol. 5 — Gregory of Nyssa: Dogmatic Treatises, Select Writings and
    Letters (9 sections, 3 work groups, 32 works, 249 chapters, 1,607 para)
  - Vol. 6 — Jerome: The Principal Works of St. Jerome (4 sections, 15
    works, 211 chapters, 2,826 para)
  - Vol. 7 — Cyril of Jerusalem, Gregory Nazianzen (3 sections, 1 work
    group, 16 works, 152 chapters, 2,361 para)
  - Vol. 8 — Basil: Letters and Select Works (5 sections, 9 works, 420
    chapters, 2,394 para)
  - Vol. 9 — Hilary of Poitiers, John of Damascus (2 sections, 3 work
    groups, 13 works, 124 chapters, 1,716 para)
  - Vol. 10 — Ambrose: Select Works and Letters (3 sections, 5 work
    groups, 28 works, 354 chapters, 3,634 para)
  - Vol. 11 — Sulpitius Severus, Vincent of Lérins, John Cassian
    (3 sections, 8 work groups, 66 works, 1,149 chapters, 2,394 para)
  - Vol. 12 — Leo the Great, Gregory the Great Part I (2 sections, 2 work
    groups, 19 works, 562 chapters, 3,690 para)
  - Vol. 13 — Gregory the Great Part II, Ephraim Syrus, Aphrahat
    (2 sections, 1 work group, 19 works, 263 chapters, 3,249 para)
  - Vol. 14 — The Seven Ecumenical Councils (15 sections, 7 work groups,
    105 works, 694 chapters, 7,600 para)

  Same shape as the other two patristic series — one `patristic` source
  per volume, bundled JSON built from CCEL's public-domain ThML XML,
  editorial footnotes excluded — filed in the Library under "Church
  Fathers" → "Nicene and Post-Nicene Fathers, Series II". Series II is
  co-edited by Philip Schaff **and Henry Wace**, recorded distinctly from
  Series I's Schaff-only provenance.

  Three things Series I's unified importer could not do, added here and
  shared by all three volumes from `tools/npnf2/shared/thml.mjs` rather
  than copied per volume (the copying is what let Series I Vols. 1–8
  drift):
  - **Depth recursion.** Series I stopped at div3. Vols. 1 and 3 run to
    div4 — a div2 container holding div3 Books holding div4 chapters — so
    the container-vs-flat-run test is applied recursively instead of
    hard-coded to div2/div3. A container of containers emits a TOC *group*
    (Section → Group → Work → Chapter); Series I's walk would have
    collapsed each such Book into one undivided chapter and dropped 687
    div4 headings across the two volumes.
  - **Prefix label recovery.** Series I could read a sequence label from a
    `shorttitle` or from a leading paragraph that *was* the label ("Homily
    II."). Vol. 2's 487 chapters and Vol. 3's 342 carry neither: the
    number opens the first paragraph as a prefix ("Chapter II.—By what
    Means…"), which is now read as well.
  - **Sibling label-kind inference.** Theodoret's 182 letters lead with a
    bare "II. To the Same." after a first letter whose `shorttitle` reads
    "Letter I". Without the kind, dozens of them read "To the Same." and
    are indistinguishable in the TOC. The kind comes from whichever
    siblings do spell it out. A bare numeral is believed only where it
    behaves like a count of the run (greater than the last number, no
    greater than the position), which is what stops Jerome's "II. Jerome."
    — numbering his part of the volume — from renaming his first Life.

  Also new: a container division's own opening paragraphs are kept (Vol.
  1's Prolegomena opens with five before its first chapter); Series I
  dropped them. And the downloader is built on `node:https` with no body
  timeout — CCEL streams these chunked and slowly, and `fetch()` aborted
  every attempt at Vol. 1 (5.4 MB) at its 300s limit.

  Footnote convention audited per volume, not assumed: all three use
  `<note id,n,place>` — 8,677 notes, all balanced, none nested or
  self-closing. Series I had three different conventions across 14
  volumes, so the strip stays attribute-agnostic.

  Vol. 3's four works are not four peer div1s: the source gives three,
  splitting the middle one at div2 so Jerome's *Lives of Illustrious Men*
  and Gennadius's continuation sit one level below Theodoret and Rufinus.
  They still resolve to separate works, by the same rule that keeps Series
  I Vol. 11's Acts and Romans apart.

  Vols. 4–6 forced four more changes into the shared module, all of them
  found by treating each volume as its own discovery pass rather than as a
  repeat of a proven pattern. None of the four changes any run in
  Vols. 1–3, which rebuild byte-identically:
  - **Index skipping narrowed to apparatus naming.** The old rule matched
    the word "index" anywhere in a title and silently dropped Vol. 4's
    div2 *The Festal Letters, and their Index.* — fifty letters. It now
    matches only "Indexes", "Index of…", "General Index to…", which also
    keeps Vol. 4's div3 *Index.*, the ancient Festal Index and 49
    paragraphs of real text.
  - **Front matter no longer votes on run shape.** Even once kept, those
    fifty letters collapsed into two chapters: the editor's 564-paragraph
    introduction to them outweighed the letters in the container-vs-flat
    test. Front matter is split off by both branches anyway, so its bulk
    says nothing about how the body is shaped.
  - **"From Letter N.—" read as a label.** Vol. 4 prints the letters
    surviving only in excerpt that way; without it seven rows were titled
    by their year alone beside fifty siblings reading "Letter N."
  - **Repeated sibling titles qualified.** Vol. 6's twenty Vulgate
    prefaces are one flat list with an unmarked divider at position 15, so
    *Chronicles.* appears at 5 and again at 16. The structure is left as
    the source wrote it — inventing a level from a guess is worse than a
    longer title — and only the repeated row takes the divider's name.

  Vol. 5 is also the first volume whose footnotes do *not* use the
  `id,n,place` convention every other volume shares: all 2,272 carry
  `anchored,id,n,place`. The strip is attribute-agnostic and was
  unaffected, which is the point of auditing rather than assuming.

  Vols. 7–9 forced two more changes into the shared module, and again the
  discipline of auditing each volume rather than trusting the pattern is
  what found them. Neither changes any run in Vols. 1–6, which rebuild
  byte-identically:
  - **"Lecture" added as a sequence kind.** Cyril of Jerusalem's
    twenty-three Catechetical Lectures number themselves in their opening
    paragraph ("Lecture II.") and nowhere else — only "Lecture I" carries
    a `shorttitle` — so without the kind all twenty-three read as bare
    subjects in the TOC ("On Baptism.", "Of Faith.") with no number
    anywhere.
  - **A division with children is not a title page.** This was data loss
    on the scale of the Vol. 4 index bug. Vol. 9 files the *entire* Hilary
    of Poitiers half of the volume — Introduction, *De Synodis*, the
    twelve books of *De Trinitate*, the Homilies on the Psalms, 1,042
    paragraphs — inside a div1 whose `title` attribute is the bare string
    "Title Page", because the container is named after its own opening
    page. The old skip rule matched the title and dropped all of it, and
    nothing would have looked wrong: it would simply have been a John of
    Damascus volume with Hilary's name on the cover. Front-matter titles
    are now believed only of a division that holds no divisions (apparatus
    indexes, which really are containers, keep being skipped either way),
    and the section's name is read off its printed title page — "St.
    Hilary of Poitiers. Select Works.", the same *Author: Work.* form the
    sibling div1 spells out in its own attribute.

  Counts were checked against what each volume claims to hold rather than
  only against dangling TOC rows, which is the check that would have caught
  the Vol. 4 bug: Cyril's Procatechesis + Lectures I–XXIII (24), Gregory's
  25 select orations and 99 select letters, Basil's *De Spiritu Sancto*
  (30 chapters), the nine homilies of the Hexæmeron, all 366 numbered
  letters (in 356 rows — the source itself collapses three short groups of
  fragments into one division each), Hilary's twelve books of *De
  Trinitate* and three Psalm homilies, and John of Damascus's Exposition at
  14/30/29/27 chapters across its four books. Vol. 8's "Genealogical
  Tables" division is genuinely empty — a single scanned plate with no
  caption — and is dropped with nothing lost.

  Footnotes stayed on the majority convention for all three: `<note
  id,n,place>`, 10,836 notes, all balanced, none nested or self-closing,
  and every note of 60 characters or more searched for verbatim in the
  built text with zero matches.

  Vols. 10–14 close the series, and forced four more changes into the
  shared module. None changes any run in Vols. 1–9, which rebuild
  byte-identically:
  - **"Title Pages" is a title page.** Vols. 10 and 14 head their front
    matter with the plural, which the singular pattern missed, so both
    opened with a section of publisher's boilerplate.
  - **A container's own text is its own paragraphs.** `extractParagraphs`
    falls back to the bare text of a division carrying no `<p>` at all,
    which is right for a leaf and wrong for a container: the only thing
    between a container's opening tag and its first child is the printed
    heading. Vols. 10 and 11 hit the fallback sixty-eight times between
    them, every one a heading restating the division's own title, and
    Ambrose's *De Officiis* Book I came out with 51 chapters against the
    source's 50 and *De Mysteriis* with 11 against its 9.
  - **A section's own opening paragraphs are kept.** This batch's silent
    loss, though a small one. `resolveRun` is handed a div1's children and
    never sees what the div1 holds itself, so Vol. 10's two opening
    paragraphs were read by nothing — the editor's *Note on the Letters of
    St. Ambrose*, which is exactly the note the reader needs there: it
    says the sixteen letters printed are a selection out of the ninety-one
    the Benedictine editors count genuine.
  - **Repeated work titles qualified.** The chapter-level repair of Vols.
    4–6, applied to the works of a section. Vol. 14 prints a council's
    documents in the order the acts were read, so the extracts resume
    under an unchanged heading after each document quoted in full, giving
    Ephesus two works titled *Extracts from the Acts. Session I.
    (Continued).* and Chalcedon two of *…Session II. (Continued).*

  **Vol. 14 is a different kind of book** — canons and conciliar decrees,
  not authored prose — and was treated as a fresh discovery pass on the
  assumption that none of the chapter/homily/letter handling would apply.
  It needed no new depth model. The source lays it out as div1 = a council
  or a collection of local synods, div2 = one of its documents (a creed, a
  letter, an excursus, a session's extracts, or its collection of canons),
  div3 = a single canon with its notes — which is the same Section → Work
  → Chapter shape the other thirteen use, with the council in the slot an
  author takes elsewhere. Forcing a Council → Canon model on it would have
  flattened away the sessions, letters and definitions that sit beside the
  canons. Eleven of its thirteen council and synod sections read as
  container runs on the existing vote; the Fifth and Sixth Councils
  enacted no canons, so they have no subdivided document, read as flat
  runs, and their documents become chapters of one work. Same rule,
  different data.

  Counts were again checked against what each volume claims rather than
  only against dangling TOC rows. Every canon collection in Vol. 14 was
  verified canon by canon against the documented total — Nicaea I 20,
  Constantinople I 7, Ephesus 8, Chalcedon 30, Trullo 102, Nicaea II 22,
  Ancyra 25, Neocæsarea 15, Gangra 20, Antioch 25, Laodicea 60, Sardica
  20, Carthage 138 — each numbered I–N with no gaps or repeats. Leo's 173
  letters reconcile exactly across 167 rows, the source itself printing
  three ranges as one row each. Elsewhere: Ambrose's *De Officiis* at
  50/30/22 chapters, *De Mysteriis* at 9 and *Concerning Widows* at 15;
  Vincent's 33 chapters and three appendices; Cassian's twelve Books, 24
  Conferences and seven Books on the Incarnation; Gregory's Register Books
  I–VIII in Vol. 12 continuing as IX–XIV in Vol. 13; and Ephraim's hymn
  sets, whose own titles count them (19 on the Nativity, 15 for the
  Epiphany, seven in *The Pearl*, three Homilies).

  Four apparent shortfalls turned out to be the source's own and are
  recorded rather than repaired. Cassian's Institutes Book VI and
  Conferences XII and XXII hold one paragraph each, because the translator
  declined to render them ("We have thought best to omit altogether the
  translation of this book"). Leo's 48 sermons are a numbered selection
  out of 96. Chalcedon's canons run I–XXVIII, XXX, XXXI — the print
  edition skips the number XXIX under a heading calling the set "The XXX
  Canons". And Ephraim's Nisibene section has 47 divisions of which two
  are the editor's bracketed notes on hymns wanting, so it prints 45
  hymns where Gwynn's preface says forty-six; every division in the file
  is in the bundle and no hymn heading hides inside a sibling.

  Footnote conventions were audited per volume rather than assumed, and
  the batch splits: Vols. 10, 13 and 14 use `<note id,n,place>`, Vols. 11
  and 12 use `<note id,n>`. 10,077 notes across the five, all balanced,
  none nested or self-closing, and every note of 60 characters or more
  searched for verbatim in the built text with zero matches.

## Longer-term / exploratory

- **Additional Bible translations in more languages.** The Library ships
  four languages today (English, Arabic, Russian, Chinese) and the intent is
  to keep widening that. The groundwork is done rather than the work itself:
  `sources.language` is now canonically an ISO 639-1 code with `language.ts`
  owning the code↔name mapping, and the Library panel already groups Bibles
  into collapsible per-language sections and filters on language — so adding
  a translation is a manifest entry, not a UI change.
  Which languages and which translations remains an open, ongoing list
  rather than a fixed scope: every candidate needs its own public-domain
  check per edition (modern revisions are frequently still in copyright even
  where an older translation in the same language is free), and that check
  is the actual work. In keeping with the note at the top of this file,
  nothing here is a commitment to a particular language or timeline.
- Original-language (Greek/Hebrew) tooling — explicitly out of scope for v1,
  may be worth revisiting once the core reading/study experience is solid.
- A defined, versioned import/export format for notes and freeform texts, so
  personal data can move between installs without going through SQLite
  directly.
- macOS/Linux packaging (currently only built/tested on Windows).
- Accessibility pass (keyboard navigation throughout, screen-reader labeling).

## Explicit non-goals (unchanged from v1)

- No cloud sync or multi-device support — single desktop, single user.
- No telemetry.
- No marketplace, no paid/premium content, no license-key flows. The Library
  downloader is a curated list of free public-domain texts, not a store.
- No arbitrary user-submitted module uploads without manual license review.
