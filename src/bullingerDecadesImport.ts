// Dedicated, fixed-schema importer for Heinrich Bullinger's *Decades* in the
// Parker Society edition (trans. H. I., ed. Thomas Harding, Cambridge,
// 1849–52). Deliberately NOT routed through importer.ts's format sniffing:
// the input is a known bundle produced by tools/bullinger/build.mjs.
//
// SCOPE. All fifty sermons, five Decades of ten, with Bullinger's own
// prefatory pieces the edition carries (the Four General Synods, his
// dedications to Edward VI, the Marquis of Dorset and his Zurich colleagues),
// the Elizabethan translator's preface, and Harding's Biographical Notice.
//
// SHAPE. One `books` row for the prefatory pieces, then one per Decade; each
// sermon is a piece. Mechanics shared with Zwingli and Calvin's prefaces —
// see pieceBundleImport.ts.
//
// LICENCE. Published in Cambridge, 1849–52: public domain. The text is OCR of
// Internet Archive scans, not a transcription — see tools/bullinger/README.md.

import { installPieceBundle } from './pieceBundleImport';

export const BULLINGER_DECADES_TITLE = 'Heinrich Bullinger — The Decades';

export function installBullingerDecades(onProgress: (msg: string) => void): Promise<number> {
  return installPieceBundle(
    {
      title: BULLINGER_DECADES_TITLE,
      bundleUrl: '/library/reformation/bullinger.json',
      category: 'reformation',
      label: 'Bullinger Decades',
    },
    onProgress,
  );
}
