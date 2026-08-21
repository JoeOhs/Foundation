// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 8 from CCEL, parses, strips footnotes, writes
// npnf208.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 8: Basil: Letters and Select Works.
// Edited by Philip Schaff and Henry Wace, the volume translated with notes
// by the Rev. Blomfield Jackson. First published 1895, New York, by the
// Christian Literature Publishing Co. Public domain.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 3,296 are balanced, none nested and none
// self-closing, all using the `id,n,place` convention (not Vol. 5's
// `anchored,id,n,place`).
//
// STRUCTURE — one author, and the SHALLOWEST and widest volume of the nine:
// depth stops at div3, but "The Letters" alone carries 357 div2 children,
// more than the whole of any earlier volume. Ten div1s:
//
//   Series title page and inner title page  — skipped, both leaves
//   Preface.                                — skipped, volume front matter
//   Genealogical Tables                     — see below
//   Chronological Table.  (82 para)         — kept, editors' scholarship
//   Prolegomena.                            — two div2 chapters, Life/Works
//   De Spiritu Sancto.                      — flat run, 30 chapters
//   The Hexæmeron.                          — flat run, 9 homilies
//   The Letters.                            — flat run, 356 chapters
//   Indexes                                 — skipped, apparatus
//
// GENEALOGICAL TABLES holds no text at all: its entire body is a single
// <img> of a scanned plate (files/genealogy.png) with no caption. It
// produces zero paragraphs and is dropped, which is correct — there is
// nothing to import, and the fallback path in extractParagraphs does not
// fire either, so no stray markup leaks in its place. Noted here because a
// silently-empty division is exactly the shape a real loss would take.
//
// COUNTS, checked against what the source itself claims rather than only
// against dangling TOC rows:
//   * Basil's letters run I to CCCLXVI — 366 of them, the full NPNF
//     collection including the Basil/Libanius correspondence. They arrive
//     as 356 chapters, not 366, and the ten-row difference is the SOURCE's
//     own doing, not a parsing loss. It collapses three short groups of
//     fragmentary letters into one division each — CCCXVI-CCCXIX,
//     CCCXXX-CCCXXXIII and CCCLXI-CCCLXV, ten letters in three rows — and
//     prints every other number as its own division. All 366 were checked
//     individually against the built bundle: 353 have a row to themselves,
//     the other thirteen sit in those three rows, and none is absent.
//     Two of the three rows carry the collapsed range in their heading;
//     the third is titled "Without address." from the source's own div
//     title, with its four numbers as the first line of its text, because
//     the label rules read a single "Letter N." prefix and not a
//     comma-separated list. Three rows in 356 did not seem worth a rule of
//     their own, and none of them collides with anything.
//   * De Spiritu Sancto: 30 chapters plus its preface — the complete
//     treatise, which the source's own table of contents ends at XXX.
//   * The Hexæmeron: the title page calls it "the nine homilies of the
//     Hexæmeron", and nine is what is here (Homilies I-IX) plus the
//     editor's introduction.
//
// This volume forced no new rules into the shared module. It is built by
// the same logic as Vols. 1-7, and every run in it decides as before —
// three flat runs of leaves plus one small container run in the
// Prolegomena, whose "Life." and "Works." each become a work of their own.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf208';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 8;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 8: Basil: Letters and Select Works';
const MIN_PARAGRAPHS = 1900;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace, translated with notes by Blomfield '
  + 'Jackson (first published 1895, New York, by the Christian Literature Publishing Co.). '
  + 'Editors deceased before 1925 (Schaff 1893, Wace 1924); text in the public domain in the '
  + 'United States. Editorial footnotes excluded.';

async function main() {
  const refetch = process.argv.includes('--refetch');
  const raw = await loadRaw(VOLUME_ID, path.join(__dirname, 'raw'), refetch);
  console.log(`Loaded ${(raw.length / 1024 / 1024).toFixed(1)} MB of ThML XML`);
  console.log('Parsing ThML structure…');
  const bundle = buildBundle(raw, {
    volumeId: VOLUME_ID,
    volumeNumber: VOLUME_NUMBER,
    volumeTitle: VOLUME_TITLE,
    licenseNote: LICENSE_NOTE,
  });
  console.log('Validating…');
  validate(bundle, MIN_PARAGRAPHS);
  const json = JSON.stringify(bundle, null, 0);
  await fs.writeFile(OUTPUT_PATH, json, 'utf8');
  console.log(`Wrote ${OUTPUT_PATH} (${(json.length / 1024 / 1024).toFixed(1)} MB)`);
  await fs.copyFile(OUTPUT_PATH, DEPLOY_PATH);
  console.log(`Copied to ${DEPLOY_PATH}`);
  console.log('Done.');
}

main().catch((err) => { console.error('Build failed:', err.message); process.exit(1); });
