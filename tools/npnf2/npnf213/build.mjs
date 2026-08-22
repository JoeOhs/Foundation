// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 13 from CCEL, parses, strips footnotes, writes
// npnf213.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 13: Gregory the Great (Part II),
// Ephraim Syrus, Aphrahat. Edited by Philip Schaff and Henry Wace; Gregory's
// selected epistles translated with notes and indices by James Barmby, the
// hymns of Ephraim by J. B. Morris, A. Edward Johnston and (the Nisibene
// series) Joseph T. Sarsfield Stopford, and Aphrahat "edited, with an
// Introductory Dissertation, by John Gwynn, D.D., D.C.L., Regius Professor
// of Divinity in the University of Dublin" — all named on the volume's own
// pages. First published 1898, New York, by the Christian Literature
// Publishing Co. Published in the United States well before 1929 and
// therefore in the public domain there.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 1,216 are balanced, none nested and none
// self-closing, on the `id,n,place` convention.
//
// STRUCTURE — two div1s, not three, and this is the split worth stating
// plainly because the volume is billed as three authors. Gregory has a div1
// to himself; Ephraim and Aphrahat share the second, whose title runs
// "Selections from the Hymns and Homilies of Ephraim the Syrian and from the
// Demonstrations of Aphrahat the Persian Sage." The source keeps them apart
// inside it instead, by prefixing every div2: "Ephraim Syrus: The Nisibene
// Hymns.", "Aphrahat: Select Demonstrations." That is the source's own
// arrangement and it is preserved rather than re-cut into two sections.
//
// GREGORY SPANS VOLS. 12 AND 13. Vol. 12 prints the Book of Pastoral Rule
// and Books I–VIII of the Register; this volume continues with Books IX–XIV,
// preceded by the editor's supplementary notes on both works. The split is
// the source's, and each volume is its own independent source row.
//
// The Books here sit at div2, one level higher than Vol. 12's, which nests
// its eight inside a "Register of the Epistles" container. Same author, same
// work, two different markup shapes across two volumes — a reminder that the
// depth is read per volume rather than carried over.
//
// COUNTS, checked against what the source claims rather than only against
// dangling TOC rows:
//   * Gregory: Books IX–XIV, all six present, with 60, 14, 38, 8, 19 and 8
//     epistles. Together with Vol. 12's I–VIII that is the whole Register as
//     NPNF prints it.
//   * Ephraim, "Nineteen Hymns on the Nativity of Christ in the Flesh":
//     the title counts them. Nineteen are here.
//   * Ephraim, "Fifteen Hymns For the Feast of the Epiphany": fifteen.
//   * Ephraim, "The Pearl. Seven Hymns on the Faith": seven.
//   * Ephraim, "Three Homilies": three.
//   * Ephraim, The Nisibene Hymns: 47 divisions, all 47 imported. Two of the
//     47 are not hymns but the editor's bracketed notes on the ones missing
//     — "[Hymn VIII. is wanting, as also the earlier part of IX.]" and
//     "[XXII.–XXV. (wanting); XXVI. (only a fragment remains) …]" — which
//     the source files under hymn-numbered title attributes, so the section
//     prints 45 hymns. Gwynn's preface says he included "forty-six of the
//     total number (originally seventy-seven; but a few are lost)". The
//     preface is one ahead of what the text actually prints; every division
//     the file contains is in the bundle, and no hymn heading appears
//     anywhere inside a sibling's body.
//   * Aphrahat: eight Demonstrations plus the "Letter of an Inquirer" that
//     occasions them. All nine documents are here.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf213';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 13;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 13: Gregory the Great (Part II), Ephraim Syrus, Aphrahat';
const MIN_PARAGRAPHS = 2500;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace; Gregory the Great translated by James '
  + 'Barmby, Ephraim Syrus by J. B. Morris, A. Edward Johnston and J. T. S. Stopford, and '
  + 'Aphrahat edited and translated by John Gwynn (first published 1898, New York, by the '
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
