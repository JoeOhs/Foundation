# Smith's Bible Dictionary — bundle builder

Builds `public/library/smiths.json`, the bundled copy of **Smith's Bible
Dictionary** (Dr. William Smith, 1884) that installs from the Library's
"Dictionaries" section and reads in the study footer's Dictionary tab.

```
node build.mjs            # uses raw/Smith.zip if cached
node build.mjs --refetch  # force a fresh download
```

## Provenance

| Field  | Value |
| ------ | ----- |
| Text   | CrossWire SWORD module **Smith** v1.3 (`DistributionLicense: Public Domain`) |
| Source | https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Smith.zip |
| Work   | Smith's Bible Dictionary, Dr. William Smith (1813–1893), 1884 — public domain |

The user-supplied archive.org scan (`dictionaryofbwi01smit`) was evaluated
first and rejected: its text renditions are all raw ABBYY OCR of a
two-column 1881 scan, with heavy character-level corruption ("I'-gj^pt"
for "Egypt", "w;us" for "was"), and the item is only **volume 1 of the
four-volume unabridged edition**. The CrossWire module is the complete
1884 dictionary, hand-transcribed rather than OCRed, with every headword
already structured — the same text that ships in e-Sword and other Bible
software.

## Guards

- The build **refuses to run** unless the module config declares
  `DistributionLicense=Public Domain`.
- It fails if fewer than ~4,000 entries parse (a partial build), or if any
  ThML markup survives into the output text.

## Output shape

```
{ metadata: { title, license_note, source_url },
  letters: [ { letter: "A", entries: [ { word: "AARON", text: "…" } ] } ] }
```

`src/smithsImport.ts` installs this as one `dictionary`-category source:
one book per letter, one entry per article, headword in
`entries.position_ref` (which is what `dictionaryLookup` prefix-matches).
Scripture references inside articles keep their visible text
("Exodus 4:14"); `<term>`/`[BRACKETED]` cross-references keep the target
headword as plain text.
