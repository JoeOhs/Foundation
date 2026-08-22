// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 11 from CCEL, parses, strips footnotes, writes
// npnf211.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 11: Sulpitius Severus, Vincent of
// Lérins, John Cassian. Edited by Philip Schaff and Henry Wace. The volume
// names its three translators separately, one per author: Sulpitius Severus
// "translated, with preface, and notes, by Rev. Alexander Roberts, D.D.";
// Vincent's Commonitory "translated by Rev. C. A. Heurtley, D.D."; Cassian
// "translated, with prolegomena, prefaces, and notes, by Rev. Edgar C. S.
// Gibson, M.A." First published 1894, New York, by the Christian Literature
// Publishing Co. Published in the United States well before 1929 and
// therefore in the public domain there.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 2,684 are balanced, none nested and none
// self-closing, on the `id,n` convention — Vol. 10's notes carry `place` as
// well, so the two volumes of this batch do not even agree with each other.
//
// STRUCTURE — three authors, three top-level div1s, one each. Vol. 7's "two
// authors, three sections" surprise does not repeat: here the source's own
// division and the volume's billing agree. Vincent is the odd one only in
// depth — his Commonitory has no container above its chapters, so the whole
// section is one flat run of 33 chapters plus an introduction and three
// appendices, and the work takes the div1's (very long) printed title.
//
// Like Vol. 10, this volume prints display headings with no <p> around them
// between a container's opening tag and its first child, and hit rule 11's
// fallback fifty-odd times; every one was the division's own title again
// ("Dialogues of Sulpitius Severus.", "Book X. Of the Spirit of Accidie.").
//
// COUNTS, checked against what the source claims rather than only against
// dangling TOC rows:
//   * Vincent, Commonitory: 33 chapters, the standard division, plus three
//     appendices the source numbers as such. All 33 and all three are here.
//   * Cassian, "The Twelve Books on the Institutes": twelve Books, as the
//     title says. Twelve are here — but Book VI holds one paragraph, and
//     that is the source, not the parser: "We have thought best to omit
//     altogether the translation of this book."
//   * Cassian, Conferences: 24, printed in three Parts the source titles
//     "Containing Conferences I-X", "XI-XVII" and "XVIII.-XXIV." All 24 are
//     here in those three groups. Conference XII reads "Not translated." and
//     Conference XXII "This Conference is omitted." — again the translator's
//     Victorian squeamishness (On Chastity, On Nocturnal Illusions), not a
//     dropped division.
//   * Cassian, "The Seven Books … on the Incarnation of the Lord": seven, as
//     the title says. Seven are here.
//   * Sulpitius Severus: the Life of St. Martin, the Letters, three
//     Dialogues, seven Doubtful Letters and the two Books of the Sacred
//     History — every document the section's own opening list names.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf211';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 11;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 11: Sulpitius Severus, Vincent of Lérins, John Cassian';
const MIN_PARAGRAPHS = 2000;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace; Sulpitius Severus translated by '
  + 'Alexander Roberts, Vincent of Lérins by C. A. Heurtley, and John Cassian by Edgar C. S. '
  + 'Gibson (first published 1894, New York, by the Christian Literature Publishing Co.). '
  + 'Published in the United States before 1929; text in the public domain in the United States. '
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
