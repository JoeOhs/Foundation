// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 7 from CCEL, parses, strips footnotes, writes
// npnf207.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 7: Cyril of Jerusalem, Gregory
// Nazianzen. Edited by Philip Schaff and Henry Wace. Cyril's Catechetical
// Lectures translated by Edwin Hamilton Gifford; Gregory's Select Orations
// and Select Letters by Charles Gordon Browne and James Edward Swallow.
// First published 1894, New York, by the Christian Literature Publishing Co.
// (Gifford's preface is signed Oxford, 26 May 1893.) Public domain.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 4,782 are balanced, none nested and none
// self-closing, all using the `id,n,place` convention — Vols. 1-4 and 6's
// convention, not Vol. 5's `anchored,id,n,place`.
//
// STRUCTURE — two authors, but THREE content div1s, because the source
// splits Gregory by genre rather than by author:
//
//   div1 ii  — The Catechetical Lectures of S. Cyril.
//   div1 iii — Select Orations of Saint Gregory Nazianzen.
//   div1 iv  — Select Letters of Saint Gregory Nazianzen.
//
// So the two authors are delineated by the source itself and arrive as
// three top-level sections, two of which name Gregory outright. Nothing had
// to be split by hand the way Vol. 3's Jerome and Gennadius did, and
// nothing merges: Cyril's section holds no Gregory and neither Gregory
// section holds any Cyril.
//
// Each section resolves differently, and the shapes were measured rather
// than assumed:
//
//   * Cyril — a FLAT run. Twenty-seven div2s, of which twenty-four are body
//     (the Procatechesis and Lectures I-XXIII) holding 690 paragraphs
//     directly, against a subdivided 436-paragraph editorial Introduction.
//     Body outweighs it, so the lectures are the chapters of one work and
//     the Introduction splits off as front matter — Vol. 4's rule 5 doing
//     what it exists to do.
//   * Orations — also flat: twenty-five orations as chapters, with the
//     Prolegomena split off.
//   * Letters — a CONTAINER run, and the deepest structure in the volume.
//     The source groups the letters into three Divisions; Divisions I and
//     II hold their letters directly at div3, while Division III groups
//     seventy-two more under nine div4 headings by correspondent. That
//     makes Division III a container of containers and so a TOC group, the
//     shape Vol. 1's Life of Constantine takes.
//
// COUNTS, checked against what the source says it contains rather than only
// against dangling TOC rows:
//   * Cyril: Procatechesis + Lectures I-XXIII = 24 chapters. That is the
//     complete Catechetical Lectures — eighteen catechetical, five
//     mystagogical — and all 24 are present.
//   * Gregory: 25 orations, 99 letters (4 + 23 + 72 across the three
//     Divisions). The volume is a *select* edition of both and states no
//     total of its own; every div2/div3/div4 the source carries is
//     accounted for in the bundle.
//
// The one thing this volume forced into the shared module is rule 8:
// "lecture" as a sequence kind. Cyril's lectures number themselves in the
// opening paragraph ("Lecture II.") and nowhere else — only "Lecture I"
// carries a shorttitle — so without the kind all twenty-three read as bare
// subjects in the TOC ("On Baptism.", "Of Faith.") with no number anywhere.
// Vols. 1-6 rebuild byte-identically with it added.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf207';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 7;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 7: Cyril of Jerusalem, Gregory Nazianzen';
const MIN_PARAGRAPHS = 2000;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace, Cyril translated by Edwin Hamilton '
  + 'Gifford and Gregory Nazianzen by Charles Gordon Browne and James Edward Swallow (first '
  + 'published 1894, New York, by the Christian Literature Publishing Co.). Editors deceased '
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
