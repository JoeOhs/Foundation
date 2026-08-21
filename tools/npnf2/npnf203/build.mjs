// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 3 from CCEL, parses, strips footnotes, writes
// npnf203.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 3: Theodoret, Jerome and Gennadius,
// Rufinus and Jerome: Historical Writings.
// Edited by Philip Schaff and Henry Wace. First published 1892. Public
// domain. Series II is co-edited — Wace joins Schaff, who edited Series I
// alone — so the provenance note names both.
//
// FOOTNOTES: Excluded. Audited against this volume rather than assumed:
// <note> is the only apparatus element, all 3,448 are balanced, none nested
// and none self-closing, so the non-greedy strip is safe; every one sits
// inside a <p>, so stripping must happen before paragraph extraction. All
// 3,448 use the `id,n,place` attribute convention.
//
// STRUCTURE — the four works this volume collects are NOT four peer div1s.
// The source gives three div1s, and splits the middle one at div2:
//
//   div1 iv  — Theodoret (History, Dialogues, Letters)
//   div1 v   — "Jerome and Gennadius. Lives of Illustrious Men", holding
//              Jerome's Lives and Gennadius's continuation as two div2s
//   div1 vi  — Rufinus, with Jerome's Apology against him
//
// so Jerome and Gennadius are delineated one level below Theodoret and
// Rufinus. They still resolve to separate works because a div2 that holds
// its own run of chapters becomes a work in its own right — the same rule
// that keeps NPNF Series I Vol. 11's Acts and Romans apart.
//
// Depth reaches div4 (Theodoret's History, both Apologies: div3 Books of
// div4 chapters), and only 23 of 365 div4s carry a `shorttitle`, so most
// chapter numbers are read from the paragraph prefix. Theodoret's 182
// letters are the case that needed the sibling kind inference: after a
// first letter whose shorttitle reads "Letter I", the rest lead with a bare
// "II. To the Same." — and "To the Same." alone repeats dozens of times.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf203';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 3;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 3: Theodoret, Jerome and Gennadius, Rufinus and Jerome: Historical Writings';
const MIN_PARAGRAPHS = 500;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace (first published 1892, New York, by the ' +
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
