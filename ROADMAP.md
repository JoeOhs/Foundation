# Roadmap

Foundation is a personal, open-source, non-commercial project. There's no
monetization plan and no pressure to ship on a schedule — this roadmap is a
running list of what's done and what's next, not a commitment.

## Done (v1)

- SQLite schema (`sources` / `books` / `entries` / `notes`) with FTS5 search.
- Single-pane reader with book/chapter navigation.
- Parallel view: up to 4 resizable, synced panes.
- Import pipeline: plain text, Markdown, JSON, CSV/TSV, XML, with forgiving
  fallback to a freeform document when structure can't be detected.
- One-time migration path for legacy SQLite-based module files the user
  already owns.
- Notes anchored to verse/chapter/book (shared across translations) or
  free-floating.
- Dark mode via CSS variables, OS-aware by default.
- Full-text search across all sources and notes.
- Font size controls, pane-layout/theme/reference persistence.
- Windows installers (MSI + NSIS) via `tauri build`.

## Current

- **Downloadable text library** — an in-app browser (`🌐 Library`) for
  fetching additional Bible translations directly from a hand-curated,
  license-checked manifest (`src/library.ts`). Each entry has been
  individually checked for public-domain status; this is *not* a module
  marketplace — no accounts, no paid content, no arbitrary user-submitted
  uploads.
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
- **Table of contents / section navigation for freeform texts.** Long
  imported works (commentaries, books) currently just scroll linearly;
  a collapsible list of `position_ref` section headings to jump to would fix
  that.
- **Per-source search filter**, so search can be scoped to one imported work
  instead of always searching everything.

## Longer-term / exploratory

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
