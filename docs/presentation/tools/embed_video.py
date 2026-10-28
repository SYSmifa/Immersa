"""Embeds the demo video in the video slide (slide 4) of a presentation PDF.

Acrobat plays it with a click on the box (embedded Screen annotation with a rendition);
every other viewer gets a link under the box that opens Immersa-Demo.mp4 from the PDF's folder.
The video is not in the repo: pass the compressed MP4 (H.264, ~40 MB).

Usage: python3 embed_video.py <in.pdf> <video.mp4> <out.pdf> [slide_index=3]
"""
import sys, os
import fitz

src, video, out = sys.argv[1:4]
IDX = int(sys.argv[4]) if len(sys.argv) > 4 else 3
NAME = 'Immersa-Demo.mp4'

doc = fitz.open(src)
page = doc[IDX]
W, H = page.rect.width, page.rect.height

# The dashed video box of the slide, as fractions of the page (measured on the rendered slide).
bx0, bx1, by0, by1 = 0.0752 * W, 0.925 * W, 0.209 * H, 0.904 * H
play = fitz.Rect(bx0, by0, bx1, by1 - 42)      # click area: the box without the caption strip
strip = fitz.Rect(bx0 + 120, by1 - 38, bx1 - 120, by1 - 12)

# Caption under the play button (drawn on the page, so it also shows in non-Acrobat viewers).
page.insert_textbox(strip, 'Se il video non parte, apri il file Immersa-Demo.mp4 (stessa cartella del PDF)',
                    fontname='helv', fontsize=9.5, color=(0.61, 0.64, 0.72), align=fitz.TEXT_ALIGN_CENTER)
page.insert_link({'kind': fitz.LINK_URI, 'from': strip, 'uri': NAME})

data = open(video, 'rb').read()
x_file = doc.get_new_xref(); doc.update_object(x_file, f'<< /Type /EmbeddedFile /Subtype /video#2Fmp4 /Params << /Size {len(data)} >> >>')
doc.update_stream(x_file, data, compress=False)
x_spec = doc.get_new_xref()
doc.update_object(x_spec, f'<< /Type /Filespec /F ({NAME}) /UF ({NAME}) /Desc (Video demo Immersa) /EF << /F {x_file} 0 R /UF {x_file} 0 R >> >>')
x_rend = doc.get_new_xref()
doc.update_object(x_rend, f'<< /Type /Rendition /S /MR /N (Demo) /C << /Type /MediaClip /S /MCD /N (Demo) /CT (video/mp4) '
                  f'/D {x_spec} 0 R /P << /TF (TEMPACCESS) >> >> /P << /BE << /C true >> >> >>')

r = play * ~page.transformation_matrix  # to PDF user space (origin bottom-left)
x_annot = doc.get_new_xref()
doc.update_object(x_annot, f'<< /Type /Annot /Subtype /Screen /Rect [{r.x0:.2f} {r.y0:.2f} {r.x1:.2f} {r.y1:.2f}] /F 4 /T (Demo) '
                  f'/P {page.xref} 0 R /MK << /BC [0 0 0] >> /A << /Type /Action /S /Rendition /OP 0 /R {x_rend} 0 R /AN {x_annot} 0 R >> >>')
annots = doc.xref_get_key(page.xref, 'Annots')
if annots[0] == 'array':
    doc.xref_set_key(page.xref, 'Annots', annots[1].rstrip(']') + f' {x_annot} 0 R]')
elif annots[0] == 'xref':
    ax = int(annots[1].split()[0])
    doc.update_object(ax, doc.xref_object(ax).rstrip().rstrip(']') + f' {x_annot} 0 R]')
else:
    doc.xref_set_key(page.xref, 'Annots', f'[{x_annot} 0 R]')

doc.save(out, garbage=3, deflate=True)
print(out, round(os.path.getsize(out) / 1e6, 1), 'MB')
