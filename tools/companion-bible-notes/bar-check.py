"""Check Structure indentation against the printed position of each row.

    python bar-check.py <slug> "<N. Book>_hocr.html"

Each row is found in the HOCR by its text; its x is the last vertical bar
printed left of its text, measured in the page scan (300 dpi). Within a diagram a deeper row
must print further right than the shallower row before it, a shallower row
further left, and neighbours at one depth must line up. Rows not found count as unknown, never as passed. Every
flag is a prompt to look at the scan: top-level pairs are siblings whatever
their x (see the skill, Step 2).
"""
import difflib
import html
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TOLERANCE = 6
SAME_DEPTH_DRIFT = 24
NEXT_ROW = 90  # px; a diagram's rows follow closely down the page
BAR_WIDTH = 5
BAR_HEIGHT = 24  # single-row bars; the small reference digits are shorter


def pages(path):
    with open(path, encoding='utf8', errors='ignore') as f:
        src = f.read().replace('"', "'")
    out = []
    for page in re.split(r"(?=<div class='ocr_page)", src)[1:]:
        lines = []
        for chunk in re.split(r"(?=<span class='ocr_(?:line|caption|header|textfloat))", page)[1:]:
            words = [(html.unescape(re.sub('<[^>]+>', '', t)).strip(), int(x), int(y), int(z))
                     for x, y, z, t in re.findall(r"ocrx_word'[^>]*?title='bbox (\d+) (\d+) \d+ (\d+)[^>]*>(.*?)</span>", chunk, re.S)]
            if words:
                lines.append(words)
        out.append(lines)
    return out


def row_x(lines, text, page, after, left):
    """x of the last bar printed left of the row's text, measured in the scan."""
    keys = [k.lower() for k in re.findall(r'[A-Za-z]{4,}', re.sub(r'^[\d. ,—-]+', '', text))[:3]]
    if not keys:
        return None
    words = [w for line in lines for w in line]
    like = lambda k, w: difflib.SequenceMatcher(None, k, w[0].lower()).ratio() > .74
    candidates = sorted((w for w in words if like(keys[0], w) and w[2] > after - 6),
                        key=lambda w: (w[2] > after + NEXT_ROW, abs(w[1] - left) > 500, w[2]))
    for word in candidates:
        same_row = [w for w in words if abs(w[2] - word[2]) < 14 and 0 <= w[1] - word[1] < 900]
        if all(any(like(k, w) for w in same_row) for k in keys[1:]):
            x = last_bar(page, word[1], word[2], word[3])
            if x is not None:
                return x, word[2], word[1]
    return None


def last_bar(page, right, top, bottom):
    """Nearest thin rule left of the text: taller than the reference digits,
    and only a few pixels wide, unlike a digit's stem with its serifs."""
    b, s = page.samples, page.stride
    dark = lambda x, y: b[y * s + x] < 150
    for x in range(right - 3, max(right - 330, 3), -1):
        start = run = 0
        for y in range(top - 6, bottom + 8):
            if dark(x, y):
                run += 1
                if run >= BAR_HEIGHT:
                    break
            else:
                run = 0
        if run < BAR_HEIGHT:
            continue
        rows = range(y - run + 1, y + 1)
        widest = max(sum(dark(x + d, r) for d in range(-5, 6)) for r in rows)
        if widest <= BAR_WIDTH:
            return x
    return None


def check(rows, title, page):
    flags = 0
    known = [r for r in rows if r[1] is not None]
    for (d1, x1, l1, _), (d2, x2, l2, t2) in zip(known, known[1:]):
        if min(d1, d2) == 0:
            continue  # top-level members are siblings whatever their x
        bad = ((d2 > d1 and x2 <= x1 + TOLERANCE) or (d2 < d1 and x2 >= x1 - TOLERANCE)
               or (d2 == d1 and abs(x2 - x1) > SAME_DEPTH_DRIFT))
        if bad:
            flags += 1
            print(f'  p{page} {title[:44]}: {l1}(d{d1} x{x1}) -> {l2}(d{d2} x{x2}) {t2[:28]}')
    return flags


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    import pymupdf
    slug, hocr = sys.argv[1:]
    pdf = pymupdf.open(os.path.join(HERE, 'thecompanionbible_202504_pdf', hocr.replace('_hocr.html', '_text.pdf')))
    images = {}
    book = pages(os.path.join(HERE, 'thecompanionbible_202504', hocr))
    page, title, rows = 1, '', []
    after, left = 0, 1400
    total = unknown = flags = 0
    with open(os.path.join(HERE, slug + '.structure.txt'), encoding='utf8') as f:
        for line in f:
            line = line.rstrip()
            if line.startswith('[[diagram'):
                flags += check(rows, title, page)
                rows, title = [], line[11:-2]
                after, left = 0, 1400
            m = re.match(r'\[\[pdf-page: (\d+)', line)
            if m:
                page = int(m[1])
            m = re.match(r'( *)(\S+) \| [^|]* \| (.+)', line)
            if m and not line.startswith('#'):
                if page not in images:
                    images[page] = pdf[page - 1].get_pixmap(dpi=300, colorspace=pymupdf.csGRAY)
                found = row_x(book[page - 1], m[3], images[page], after, left)
                x = None
                if found:
                    x, after, left = found
                total += 1
                unknown += x is None
                rows.append((len(m[1]) // 2, x, m[2], m[3]))
    flags += check(rows, title, page)
    print(f'{slug}: {total} rows, {unknown} unknown, {flags} flags')


if __name__ == '__main__':
    main()
