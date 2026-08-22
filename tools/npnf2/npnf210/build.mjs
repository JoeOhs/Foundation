// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 10 from CCEL, parses, strips footnotes, writes
// npnf210.json for Foundation's compound-work import.
//
// PROVENANCE — NPNF Series II, Vol. 10: Ambrose, Select Works and Letters.
// Edited by Philip Schaff and Henry Wace; the works translated by the Rev.
// H. de Romestin with the Rev. E. de Romestin and the Rev. H. T. F.
// Duckworth, as the volume's own title page states. First published 1896,
// New York, by the Christian Literature Publishing Co. Published in the
// United States well before 1929 and therefore in the public domain there.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 3,806 are balanced, none nested and none
// self-closing, all on the `id,n,place` convention.
//
// STRUCTURE — four div1s of content plus front matter and indexes:
// Prolegomena (six numbered sections, a flat run), the Dogmatic Treatises
// (eight treatises, most of them Books of chapters, so a container run
// reaching div4), and the Letters. Depth reaches div4.
//
// THIS VOLUME FOUND RULES 10, 11 AND 12, and one of the three was loss.
//
//   * Its front matter is headed "Title Pages." — plural. The skip pattern
//     matched only the singular, so the volume opened with a section of
//     publisher's boilerplate (rule 10).
//
//   * Ambrose's treatises print a display heading between a container's
//     opening tag and its first child — "Three Books on the Duties of the
//     Clergy. by St. Ambrose, Bishop of Milan. Book I." — with no <p> around
//     it. ownParagraphs's bare-text fallback read those headings as the
//     container's own text, which is why De Officiis Book I came out with 51
//     chapters against the source's 50, De Mysteriis with 11 against its 9,
//     Concerning Widows with 17 against its 16, and why four treatises each
//     carried a spurious one-paragraph work named after themselves (rule 11).
//
//   * The loss: the Letters div1 holds two paragraphs of its own before its
//     first div2, and nothing read them. They are the editor's "Note on the
//     Letters of St. Ambrose", which is precisely the note a reader needs
//     here — it says the sixteen letters printed are a selection, and that
//     the Benedictine editors count ninety-one genuine (rule 12). Small
//     beside Vol. 4's fifty letters or Vol. 9's Hilary, but the same kind of
//     thing: text the parser never looked at.
//
// COUNTS, checked against what the source claims rather than only against
// dangling TOC rows:
//   * On the Duties of the Clergy: Books I–III of 50, 30 and 22 chapters,
//     the standard division of De Officiis. All three match.
//   * On the Holy Spirit: three Books, as its own heading says ("Three Books
//     of St. Ambrose … on the Holy Spirit"). Three are here.
//   * On the Decease of His Brother Satyrus: "The Two Books". Two are here.
//   * Exposition of the Christian Faith: five Books. Five are here.
//   * On the Mysteries: 9 chapters. Nine are here.
//   * Concerning Repentance: "Two Books Concerning Repentance", of 16 and 11
//     chapters. Both Books are here with those counts.
//   * Concerning Virgins: three Books. Concerning Widows: 15 chapters.
//   * Letters: the editor's own note calls them a selection and gives no
//     count, and fifteen documents are printed. All fifteen are here.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf210';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 10;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 10: Ambrose: Select Works and Letters';
const MIN_PARAGRAPHS = 3000;

const LICENSE_NOTE =
  'Public domain. Edited by Philip Schaff and Henry Wace, translated by H. de Romestin with '
  + 'E. de Romestin and H. T. F. Duckworth (first published 1896, New York, by the Christian '
  + 'Literature Publishing Co.). Published in the United States before 1929; text in the public '
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
