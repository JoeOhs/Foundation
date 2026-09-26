// Dedicated, fixed-schema importer for Huldrych Zwingli's *Selected Works*
// (ed. Samuel Macauley Jackson, University of Pennsylvania, 1901).
// Deliberately NOT routed through importer.ts's format sniffing: the input is
// a known bundle produced by tools/zwingli/build.mjs.
//
// SCOPE. This is a selection, not collected works: five documents of the
// Zurich Reformation, 1522–1527 — the letter on the Bishop of Constance's
// delegation, the petition of the eleven priests to marry, the Acts of the
// First Zurich Disputation with the Sixty-seven Articles, the Zurich Marriage
// Ordinance, and the Refutation of the Tricks of the Catabaptists — with
// Jackson's preface and general introduction. Jackson's own preface says so,
// and says it chose papers never before translated; the title must not be
// read as the whole of Zwingli.
//
// SHAPE. One `books` row per document, in the edition's order, with the
// Preface and Introduction as the first; each printed section heading inside
// a document is a piece. The mechanics are shared with Calvin's Arguments,
// Prefaces and Dedications — see pieceBundleImport.ts. Same type and category
// pairing as the Calvin prose works ('extra-biblical' in 'reformation'), for
// the same reasons.
//
// LICENCE. Published in Philadelphia in 1901: public domain in the US. The
// text is OCR of an Internet Archive scan, not a transcription — the build
// notes and README in tools/zwingli/ say what that costs.

import { installPieceBundle } from './pieceBundleImport';

export const ZWINGLI_TITLE = 'Huldrych Zwingli — Selected Works';

export function installZwingli(onProgress: (msg: string) => void): Promise<number> {
  return installPieceBundle(
    {
      title: ZWINGLI_TITLE,
      bundleUrl: '/library/reformation/zwingli.json',
      category: 'reformation',
      label: 'Zwingli selected works',
    },
    onProgress,
  );
}
