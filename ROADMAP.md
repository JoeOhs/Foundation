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
  articles); Commentary and Devotional are placeholders until footer-shaped
  content exists (the Companion Bible works keep their own panes).
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
  `smiths-dictionary/build.mjs` (standalone, run outside the app), which
  refuses any module not marked public domain and fails the build if any
  markup or fewer than ~4,000 entries survive parsing.
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
  exactly as before. Schema: `strongs_words` / `strongs_dict` in `src/db.ts`.
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
  spec in `THEMES.md`) with per-theme gradient shells, and a curated set of
  system reader fonts — both in the 🎨 Appearance popover with live hover
  preview, alongside a text-size slider.
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
  (`src/notesconvert.ts`) — and export all notes to one Markdown file
  (Rust `write_file_text` command). The panel pops out into a second Tauri
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
    Built by `josephus/build.mjs` (standalone, run outside the app), which
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
    `josephus/README.md` and the header of `src/josephusImport.ts`.

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
    (`companion-bible-appendix/scrape.mjs`, run outside the app with
    `node scrape.mjs`; not part of `src-tauri` or the app runtime), then
    packaged and wired up as a bundled (no-network) Library entry: the
    JSON ships at `public/library/companion-bible-appendixes.json`,
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
    cropped image. `companion-bible-notes/build.mjs` copies the referenced
    PDF into `public/library/` so it ships offline. Never required: a diagram
    with no `[[pdf:]]` renders exactly the same, minus the link.
  - *Prose notes* — ordinary verse-keyed entries, no new table.

  Transcribed by hand from page scans via a small indentation-based notation
  and compiled by a standalone script (`companion-bible-notes/build.mjs`, run
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
  `companion-bible-notes/` (page image, HOCR, PDF, EPUB — all from one OCR
  pass, so they fix reading order rather than character accuracy). The PDF's
  `-layout` output was primary, since it alone keeps the note column
  separate and in verse order. OCR damage to Bullinger's transliterated
  Greek was repaired, and two appendix cross-references were corrected
  against the appendix titles already bundled in
  `companion-bible-appendix/` — Ap. 185 → 135 on *agapetos*, Ap. 182 → 132
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
  the single `public/library/companion-bible-notes.json` that deploys with
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
  - Search deliberately still excludes this source: full-text search remains
    scoped to `sources.type = 'bible'`, so neither the outline lines nor the
    prose notes are searchable yet. Widening it is bundled with the
    per-source search filter below.
  - Bullinger's roman/italic distinction between the two halves of a
    correspondence pair isn't captured in `structure_lines.label`; it stays
    visible only via the scanned page.
- **Per-source search filter**, so search can be scoped to one imported work
  (full-text search is currently Bible-only — see Done above).
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

- **Church Fathers — Nicene and Post-Nicene Fathers (Series I and II).**
  28 volumes total (14 per series). Not yet started — the next open stage
  of the Church Fathers collection. Same `patristic` category, separate
  series sub-groups ("Nicene and Post-Nicene Fathers, Series I" / "Series II").

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
