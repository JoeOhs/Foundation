# Foundation — Engineering Standards

Foundation is a personal, single-user, fully offline Bible study app
(Tauri + React + SQLite). It collects no data, makes no money, and only
ever ships public-domain or explicitly license-checked texts. Every change
should protect that, not just "work."

## Before finishing any task

1. Run `npm run tauri build` (or at minimum `tsc --noEmit` for a fast pass)
   — must be clean, no new errors or warnings.
2. Run the project lint config if one is present — zero new warnings.
3. Re-read the diff you just produced, line by line, as if reviewing a
   stranger's PR. Look specifically for:
   - dead code, commented-out blocks, or debug `console.log`s left behind
   - duplicated logic that belongs in a shared helper
     (check `src/components/` for an existing one first — e.g.
     `StrongsWords.tsx` is already shared between `Pane` and `SearchPanel`)
   - functions doing more than one job
   - missing error handling on file I/O, SQLite calls, or network fetches
     to the Library manifest
   - anything that could silently drop or mutate user data
4. Confirm any touched SQLite query still matches the schema described in
   `src/db.ts` and the "Data model" section of README.md.

## Non-negotiable architecture rules

- **Additive-only importers.** `strongsImport.ts`, and any future importer
  in the same family, must only `INSERT` into their own tables
  (`strongs_words`, `strongs_dict`, `entry_notes`, etc.) and must never
  rewrite or reconstruct `entries.text`. This project already shipped that
  bug once (see the `{braces}` note-leak repair in `src/seed.ts`) — treat
  any code path that writes to `entries.text` outside the seeder/importer
  as a red flag worth stopping and asking about.
- **No reconstruction of verse text from tags.** Rendering must always
  align tagged spans onto the existing `entries.text`
  (`alignWordsToText` pattern), never regenerate text from
  `strongs_words` alone — translator-supplied words with no Strong's tag
  would silently vanish otherwise.
- **No network calls** except the Library downloader hitting its
  fixed, license-checked manifest domains (`src/library.ts`). No telemetry,
  no analytics, no crash reporting, no arbitrary outbound requests.
- **No accounts, no marketplace, no paid/premium content, no license-key
  flows.** If a change starts to look like it needs any of these, stop and
  flag it — it's an explicit non-goal (see ROADMAP.md).
- **No arbitrary user-submitted content** goes into the Library manifest
  or seed without a manual, documented public-domain check.
- New data or features should map onto the existing
  `sources → books → entries` (+ `notes`, `strongs_words`, `strongs_dict`,
  `entry_notes`) model. Don't invent a parallel storage path for something
  that fits the existing schema.

## Code organization

- Shared rendering/interaction logic (e.g. word tagging, highlighting)
  belongs in `src/components/` as a reusable component, not copy-pasted
  across `Pane` and `SearchPanel`.
- Format-sniffing and parsing belongs in `src/importer.ts`; format-specific,
  fixed-schema importers (like Strong's/OSIS) get their own dedicated file
  and are explicitly *not* routed through the general sniffer.
- Schema and query logic stays centralized in `src/db.ts`.
- Keep the Rust shell (`src-tauri/`) thin — plugin wiring and the
  `read_file_text` / `read_file_base64` commands only. Business logic lives
  in TypeScript.

## After verifying, before declaring a task done

- If the change affects "Current" or "Near-term" scope, update
  `ROADMAP.md` to match reality.
- Leave no `TODO`/`FIXME` comment without a corresponding `ROADMAP.md`
  entry — an orphaned TODO is a bug that hasn't been triaged yet.
- Summarize what was verified (build/lint/manual trace), not just what was
  changed.
