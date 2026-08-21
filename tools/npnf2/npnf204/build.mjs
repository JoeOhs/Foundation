// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 4 from CCEL, parses, strips footnotes, writes
// npnf204.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 4: Athanasius: Select Works and Letters.
// Edited by Philip Schaff and Henry Wace, the volume itself edited by
// Archibald Robertson. First published 1892, New York, by the Christian
// Literature Publishing Co. Public domain.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed from
// Vols. 1-3: <note> is the only apparatus element, all 4,806 are balanced,
// none nested and none self-closing, and every one uses the same `id,n,place`
// attribute convention Series I used. Notes sit inside <p>, and many contain
// <p> of their own, so stripping must happen before paragraph extraction —
// it does. Verified exhaustively afterwards: of the 1,248 notes long enough
// to test (>=60 characters), none appear anywhere in the built text.
//
// STRUCTURE — 26 div1s, one per work, which is the flattest arrangement in
// Series II so far: no volume-wide container, just Athanasius's treatises,
// apologies and letters listed side by side. Depth reaches div4 (the Festal
// and Personal Letters, and the Discourses against the Arians). Almost every
// treatise div1 opens with the editor's "Introduction." as its first div2,
// which the front-matter split puts beside the treatise rather than inside it.
//
// Three things in this volume the shared parser could not previously handle,
// all fixed in shared/thml.mjs rather than here:
//
//   1. The div2 "The Festal Letters, and their Index." was being dropped
//      whole — fifty letters — because the index-skipping rule matched the
//      word "Index" anywhere in a title. It now matches only the apparatus
//      naming ("Indexes", "Index of...", "General Index to..."), which also
//      keeps this volume's div3 "Index.", the ancient Festal Index and 49
//      paragraphs of real text.
//   2. Even once kept, those fifty letters collapsed into two chapters: the
//      editor's introduction to them runs to 564 paragraphs, outweighing the
//      letters themselves, and the container-vs-flat test counted it. Front
//      matter no longer votes.
//   3. The letters surviving only in excerpt are headed "From Letter
//      XXVIII.-(For 356.)", so the prefix label reader now allows a leading
//      "From". Without it seven rows were titled by their year alone.
//
// This volume also prints a second, inner title page and calls the editors'
// preface "Editorial Preface."; both are front matter of the kind Vols. 1-3
// already skipped under different names, and are now skipped here too.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf204';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 4;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 4: Athanasius: Select Works and Letters';
const MIN_PARAGRAPHS = 3500;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace, this volume edited by Archibald Robertson '
  + '(first published 1892, New York, by the Christian Literature Publishing Co.). All editors deceased '
  + 'before 1935 (Schaff 1893, Wace 1924, Robertson 1931); text in the public domain in the United '
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
