// Standalone data-prep script: downloads ThML XML of Nicene and Post-Nicene
// Fathers, Series II, Volume 14 from CCEL, parses, strips footnotes, writes
// npnf214.json for Foundation's compound-work import. This is the last
// volume of Series II, and with it of the whole Church Fathers collection.
//
// PROVENANCE — NPNF Series II, Vol. 14: The Seven Ecumenical Councils of the
// Undivided Church, their canons and dogmatic decrees, together with the
// canons of all the local synods which have received ecumenical acceptance.
// Series edited by Philip Schaff and Henry Wace; this volume "edited with
// notes gathered from the writings of the greatest scholars by Henry R.
// Percival, M.A., D.D.", whose preface is dated Pentecost, 1899. First
// published 1900, New York, by the Christian Literature Publishing Co.
// Published in the United States well before 1929 and therefore in the
// public domain there.
//
// FOOTNOTES: Excluded. Audited against this volume, not assumed: <note> is
// the only apparatus element, all 609 are balanced — the lightest apparatus
// of the fourteen — none nested and none self-closing, on the `id,n,place`
// convention.
//
// STRUCTURE — this volume is a different kind of book from the other
// thirteen. It is not authored prose but conciliar legislation: canons,
// decrees, definitions of faith, and extracts from the acts, each canon
// followed by Percival's notes and by excursuses on its later history. It
// was approached as a fresh discovery pass on the assumption that none of
// the chapter/homily/letter handling would apply.
//
// It turned out to need no new shape. The source lays it out as:
//
//   div1  a council, or a collection of local synods, or volume front matter
//   div2  a document of that council — a creed, a letter, an excursus, a
//         session's extracts, or the collection of its canons
//   div3  a single canon, with its notes
//
// which is exactly the section → work → chapter model the other thirteen
// volumes use. The council takes the slot an author takes elsewhere. Nothing
// here needed the TOC depth extended, and forcing a Council → Canon model on
// it would have flattened away the sessions, letters and definitions that
// sit beside the canons.
//
// The run-shape vote decides each council on its own text. In eleven of the
// thirteen council and synod sections the canon collection carries most of
// the text, so the section reads as a container run and every document
// becomes its own work. The Fifth and Sixth Councils enacted no canons at
// all, so they have no subdivided document, read as flat runs, and their
// documents become chapters of one work instead of works. That is the same
// rule reaching a different answer on genuinely different data, and it is
// left as the rule gives it.
//
// This volume also found rule 13. A council's documents are printed in the
// order the acts were read, so the extracts resume under an unchanged
// heading after each document quoted in full: Ephesus carries two works
// titled "Extracts from the Acts. Session I. (Continued)." and Chalcedon two
// of "…Session II. (Continued)." Repeated work titles are now qualified by
// the nearest preceding sibling, the same repair already applied to
// chapters, so each row says which document it resumes after.
//
// COUNTS — verified canon by canon against the documented totals for each
// council, which is the check this batch treats as mandatory. Every
// collection below is numbered I..N with no gaps and no duplicates:
//
//   Nicaea I ................ 20    Ancyra .................. 25
//   Constantinople I .......... 7    Neocæsarea .............. 15
//   Ephesus ................... 8    Gangra .................. 20
//   Chalcedon ................ 30    Antioch ................. 25
//   Trullo (Quinisext) ...... 102    Laodicea ................ 60
//   Nicaea II ................ 22    Sardica ................. 20
//                                    Carthage (African Code)  138
//
// One apparent gap is the source's own: the Chalcedon collection runs I–
// XXVIII, then "Excursus on the Later History of Canon XXVIII.", then Canon
// XXX and Canon XXXI. The print edition skips the number XXIX, and its
// heading calls the set "The XXX Canons". All 31 divisions the file contains
// are in the bundle; nothing was dropped in parsing.
//
// The volume's front matter — General Introduction, Bibliographical
// Introduction, the Appended Note on Eastern editions, and the Excursus on
// Roman law — are div1s in their own right and are kept as sections. Only
// "Title Pages." is skipped, and only after rule 10 taught the skip pattern
// the plural.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRaw } from '../shared/fetchThml.mjs';
import { buildBundle, validate } from '../shared/thml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VOLUME_ID = 'npnf214';
const OUTPUT_PATH = path.join(__dirname, `${VOLUME_ID}.json`);
const DEPLOY_PATH = path.join(__dirname, '..', '..', '..', 'public', 'library', 'patristic', `${VOLUME_ID}.json`);

const VOLUME_NUMBER = 14;
const VOLUME_TITLE =
  'Nicene and Post-Nicene Fathers, Series II, Vol. 14: The Seven Ecumenical Councils';
const MIN_PARAGRAPHS = 6000;

const LICENSE_NOTE =
  'Public domain. Series edited by Philip Schaff and Henry Wace; this volume edited, with notes '
  + 'and translations, by Henry R. Percival (first published 1900, New York, by the Christian '
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
