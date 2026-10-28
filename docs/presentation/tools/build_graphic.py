"""Builds the graphic PDF as one sharp image per page (fast in every viewer; text is not selectable).

Chrome-printed PDFs keep the CSS gradients as vectors, which Chromium-based viewers (Chrome, Opera, Edge) redraw slowly.

Usage: python3 build_graphic.py <dir with slide-N.png> <out.pdf>
"""
import sys, io
from pathlib import Path
import fitz
from PIL import Image

src, out = Path(sys.argv[1]), sys.argv[2]
PAGE_W, PAGE_H = 841.89, 595.28   # A4 landscape in points
doc = fitz.open()
files = sorted(src.glob('slide-*.png'), key=lambda f: int(f.stem.split('-')[1]))
for f in files:
    buf = io.BytesIO()
    Image.open(f).convert('RGB').save(buf, 'JPEG', quality=92, subsampling=0, optimize=True)  # 4:4:4 keeps text edges clean
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    page.insert_image(page.rect, stream=buf.getvalue())
doc.set_metadata({'title': 'Immersa - Unreal Engine Meetup'})
doc.save(out, garbage=3, deflate=True)
print(out, len(files), 'pages')
