"""Build a side-by-side review page: each diagram's scan crop beside its outline.

    python structure-review.py genesis:"1. Genesis" exodus:"2. Exodus" ...

Writes ocr-cache/structure-review/index.html (gitignored). Flagged diagrams
come first. Ticks are kept in the browser; "Copy list" gives the ticked ones.
"""
import contextlib
import html
import importlib.util
import io
import os
import re
import sys

import pymupdf

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'ocr-cache', 'structure-review')
spec = importlib.util.spec_from_file_location('bar', os.path.join(HERE, 'bar-check.py'))
bar = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bar)
K = 72 / 300


def diagrams(slug):
    out, d = [], None
    with open(os.path.join(HERE, slug + '.structure.txt'), encoding='utf8') as f:
        for line in f:
            line = line.rstrip()
            if line.startswith('[[diagram'):
                d = {'title': line[11:-2], 'page': 1, 'rows': []}
                out.append(d)
            m = re.match(r'\[\[pdf-page: (\d+)', line)
            if m and d:
                d['page'] = int(m[1])
            m = re.match(r'( *)(\S+) \| ([^|]*) \|\s?(.*)', line)
            if m and d and not line.startswith('#'):
                d['rows'].append((len(m[1]) // 2, m[2], m[3], m[4]))
    return out


def build(slug, name, cards):
    os.makedirs(OUT, exist_ok=True)
    pdf = pymupdf.open(os.path.join(HERE, 'thecompanionbible_202504_pdf', name + '_text.pdf'))
    book = bar.pages(os.path.join(HERE, 'thecompanionbible_202504', name + '_hocr.html'))
    images = {}
    for n, d in enumerate(diagrams(slug)):
        p = d['page']
        img = images.setdefault(p, pdf[p - 1].get_pixmap(dpi=300, colorspace=pymupdf.csGRAY))
        after, left, seen, rows = 0, 1400, [], []
        for depth, label, _, text in d['rows']:
            found = bar.row_x(book[p - 1], text, img, after, left) if text else None
            x = None
            if found:
                x, after, left = found
                seen.append((after, left))
            rows.append((depth, x, label, text))
        with contextlib.redirect_stdout(io.StringIO()) as o:
            flags = bar.check(rows, d['title'], p)
        r = pdf[p - 1].rect
        if len(seen) >= 2:
            ys = [y for y, _ in seen]
            x0 = 1230 if min(x for _, x in seen) > 1250 else 150
            clip = pymupdf.Rect(x0, min(ys) - 130, 2420, max(ys) + 130) * K & r
        else:
            clip = r
        name_ = f'{slug}-{n:03d}.jpg'
        pdf[p - 1].get_pixmap(dpi=125, clip=clip).save(os.path.join(OUT, name_))
        lines = ''.join(f'<div style="margin-left:{dp * 18}px"><b>{html.escape(l)}</b> '
                        f'<i>{html.escape(ref)}</i> {html.escape(t)}</div>'
                        for dp, l, ref, t in d['rows'])
        ident = f'{slug} {n}: {d["title"]}'
        cards.append((-flags, f'<section data-id="{html.escape(ident, True)}"><h3><label><input type=checkbox> '
                      f'wrong</label> {html.escape(slug)} p{p} · {html.escape(d["title"])}'
                      f'{" · " + str(flags) + " flags" if flags else ""}</h3>'
                      f'<div class=r><img loading=lazy src="{name_}"><div>{lines}</div></div></section>'))


def main():
    cards = []
    for arg in sys.argv[1:]:
        build(*arg.split(':', 1), cards)
    cards.sort(key=lambda c: c[0])
    page = '''<!doctype html><meta charset=utf8><title>Structure review</title><style>
body{font:15px Georgia,serif;margin:16px}section{border-top:1px solid #999;padding:8px 0}
h3{font:600 14px sans-serif}.r{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}
img{max-width:60%}</style><p><button id=c>Copy list</button> <span id=n></span></p>''' + ''.join(c[1] for c in cards) + '''
<script>const K='structure-review';let S=[];try{S=JSON.parse(localStorage[K]||'[]')}catch(e){}
const B=[...document.querySelectorAll('section')];const u=()=>{S=B.filter(b=>b.querySelector('input').checked).map(b=>b.dataset.id);
try{localStorage[K]=JSON.stringify(S)}catch(e){}n.textContent=S.length+' marked of '+B.length};
B.forEach(b=>{const i=b.querySelector('input');i.checked=S.includes(b.dataset.id);i.onchange=u});u();
c.onclick=()=>navigator.clipboard.writeText(S.join('\n'))</script>'''
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf8') as f:
        f.write(page)
    print(len(cards), 'diagrams,', sum(1 for c in cards if c[0]), 'flagged')


if __name__ == '__main__':
    main()
