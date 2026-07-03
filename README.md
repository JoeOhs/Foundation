# Foundation — Personal Bible Study App

A personal, single-user, fully offline desktop Bible study application. Built with Tauri (Rust + React + SQLite) as a replacement for legacy Bible study software.

## Features

- **Parallel view** — up to 4 translations side by side in synced, resizable columns. Scrolling one pane scrolls the others to the same verse; navigation moves all panes together.
- **Library downloader** — fetch additional public-domain Bible translations on demand from a hand-curated, license-checked list (`src/library.ts`). No account, no marketplace, no paid content — just a direct download into your local library.
- **Import pipeline** — bring in plain text, Markdown, JSON, CSV/TSV, or XML. Verse-keyed texts map onto book/chapter/verse; anything else is stored as page/section-anchored entries. Unparseable input degrades gracefully to a freeform document instead of failing. Legacy SQLite-based module files you own can be read as a one-time personal data migration.
- **Notes** — anchored to a verse, chapter, or book (shown across all translations), or free-floating. Stored locally in SQLite.
- **Dark mode** — first-class theming via CSS variables; follows the OS by default with a manual toggle.
- **Search** — SQLite FTS5 full-text search across all sources and notes, grouped by source, click-to-navigate.
- **Readability** — adjustable reader font size, serif reading font, layout/theme/reference persistence between sessions.

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
- `src/library.ts` — curated manifest of downloadable public-domain translations, shares `src/bibleJsonFormat.ts` conversion with the seeder.
- `src/components/` — Pane (reader column), NotesPanel, SearchPanel, ImportWizard, LibraryPanel.

### Data model

`sources` (a translation/commentary/reference work) → `books` (or a single synthetic container for freeform texts) → `entries` (verse-keyed via `chapter`/`verse`, or section-keyed via `position_ref`). `notes` anchor by canonical reference (`anchor_book`/`anchor_chapter`/`anchor_verse`) so a verse note appears in every translation, or by `entry_id` for imported non-canonical texts, or float free.
