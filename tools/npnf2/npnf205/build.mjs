// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 5 from CCEL, parses, strips footnotes, writes
// npnf205.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 5: Gregory of Nyssa: Dogmatic Treatises,
// Select Writings and Letters. Edited by Philip Schaff and Henry Wace, the
// volume translated by William Moore and Henry Austin Wilson. First published
// 1892, New York, by the Christian Literature Publishing Co. Public domain.
//
// FOOTNOTES: Excluded. Audited against this volume, and it is the one volume
// so far that does NOT match Series I's convention: all 2,272 notes carry
// `anchored,id,n,place`, an attribute none of Vols. 1-4 use. The strip is
// attribute-agnostic (`<note ...>` with any attributes), so it is unaffected,
// but the check is why that matters. All 2,272 are balanced, none nested,
// none self-closing. Verified exhaustively afterwards: of the 917 notes long
// enough to test (>=60 characters), five matched text in the built bundle and
// all five are quotation overlap, not leakage — Gregory quotes Eunomius in
// the body and the note gives a variant rendering of the same sentence. Each
// was confirmed present in the note-stripped source. Zero real leaks.
//
// STRUCTURE — 14 div1s, grouped by GENRE rather than by work: Dogmatic,
// Ascetic and Moral, Philosophical, Apologetic and Oratorical Works, then
// Letters. Depth reaches div4. The genre div1s are containers of treatises,
// so each treatise resolves to its own work under its genre heading, and
// "Against Eunomius" — twelve Books plus the two covering letters, deep
// enough to be a container of containers — becomes a TOC group inside
// Dogmatic Treatises, the same shape Vol. 1's Life of Constantine takes.
//
// Two div1s are neither treatise nor apparatus and are kept as sections of
// their own: "Works on Analytical Criticism, History, and Bibliography,
// Consulted." and "Dates of Treatises, &c., Here Translated." They are
// reference matter, but they are the editors' scholarship, not a title page.
//
// This volume needed no new parsing rules. It is built by the same shared
// module as Vols. 1-4, and the three changes Vol. 4 forced leave every run
// in this volume decided exactly as before.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf205';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 5;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 5: Gregory of Nyssa: Dogmatic Treatises, Select Writings and Letters';
const MIN_PARAGRAPHS = 1300;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace, translated by William Moore and Henry '
  + 'Austin Wilson (first published 1892, New York, by the Christian Literature Publishing Co.). '
  + 'Editors deceased before 1925 (Schaff 1893, Wace 1924); text in the public domain in the United '
  + 'States. Editorial footnotes excluded.';

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
