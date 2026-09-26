// Dedicated, fixed-schema importer for the Arguments, Prefaces and Epistles
// Dedicatory Calvin wrote for his Commentaries. Deliberately NOT routed
// through importer.ts's format sniffing: the input is a known bundle produced
// by tools/calvin-commentaries/build.mjs, from the same CTS translation the
// verse commentaries use.
//
// WHY A SEPARATE WORK. These pieces introduce a whole biblical book (or
// dedicate a volume to a patron) and anchor to no verse, so the verse-keyed
// commentary sources that feed the study footer have nowhere to put them.
// They are read as prose instead, on the Reformation shelf beside the
// Institutes, with the same type and category pairing ('extra-biblical' in
// 'reformation') and the same reasoning recorded there.
//
// SHAPE. One `books` row per commentary group (Genesis, Isaiah,
// Corinthians…), in the order the commentaries shelve; each piece is a
// chapter. The mechanics are shared with Zwingli's Selected Works — see
// pieceBundleImport.ts.
//
// LICENCE. Only Calvin's own pieces are in the bundle, each chosen by name in
// build.mjs's FRONT_MATTER list; the dedications written by his translators,
// printers and editors are not. The reasoning is in that script.

import { installPieceBundle } from './pieceBundleImport';

export const CALVIN_PREFACES_TITLE =
  'John Calvin — Arguments, Prefaces and Dedications to the Commentaries';

export function installCalvinPrefaces(onProgress: (msg: string) => void): Promise<number> {
  return installPieceBundle(
    {
      title: CALVIN_PREFACES_TITLE,
      bundleUrl: '/library/reformation/calvin-prefaces.json',
      category: 'reformation',
      label: 'Calvin prefaces',
    },
    onProgress,
  );
}
