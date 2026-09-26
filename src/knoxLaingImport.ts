// Dedicated, fixed-schema importer for "The Works of John Knox", collected
// and edited by David Laing (Edinburgh, 1846–64, six volumes). Deliberately
// NOT routed through importer.ts's format sniffing: the input is a known
// bundle produced by tools/knox/laing.mjs.
//
// SCOPE. The whole edition: the History of the Reformation (Books I–V) with
// Laing's appendices, the treatises, letters and liturgical works of Vols.
// III–VI, and Laing's Vol. VI Preface. Separate from "Works of John Knox,
// Selected" (knoxImport.ts), which is the modern-spelling reading text of the
// History, Confession, Discipline and First Blast; this is the scholarly
// edition in Knox's own spelling.
//
// SHAPE. One `books` row per volume; each work in it is a piece. Mechanics
// shared with Zwingli, Bullinger and Knox's Selected Works — see
// pieceBundleImport.ts.
//
// LICENCE. Published in Edinburgh, 1846–64: public domain. Vols. III–VI are
// OCR of Internet Archive scans, not a transcription — see tools/knox/README.md.

import { installPieceBundle } from './pieceBundleImport';

export const KNOX_LAING_TITLE = 'Works of John Knox, ed. David Laing (1846–64)';

export function installKnoxLaing(onProgress: (msg: string) => void): Promise<number> {
  return installPieceBundle(
    {
      title: KNOX_LAING_TITLE,
      bundleUrl: '/library/reformation/knox-laing.json',
      category: 'reformation',
      label: 'Knox Works (Laing)',
    },
    onProgress,
  );
}
