// Dedicated, fixed-schema importer for John Knox's writings. Deliberately NOT
// routed through importer.ts's format sniffing: the input is a known bundle
// produced by tools/knox/build.mjs.
//
// SCOPE. A selection (Laing's complete Works is its own entry,
// knoxLaingImport.ts): the History of the Reformation in Scotland, Books I–IV, the
// Scots Confession and the First Book of Discipline (all 1560, in Cuthbert
// Lennox's modernised-spelling edition, 1905), and The First Blast of the
// Trumpet (1558, original spelling, ed. Edward Arber, 1878) with Knox's 1559
// letters defending it. Editors' introductions and footnotes are excluded.
//
// SHAPE. One `books` row per work; each History book, Confession chapter,
// Discipline head and Blast part is a piece. Mechanics shared with Zwingli —
// see pieceBundleImport.ts.
//
// LICENCE. Published in London, 1878 and 1905: public domain in the US. See
// tools/knox/build.mjs for the sources considered and not used.

import { installPieceBundle } from './pieceBundleImport';

export const KNOX_TITLE = 'John Knox — Selected Works';

export function installKnox(onProgress: (msg: string) => void): Promise<number> {
  return installPieceBundle(
    {
      title: KNOX_TITLE,
      bundleUrl: '/library/reformation/knox.json',
      category: 'reformation',
      label: 'Knox selected works',
    },
    onProgress,
  );
}
