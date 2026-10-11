// Dedicated, fixed-schema importer for "The Works of William Tyndale",
// Vol. I: Doctrinal Treatises and Introductions to Different Portions of the
// Holy Scriptures, edited by Henry Walter for the Parker Society (Cambridge,
// 1848). Deliberately NOT routed through importer.ts's format sniffing: the
// input is a known bundle produced by tools/tyndale/build.mjs.
//
// SCOPE. Vol. I only: A Pathway into the Holy Scripture, the Parable of the
// Wicked Mammon, the Obedience of a Christian Man, the Brief Declaration of
// the Sacraments, and Tyndale's prologues to the books of the Bible, with
// Walter's Biographical Notice and his introductory notice to each work.
// The title carries the volume, so the Library never reads as if it held
// the whole three-volume set; Vols. II–III are assessed in ROADMAP.md.
//
// SHAPE. One `books` row per group (Biographical Notice; Doctrinal
// Treatises; Addresses and Old Testament prologues; New Testament
// prologues); each work is a piece. Tyndale's printed marginal notes ride on
// entries.heading beside the paragraph they sit against. Mechanics shared
// with Zwingli, Bullinger and Knox — see pieceBundleImport.ts.
//
// LICENCE. Published in Cambridge, 1848: public domain. The body text is
// OCR of the University of Toronto's scan on the Internet Archive
// (doctrinaltreatis00tynduoft), read afresh per page; the marginal notes
// were transcribed and proofread against that scan. See
// tools/tyndale/README.md.

import { installPieceBundle } from './pieceBundleImport';

export const TYNDALE_VOL1_TITLE = 'Works of William Tyndale, Vol. I: Doctrinal Treatises (ed. Walter, 1848)';

export function installTyndaleVol1(onProgress: (msg: string) => void): Promise<number> {
  return installPieceBundle(
    {
      title: TYNDALE_VOL1_TITLE,
      bundleUrl: '/library/reformation/tyndale-vol1.json',
      category: 'reformation',
      label: 'Tyndale Works, Vol. I',
    },
    onProgress,
  );
}
