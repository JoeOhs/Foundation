# Foundation — Personal Bible Study App

A personal, single-user, fully offline desktop Bible study application. Built with Tauri (Rust + React + SQLite) as a replacement for legacy Bible study software.

## Features

- **Parallel view** — up to 4 translations side by side in synced, resizable columns. Pane 1 is the navigation controller: its book/chapter selectors lead sync group A, and notes always anchor to its location. The toolbar 🔗 Sync menu assigns every other pane to **Synced** (follow Pane 1), **Group B** (a second sync combination with its own leader — available from 3 panes up), or **Solo** (fully independent). Scroll-sync operates within each group; group assignments persist with the layout.
- **Library downloader** — fetch additional public-domain Bible translations on demand from a hand-curated, license-checked list (`src/library.ts`): ASV, Berean Standard Bible, Young's Literal, Darby, Douay-Rheims (with deuterocanon), Geneva 1599, JPS 1917 Tanakh, and several non-English classics. No account, no marketplace, no paid content — just a direct download into your local library.
- **Import pipeline** — bring in plain text, Markdown, JSON, CSV/TSV, or XML. Verse-keyed texts map onto book/chapter/verse; anything else is stored as page/section-anchored entries. Unparseable input degrades gracefully to a freeform document instead of failing. Legacy SQLite-based module files you own can be read as a one-time personal data migration.
- **Highlighters** — label your own colored highlighters and apply them to verses (single or shift+click ranges) from the reader action bar; highlights persist, show across every translation, and are managed in a Highlights tab in the Notes panel that lists them grouped by color with jump-to-verse and add-to-note. Palette is fully editable (rename/recolor/add/delete).
- **Links** — "Bind" two verses together across panes (select one, 🔗 Link, select another, Bind). Bound verses show a dashed outline; a Links tab lists every binding with both verses, "Loose" to remove, add-to-note, and an optional highlighter-color association. Works across translations and in the popped-out window.
- **Notes** — a Markdown study workspace. Anchor a note to a verse, chapter, or book (shown across all translations), or leave it freeform. Pin notes (📌) to keep them at the top of the list; a pinned tutorial note ships on first run. Notes are written and rendered as Markdown (formatting toolbar with Write/Preview); select verses in the reader (shift+click for a range) and drop them into the open note as a formatted scripture blockquote. Import legacy notes from Markdown, plain text, RTF, or HTML (converted to Markdown on the way in) and export everything back out to a single Markdown file. The notes panel can pop out into its own window for a second monitor or side-by-side layout, staying live-synced with the main window over the shared database. Stored locally in SQLite.
- **Themes** — six visual themes (Obsidian, Midnight, Cosmic, Sunset, Emerald, Nova) with per-theme gradient shells and accent systems, defined in [THEMES.md](THEMES.md) and implemented as a CSS-variable registry (`src/themes.css`). OS-aware default (Obsidian on dark systems, Nova on light), instant switching with live hover preview from the 🎨 picker, reading panes always flat for protected text contrast (verified ≥12:1 on every theme), and motion respects `prefers-reduced-motion`.
- **Search** — SQLite FTS5 full-text search across all sources and notes, grouped by source, click-to-navigate.
- **Smart search (KJV + Strong's numbers)** — an optional Library add-on tags the KJV with Strong's numbers; once installed, searching a word groups results by the original Hebrew/Greek word it actually translates (e.g. "love" splits into agapē vs phileō vs chesed), each group showing a gloss and its verse list with the matched word highlighted inline, plus a total occurrence count. Additive — regular full-text search always still runs alongside it. Tagged words in the reader are individually clickable to look up every other occurrence of that same original word.
- **Concordance pane** — the grouped Strong's view is also available as a docked side pane (🔤 in the toolbar) that scrolls independently of the Bible panes, for longer study sessions. With the pane open, clicking a tagged word updates it in place; with it closed, word clicks open the search modal, which has an "Open in pane →" button to promote the lookup. Verse clicks in the pane navigate the reader without closing it.
- **Readability** — adjustable reader font size and a curated reader-font choice (Georgia, Palatino, Cambria, Constantia, Segoe UI, Verdana — system font stacks only, nothing bundled or licensed), with layout/theme/font/reference persistence between sessions.

Seeded with two public-domain translations: King James Version and Bible in Basic English (`public/seed/`). More are available in-app via **Library**.

## License

Foundation's source code is MIT-licensed — see [LICENSE](LICENSE). This is a personal, non-commercial project; there's no intent to monetize it, and contributions are welcome.

The MIT license covers the app itself, not the texts you load into it. Bible translations and other texts you import or download keep whatever license or public-domain status they already have — check the license note shown for each source. The bundled seed and the in-app Library only include translations that have been individually verified as public domain; see `src/library.ts` for the reasoning behind each entry.

See [ROADMAP.md](ROADMAP.md) for planned work.

## Development

Prerequisites: Node 20+, Rust (stable, MSVC toolchain on Windows).

```
npm install
npm run tauri dev     # run the desktop app in dev mode
npm run tauri build   # produce a distributable build
```

## Architecture

- `src-tauri/` — thin Rust shell: tauri-plugin-sql (SQLite), tauri-plugin-dialog, plus `read_file_text` / `read_file_base64` commands for the importer.
- `src/db.ts` — schema, migrations (FTS5 with LIKE fallback), and all queries. The database lives in the app config directory as `foundation.db`.
- `src/importer.ts` — format sniffing and forgiving parsers for each import format.
- `src/seed.ts` — first-run install of the bundled translations.
- `src/library.ts` — curated manifest of downloadable public-domain translations, shares `src/bibleJsonFormat.ts` conversion with the seeder; also defines the Library's add-ons (currently just KJV + Strong's numbers).
- `src/strongsImport.ts` — dedicated one-time importer for the KJV+Strong's OSIS file and the OpenScriptures dictionaries (not part of the general `importer.ts` sniffing pipeline — this is a fixed, known format). Idempotent: safe to re-run, clears previous Strong's data for the KJV first.
- `src/components/` — Pane (reader column), NotesPanel, SearchPanel, ImportWizard, LibraryPanel, StrongsWords (shared word-tagging/highlighting renderer used by both Pane and SearchPanel).

### Data model

`sources` (a translation/commentary/reference work) → `books` (or a single synthetic container for freeform texts) → `entries` (verse-keyed via `chapter`/`verse`, or section-keyed via `position_ref`). `notes` anchor by canonical reference (`anchor_book`/`anchor_chapter`/`anchor_verse`) so a verse note appears in every translation, or by `entry_id` for imported non-canonical texts, or float free.

`strongs_words` tags individual words of an `entries` row with a Strong's number (`entry_id`, `word_index`, `surface_text`, `strongs_number` — one row per tagged word; a word can have more than one number, sharing the same `word_index`). `strongs_dict` holds the lemma/transliteration/gloss for each number. Rendering never reconstructs verse text from `strongs_words` alone — the KJV OSIS source has ~21k translator-supplied words with no Strong's tag at all, so doing that would silently drop words. Instead, tagged spans are aligned onto the existing `entries.text` (see `alignWordsToText` in `src/components/StrongsWords.tsx`), so the visible reading is always exactly the entry text, just partitioned into clickable/highlightable spans plus plain filler wherever a slot can't be matched.

`entry_notes` holds translator's notes (alternate readings, literal Hebrew/Greek renderings) captured from OSIS `<note>` elements during the Strong's import — same additive principle as `strongs_words`: the importer only ever INSERTs into its own tables and never writes `entries.text`. Notes anchor after a tagged word via `word_index` (NULL = verse-level) and render as small `°` footnote markers with a hover/click popover. A historical caveat lives in `src/bibleJsonFormat.ts`: the seed JSON overloads `{braces}` for both supplied words (`{was}` — keep) and inline notes (`{firmament: Heb. expansion}` — drop), distinguished by the colon; early builds leaked the note text into `entries.text`, which a one-time boot repair (`repairSeededTextsIfNeeded` in `src/seed.ts`, gated by a `meta` flag) corrects offline from the bundled seed.
