// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 9 from CCEL, parses, strips footnotes, writes
// npnf209.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 9: Hilary of Poitiers, John of Damascus.
// Edited by Philip Schaff and Henry Wace. Hilary's Select Works translated
// by E. W. Watson and L. Pullan and others, edited by W. Sanday; John of
// Damascus's Exposition of the Orthodox Faith translated by S. D. F.
// Salmond. First published 1899, New York, by the Christian Literature
// Publishing Co. (Sanday's preface is signed Christ Church, Oxford,
// 12 July 1898.) Public domain.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 2,758 are balanced, none nested and none
// self-closing, all using the `id,n,place` convention (not Vol. 5's
// `anchored,id,n,place`). This is the lightest apparatus of the nine.
//
// STRUCTURE — two authors, four centuries and two languages apart, and the
// source does split them cleanly in two at div1, like Vol. 1's Eusebius
// texts rather than like anything messier. But it names only one of them.
//
// THIS IS THE VOLUME THAT FOUND RULE 9, and it was data loss on the scale
// of the Vol. 4 index bug. The four div1s are:
//
//   div1 i   — "Series Title"                                  (leaf)
//   div1 ii  — "Title Page"        — the ENTIRE Hilary half, six div2s,
//                                    1,042 paragraphs
//   div1 iii — "John of Damascus:  Exposition of the Orthodox Faith."
//   div1 iv  — "Indexes"                                       (apparatus)
//
// The Hilary half of the volume is filed under a div1 whose title attribute
// is the bare string "Title Page" — the container is named after its own
// opening page. Every earlier volume's front-matter pages were leaves, so
// the skip rule matched on title alone, and on this volume it silently
// dropped Hilary entirely: his Introduction, De Synodis, the twelve books
// of De Trinitate and the Homilies on the Psalms. Nothing about the bundle
// would have looked wrong — it would simply have been a John of Damascus
// volume with a Hilary name on the cover.
//
// The fix is in two parts, both in the shared module. A division that holds
// divisions is not a front-matter page, whatever it is titled (apparatus
// indexes, which really are containers, keep being skipped either way); and
// the section's real name is then read off its printed title page, the
// child division the attribute was named after — "St. Hilary of Poitiers.
// Select Works.", which is the same "Author: Work." form the sibling div1
// spells out in its own title attribute. It is text from the source, not a
// label invented for it. Vols. 1-8 are unaffected: every front-matter div1
// in all eight is a leaf, and all six earlier bundles rebuild
// byte-identically.
//
// Depth reaches div4 in both halves. Hilary's four div2 treatises each pair
// an editor's introduction with the work itself, so De Trinitate and the
// Psalm homilies — whose div3 bodies subdivide again — resolve to TOC
// groups, while De Synodis and the volume Introduction resolve to plain
// works.
//
// COUNTS, checked against what the source claims to contain rather than
// only against dangling TOC rows:
//   * Hilary, De Trinitate: 12 books. Twelve are here.
//   * Hilary, Homilies on the Psalms: the section is titled "Homilies on
//     Psalms I., LIII., CXXX." — three, and three are here.
//   * John of Damascus, Exposition of the Orthodox Faith: Book I has 14
//     chapters, Book II 30, Book III 29, Book IV 27, which is the standard
//     100-chapter division of the work and exactly what the bundle holds.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf209';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 9;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 9: Hilary of Poitiers, John of Damascus';
const MIN_PARAGRAPHS = 1500;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace, Hilary translated by E. W. Watson and '
  + 'L. Pullan under the editorship of W. Sanday, and John of Damascus by S. D. F. Salmond (first '
  + 'published 1899, New York, by the Christian Literature Publishing Co.). Editors deceased '
  + 'before 1925 (Schaff 1893, Wace 1924); text in the public domain in the United States. '
  + 'Editorial footnotes excluded.';

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
