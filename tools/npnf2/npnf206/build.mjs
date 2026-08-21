// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 6 from CCEL, parses, strips footnotes, writes
// npnf206.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 6: Jerome: The Principal Works of
// St. Jerome. Edited by Philip Schaff and Henry Wace, the volume translated
// by W. H. Fremantle with G. Lewis and W. G. Martley. First published 1892,
// New York, by the Christian Literature Publishing Co. Public domain.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 5,443 are balanced, none nested and none
// self-closing, all using the `id,n,place` convention (not Vol. 5's
// `anchored,id,n,place`). This is the heaviest apparatus of the six volumes
// — 5,443 notes over 4.2 MB. Verified exhaustively afterwards: of the 861
// notes long enough to test (>=60 characters), none appear anywhere in the
// built text.
//
// STRUCTURE — a mixed volume, and the source delineates the mixture itself,
// at div1, by kind: Prolegomena, "The Letters of St. Jerome" (150 letters),
// "Treatises" (the three Lives, the dialogues and the polemics), and
// "Prefaces". So the four kinds arrive as four separate sections without any
// inference; nothing here had to be split apart by hand the way Vol. 3's
// Jerome and Gennadius did.
//
// This is also the SHALLOWEST volume of the six: depth stops at div3, where
// Vols. 4 and 5 reach div4. The three levels fall out differently per section:
//
//   * Letters — 150 flat div2s, every one carrying a "Letter N" shorttitle,
//     so they resolve to one work of 150 chapters, each titled "Letter N. To
//     Whoever." This is the same shape as Theodoret's 182 letters in Vol. 3,
//     but far easier: Vol. 3's letters carried a bare numeral and needed the
//     sibling-kind inference; Jerome's are labelled outright.
//   * Treatises — a container run mixing seven leaf works (the Lives, the
//     Dialogue, Against Vigilantius) with two subdivided ones (Against
//     Jovinianus, Against the Pelagians), each of which keeps its Books as
//     chapters of one work.
//   * Prefaces — three containers plus a leaf introduction.
//
// The one thing this volume forced into the shared module is the divider
// case. Its twenty Vulgate prefaces are a single flat list, but the
// fifteenth, "Translations from the Septuagint and Chaldee.", heads the five
// below it, so "Chronicles." appears at position 5 and again at 16 with no
// markup separating them. The structure is left as the source wrote it and
// only the repeated title is qualified; see disambiguateChapters().

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf206';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 6;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 6: Jerome: The Principal Works of St. Jerome';
const MIN_PARAGRAPHS = 2300;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace, translated by W. H. Fremantle with '
  + 'G. Lewis and W. G. Martley (first published 1892, New York, by the Christian Literature '
  + 'Publishing Co.). Editors deceased before 1925 (Schaff 1893, Wace 1924); text in the public '
  + 'domain in the United States. Editorial footnotes excluded.';

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
