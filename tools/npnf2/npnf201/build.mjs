// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 1 from CCEL, parses, strips footnotes, writes
// npnf201.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 1: Eusebius: Church History, Life of
// Constantine the Great, and Oration in Praise of Constantine.
// Edited by Philip Schaff and Henry Wace. First published 1890. Public
// domain. Series II is co-edited — Wace joins Schaff, who edited Series I
// alone — so the provenance note names both.
//
// FOOTNOTES: Excluded. Audited against this volume rather than assumed:
// <note> is the only apparatus element, all 3,587 are balanced, none nested
// and none self-closing, so the non-greedy strip is safe; every one sits
// inside a <p>, so stripping must happen before paragraph extraction. All
// 3,587 use the `id,n,place` attribute convention — the same one most of
// Series I uses, but Series I alone had three conventions across its 14
// volumes, so the strip stays attribute-agnostic and each volume is checked.
//
// STRUCTURE — this volume is a level deeper than any Series I volume: it
// runs to div4. Two content div1s (the Church History, and the Life of
// Constantine with the two Orations). Under each, div2 is either a work
// held directly, a Book whose div3s are its chapters, or a *container* whose
// div3s are themselves Books full of div4 chapters — the Prolegomena, and
// the Life of Constantine's four Books. That third shape is what forced the
// depth-recursive resolution in this generation; Series I's fixed
// div1/div2/div3 walk would have collapsed each of those Books into one
// undivided chapter and thrown away 322 div4 headings.
//
// Chapter numbers live in `shorttitle` here (321 of 322 div4s carry one),
// which the Series I label folding already handles.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf201';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 1;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 1: Eusebius: Church History, Life of Constantine the Great, Oration in Praise of Constantine';
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
