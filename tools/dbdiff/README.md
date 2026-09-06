# dbdiff — before/after database check for a Library install

Compares a Foundation database backup against the live one, to confirm an
install **added** rows without mutating anything that was already there.
Written for the shipping discipline this project applies to every Library
work (the Talmud and Luther briefs both call for it); it is a development
aid and not part of the Tauri app runtime.

```
node tools/dbdiff/dbdiff.mjs "<backup.db>" "<live.db>" [--expect-changed "Foxe,..."]
```

Read-only: both files are loaded into memory and neither is written to. Uses
the `sql.js` already in `node_modules`, so there is nothing to install.

Each path is checked before anything is opened, and the three ways it can be
wrong are reported distinctly: a directory (easy to pass by mistake, since the
folder and the file differ by one path segment), a file that is missing or
unreadable, and — when a backup is missing — a listing of the `*.backup-*`
files that do exist beside it, or a plain statement that there are none.

On Windows the live database is at
`%APPDATA%\com.foundation.biblestudy\foundation.db`.

## `--expect-changed`

Installing a source is a delete-and-reinsert, so a source you deliberately
**reinstalled** legitimately has different rows — new ids, and whatever the
importer now writes. List those titles here (case-insensitive substring
match) and they are reported as expected rather than raised as alarms.
Anything *not* listed that changed is the thing worth investigating.

This matters more than it sounds: without it the tool cries wolf on every
deliberate reinstall, and a check that always warns is a check nobody reads.

## What it reports

1. **Row counts** per table, backup → live, showing only what moved.
2. **Sources** added, removed, or reinstalled (same title, new id). Adding is
   always benign — it is what an install does. A source that **disappeared**,
   or was **deleted and reinserted** under a new id, fails the run unless you
   named it in `--expect-changed`: those are exactly the damage this tool
   exists to catch, and narrating them neutrally while still printing OK would
   be worse than not checking.
3. **Pre-existing entries mutated?** — the check that matters. For every
   source present in both with the same id, entry rows are compared
   field-by-field: `book_id`, `chapter`, `verse`, `position_ref`,
   `sort_order`, `heading`, `text`. `book_id` and `sort_order` are in that
   list deliberately — an entry moved to another book in the same source, or
   left in place but reordered, changes what the reader sees while every
   other field stays identical, and for a freeform source `sort_order` *is*
   the reading order. A clean UI pass with a corrupted diff underneath would
   be worse than no test at all.
4. **User data** — notes, highlights, links, bookmarks and highlighters must
   never shrink. A table missing from the live database is reported as total
   loss, not swallowed as a query error.
5. **Verdict**, and the exit code: `0` when only additions happened, `1` when
   anything was mutated, removed or lost, so this can gate a script.

Verified against synthetic databases covering each case it claims to catch: a
legitimate install-plus-reinstall reports clean and exits 0, while a tampered
verse, an entry reordering, an unexpected reinstall, a silently removed source,
a dropped user-data table and a deleted note are each caught and exit 1.
