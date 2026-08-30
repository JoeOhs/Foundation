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
2. **Sources** added, removed, or reinstalled (same title, new id).
3. **Pre-existing entries mutated?** — the check that matters. For every
   source present in both with the same id, entry rows are compared
   field-by-field (chapter, verse, position_ref, heading, text). A clean UI
   pass with a corrupted diff underneath would be worse than no test at all.
4. **User data** — notes, highlights, links, bookmarks and highlighters must
   never shrink.

Verified against synthetic databases covering both directions: a legitimate
install-plus-reinstall reports clean, while a tampered verse and a deleted
note are both caught.
