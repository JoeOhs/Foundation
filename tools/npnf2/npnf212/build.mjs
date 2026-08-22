// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 12 from CCEL, parses, strips footnotes, writes
// npnf212.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 12: Leo the Great, Gregory the Great
// (Part I). Edited by Philip Schaff and Henry Wace; Leo's letters and
// sermons translated with introduction, notes and indices by Charles Lett
// Feltoe, Gregory's Pastoral Rule and Register by James Barmby. First
// published 1895, New York, by the Christian Literature Publishing Co. —
// corroborated inside the series itself, since Vol. 13's bibliography cites
// this volume as "2nd Ser., vol. XII … Oxford & New York, 1895". Published
// in the United States well before 1929 and therefore in the public domain
// there.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 1,762 are balanced, none nested and none
// self-closing, on the `id,n` convention.
//
// STRUCTURE — two div1s, one per author, each a container run of div2
// documents. No new rules were needed for it; it is the first volume of the
// batch that the module handled unchanged.
//
// Leo's 167 letters carry a shorttitle on the first one only ("Letter I")
// and nothing after it; every later letter opens with a paragraph that is
// just its own label, "Letter II.", so the existing label recovery names all
// 167 without inventing anything. That matters more here than usual: five
// letters are addressed "To Leo Augustus." and would otherwise be five
// identical TOC rows.
//
// GREGORY SPANS VOLS. 12 AND 13, and the source splits him itself rather
// than by work: this volume prints the Book of Pastoral Rule and Books I–VIII
// of the Register of the Epistles, and Vol. 13 continues with Books IX–XIV.
// The split is preserved as the source draws it — each volume is its own
// source row and neither reaches into the other.
//
// COUNTS, checked against what the source claims rather than only against
// dangling TOC rows:
//   * Leo, Letters: numbered I–CLXXIII, 167 present. The six absent numbers
//     are the editor's selection, not dropped divisions — Feltoe's own
//     preface says the letters left out "are in most cases no better than
//     those omitted."
//   * Leo, Sermons: 48, and the shorttitles show why that is right rather
//     than short — they run I, II, III, IX, X, XII, XVI … XCV, a selection
//     out of the 96, numbered as the print edition numbers them.
//   * Gregory, Book of Pastoral Rule: four Parts, the standard division.
//     Four are here.
//   * Gregory, Register of the Epistles: Books I–VIII, all eight present and
//     none dangling, with 52, 30, 34, 32, 31, 45, 28 and 21 epistles.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf212';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 12;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 12: Leo the Great, Gregory the Great (Part I)';
const MIN_PARAGRAPHS = 3000;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace; Leo the Great translated by Charles '
  + 'Lett Feltoe and Gregory the Great by James Barmby (first published 1895, New York, by the '
  + 'Christian Literature Publishing Co.). Published in the United States before 1929; text in '
  + 'the public domain in the United States. Editorial footnotes excluded.';

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
