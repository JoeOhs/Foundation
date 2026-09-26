// Shared DjVu-XML page reading for the OCR'd Library builds (tools/bullinger,
// tools/knox). Internet Archive's DjVu XML carries each word's box on the
// page; these helpers read a page line by line, cut margin notes by position,
// measure each line's face against the body text (footnotes are smaller), and
// join a paragraph's lines.

export const dec = (s) => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
export const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1] ?? 0; };
export const norm = (s) => s.replace(/\s+/g, ' ').trim();
export const isHeading = (s) => s.length <= 110 && /[A-Z]{3}/.test(s) && (s.match(/[a-z]/g) ?? []).length <= 2;
// One page's lines with the margin notes removed. The column is the median
// left and right edge of the page's full lines; a word wholly outside it is
// a margin note (printed sidenotes, scripture references), whether the OCR
// gave it a block of its own or ran it into a
// body line.
export function readPage(pageXml, height) {
  const lines = [...pageXml.matchAll(/<LINE>([\s\S]*?)<\/LINE>/g)].map((line) =>
    [...line[1].matchAll(/<WORD coords="(\d+),(\d+),(\d+),(\d+)[^>]*>([^<]*)<\/WORD>/g)]
      .map((w) => ({ x0: +w[1], bottom: +w[2], x1: +w[3], top: +w[4], t: dec(w[5]) }))
      .filter((w) => w.t.trim()))
    .filter((l) => l.length);
  const full = lines.filter((l) => l.length >= 6);
  const margins = [];
  let kept = lines;
  if (full.length >= 5) {
    const left = median(full.map((l) => l[0].x0));
    const right = median(full.map((l) => l.at(-1).x1));
    kept = lines.map((l) => l.filter((w) => {
      const inside = w.x1 >= left - 15 && w.x0 <= right + 12;
      if (!inside) margins.push(w.t);
      return inside;
    })).filter((l) => l.length);
  }
  const bodyH = median(full.filter((l) => l[0].top < height * 0.7).flatMap((l) => l.map((w) => w.bottom - w.top)));
  return {
    margins,
    lines: kept.map((l) => ({
      x0: l[0].x0,
      top: l[0].top,
      text: norm(l.map((w) => w.t).join(' ')),
      ratio: l.length >= 3 && bodyH ? median(l.map((w) => w.bottom - w.top)) / bodyH : 1,
    })),
  };
}

// Joins a paragraph's lines, closing up words the compositor hyphenated at
// the line end, and strips the OCR's footnote markers ("then®", "flesh®.”").
// ponytail: every line-end hyphen is closed up, so a genuine compound broken
// at its hyphen ("lively-/expressed") loses it; a dictionary check is the upgrade.
export function joinLines(lines) {
  return lines.map((l) => l.replace(/^[•;:\-'](?=[a-z])/, ''))
    .reduce((acc, l) => (/[a-z]-$/.test(acc) ? acc.slice(0, -1) + l : `${acc} ${l}`))
    .replace(/(\S)[®*^†‡§¹²³⁴⁵⁶⁷⁸⁹]+(?=[\s.,;:!?”’"']|$)/g, '$1')
    .replace(/\s[*†‡§^•®]+(?=\s|$)/g, '')
    .replace(/\s+([;:,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
