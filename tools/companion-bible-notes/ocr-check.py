"""Cross-check a transcribed book against a fresh Tesseract OCR of its scans.

    python ocr-check.py <slug> "<N. Book>_text.pdf"

Renders every page of the book's _text.pdf at 300 and 400 dpi, OCRs each
with Tesseract (cached in ocr-cache/, gitignored), then reports:

  - words in <slug>.notes.txt / <slug>.structure.txt found in neither OCR
    run (typos, or Hebrew transliterations the OCR can't read);
  - numeric references ("13. 18", "Ap. 44") found in neither run, with the
    period/comma separator ignored, since Tesseract often reads "13." as
    "13," (measured on Joshua: ~1 number in 8).

Every flag is a prompt to look at the scan, never an automatic fix: the
OCR gets ~1 reference in 6 wrong, so absence from it proves nothing alone.

Needs: pip install pymupdf; Tesseract 5 (winget install UB-Mannheim.TesseractOCR).
"""
import os
import re
import shutil
import subprocess
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'ocr-cache')
TESSERACT = shutil.which('tesseract') or r'C:\Program Files\Tesseract-OCR\tesseract.exe'


def norm(t):
    t = unicodedata.normalize('NFKD', t)
    t = ''.join(c for c in t if not unicodedata.combining(c))
    t = t.replace('\u00e6', 'ae').replace('\u0153', 'oe')
    return re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', t)  # rejoin line-end hyphens


def ocr_book(pdf_name):
    import pymupdf
    pdf = os.path.join(HERE, 'thecompanionbible_202504_pdf', pdf_name)
    if not os.path.exists(pdf):
        sys.exit(f'no such PDF: {pdf}')
    if not os.path.exists(TESSERACT):
        sys.exit('Tesseract not found — winget install UB-Mannheim.TesseractOCR')
    out_dir = os.path.join(CACHE, os.path.splitext(pdf_name)[0])
    os.makedirs(out_dir, exist_ok=True)
    texts = []
    doc = pymupdf.open(pdf)
    for i, page in enumerate(doc):
        for dpi in (300, 400):
            base = os.path.join(out_dir, f'p{i:03d}_{dpi}')
            if not os.path.exists(base + '.txt'):
                page.get_pixmap(dpi=dpi, colorspace=pymupdf.csGRAY).save(base + '.png')
                r = subprocess.run([TESSERACT, base + '.png', base, '--psm', '4', '-l', 'eng'],
                                   capture_output=True)
                os.remove(base + '.png')
                if r.returncode != 0:
                    sys.exit(f'tesseract failed on page {i} at {dpi} dpi:\n{r.stderr.decode(errors="replace")}')
            with open(base + '.txt', encoding='utf8') as f:
                texts.append(f.read())
        print(f'\r  OCR page {i + 1}/{len(doc)}', end='', file=sys.stderr)
    print(file=sys.stderr)
    return norm('\n'.join(texts))


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    slug, pdf_name = sys.argv[1], sys.argv[2]
    ocr = ocr_book(pdf_name)
    ocr_words = {w.lower() for w in re.findall(r'[A-Za-z]+', ocr)}
    ocr_pairs = {f'{a} {b}' for line in ocr.splitlines()
                 for a, b in zip(re.findall(r'\d+', line), re.findall(r'\d+', line)[1:])}

    for kind in ('notes', 'structure'):
        path = os.path.join(HERE, f'{slug}.{kind}.txt')
        if not os.path.exists(path):
            continue
        missing_words, missing_refs = {}, []
        with open(path, encoding='utf8') as f:
            lines = f.read().splitlines()
        for n, line in enumerate(lines, 1):
            if line.lstrip().startswith('#') or line.startswith('[['):
                continue
            text = norm(line.split(' | ', 1)[1] if kind == 'notes' and ' | ' in line else line)
            for w in re.findall(r'[A-Za-z]+', text):
                if w.lower() not in ocr_words:
                    missing_words.setdefault(w.lower(), n)
            # references: "Book 13. 18" / "Ap. 44" — check each adjacent pair
            for m in re.finditer(r'\d+[.,]\s+\d+', text):
                pair = ' '.join(re.findall(r'\d+', m.group(0)))
                if pair not in ocr_pairs:
                    missing_refs.append((n, m.group(0)))
        print(f'\n{slug}.{kind}.txt')
        print(f'  words in neither OCR run ({len(missing_words)}):')
        print('   ', ' '.join(f'{w}@{n}' for w, n in sorted(missing_words.items(), key=lambda x: x[1])))
        print(f'  number pairs in neither OCR run ({len(missing_refs)}) — check against the scan:')
        for n, ref in missing_refs:
            print(f'    line {n}: {ref}')


if __name__ == '__main__':
    main()
