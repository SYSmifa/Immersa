"""Builds an editable PDF: slide backgrounds as images + one form field per text block.
Usage: python3 build.py <dir with bg-N.jpg and layout.json> <out.pdf>

Field appearances are written here (wrapping, alignment, bold) because MuPDF only
synthesizes them with regular Helvetica; viewers regenerate them from /DA when edited.
"""
import json
import sys
from pathlib import Path

import pymupdf

PAGE_W, PAGE_H = 841.89, 595.28  # A4 landscape, points
GRADIENT_COLOR = (0x7d / 255, 0xd3 / 255, 0xfc / 255)  # solid stand-in for the violet→emerald gradient
FONTS = {'Helv': ('Helvetica', pymupdf.Font('helv')), 'HeBo': ('Helvetica-Bold', pymupdf.Font('hebo'))}


def rgb(css):
    nums = css[css.index('(') + 1:css.index(')')].split(',')
    return tuple(int(n) / 255 for n in nums[:3])


def wrap(text, font, size, width):
    lines, cur = [], ''
    for word in text.split():
        cand = f'{cur} {word}'.strip()
        if cur and font.text_length(cand, size) > width:
            lines.append(cur)
            cur = word
        else:
            cur = cand
    return lines + [cur]


def pdf_str(s):
    out = []
    for b in s.encode('cp1252'):
        c = chr(b)
        out.append(f'\\{b:03o}' if b > 126 or c in '()\\' else c)
    return '(' + ''.join(out) + ')'


def appearance(text, font_key, size, color, rect, align, line_h, multiline):
    font = FONTS[font_key][1]
    w, h = rect.width, rect.height
    lines = wrap(text, font, size, w - 4) if multiline else [text]
    asc = size * 0.78
    pad_top = (line_h - size) / 2
    ops = [f'/Tx BMC q 0 0 {w:.2f} {h:.2f} re W n BT',
           '{:.4f} {:.4f} {:.4f} rg'.format(*color), f'/{font_key} {size:.2f} Tf']
    y = h - pad_top - asc if multiline else (h - size * 0.72) / 2
    prev_x = prev_y = 0
    for line in lines:
        lw = font.text_length(line, size)
        x = (w - lw) / 2 if align == 'center' else 2
        ops.append(f'{x - prev_x:.2f} {y - prev_y:.2f} Td {pdf_str(line)} Tj')
        prev_x, prev_y = x, y
        y -= line_h
    ops.append('ET Q EMC')
    return '\n'.join(ops).encode('latin-1')


def main(src, out):
    src = Path(src)
    slides = json.loads((src / 'layout.json').read_text())
    doc = pymupdf.open()
    fields = []
    for i, slide in enumerate(slides, 1):
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        page.insert_image(page.rect, filename=str(src / f'bg-{i}.jpg'))
        k = PAGE_W / slide['w']
        for j, it in enumerate(slide['items']):
            multiline = round(it['h'] / it['lineHeight']) > 1
            pad = it['size'] * 0.15
            w = pymupdf.Widget()
            w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT
            w.field_name = f's{i}_t{j}'
            w.field_value = it['text'].replace('\n', ' ')
            w.text_fontsize = round(it['size'] * k, 1)
            w.text_color = GRADIENT_COLOR if it['gradient'] else rgb(it['color'])
            w.fill_color = None
            w.border_width = 0
            w.border_color = None
            if multiline:
                w.field_flags = pymupdf.PDF_TX_FIELD_IS_MULTILINE
            w.rect = pymupdf.Rect((it['x'] - 2) * k, (it['y'] - pad) * k,
                                  (it['x'] + it['w'] + 2) * k, (it['y'] + it['h'] + pad) * k)
            page.add_widget(w)
            fields.append((w.xref, w, it, k, multiline))

    font_refs = {}
    for key, (base, _) in FONTS.items():
        x = doc.get_new_xref()
        doc.update_object(x, f'<< /Type /Font /Subtype /Type1 /BaseFont /{base} /Encoding /WinAnsiEncoding >>')
        font_refs[key] = x
    font_dict = '<< ' + ' '.join(f'/{k} {x} 0 R' for k, x in font_refs.items()) + ' >>'
    doc.xref_set_key(doc.pdf_catalog(), 'AcroForm/DR', f'<< /Font {font_dict} >>')

    for xref, w, it, k, multiline in fields:
        font_key = 'HeBo' if it['weight'] >= 600 else 'Helv'
        da = '{:.4f} {:.4f} {:.4f} rg /{} {} Tf'.format(*w.text_color, font_key, w.text_fontsize)
        parent = doc.xref_get_key(xref, 'Parent')
        targets = [xref] + ([int(parent[1].split()[0])] if parent[0] == 'xref' else [])
        for t in targets:
            doc.xref_set_key(t, 'DA', pymupdf.get_pdf_str(da))
            if it['align'] == 'center':
                doc.xref_set_key(t, 'Q', '1')
        ap = int(doc.xref_get_key(xref, 'AP/N')[1].split()[0])
        stream = appearance(w.field_value, font_key, w.text_fontsize, w.text_color, w.rect,
                            it['align'], it['lineHeight'] * k, multiline)
        doc.update_stream(ap, stream)
        doc.xref_set_key(ap, 'Resources', f'<< /Font {font_dict} >>')
    doc.save(out, garbage=3, deflate=True)


if __name__ == '__main__':
    main(*sys.argv[1:])
