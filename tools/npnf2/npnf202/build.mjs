// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 2 from CCEL, parses, strips footnotes, writes
// npnf202.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 2: Socrates: Church History (A.D.
// 305–438); Sozomenus: Church History (A.D. 323–425).
// Edited by Philip Schaff and Henry Wace. First published 1890. Public
// domain. Series II is co-edited — Wace joins Schaff, who edited Series I
// alone — so the provenance note names both.
//
// FOOTNOTES: Excluded. Audited against this volume rather than assumed:
// <note> is the only apparatus element, all 1,642 are balanced, none nested
// and none self-closing, so the non-greedy strip is safe; every one sits
// inside a <p>, so stripping must happen before paragraph extraction. All
// 1,642 use the `id,n,place` attribute convention.
//
// STRUCTURE — the shallowest of the batch and the only one with no div4:
// two content div1s (Socrates, Sozomen), each a run of div2 Books whose
// div3s are the chapters, alongside div2 front matter held directly. This
// volume is where the prefix label recovery earned its place: only 18 of
// its 507 chapters carry a `shorttitle`, and the rest open with their number
// as a paragraph prefix ("Chapter II.—By what Means the Emperor Constantine
// became a Christian."), which Series I's bare-label check could not read.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf202';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 2;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 2: Socrates, Sozomenus: Church Histories';
const MIN_PARAGRAPHS = 500;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace (first published 1890, New York, by the ' +
  'Christian Literature Publishing Co.). Both editors deceased before 1925 (Schaff 1893, Wace 1924); ' +
  'text in the public domain in the United States. Editorial footnotes excluded.';

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
