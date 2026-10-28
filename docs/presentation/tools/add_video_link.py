"""Makes the video box of slide 4 clickable: a link that opens Immersa-Demo.mp4 from the PDF's own folder.

Run it on both PDFs after regenerating them (the video itself is not in the repo or in the PDF).

Usage: python3 add_video_link.py <pdf> [<pdf> ...]   (edited in place)
"""
import sys
import fitz

NAME = 'Immersa-Demo.mp4'
SLIDE = 3
# The dashed video box as fractions of the page (measured on the rendered slide).
BOX = (0.0752, 0.209, 0.925, 0.904)

for path in sys.argv[1:]:
    doc = fitz.open(path)
    page = doc[SLIDE]
    w, h = page.rect.width, page.rect.height
    page.insert_link({'kind': fitz.LINK_URI, 'from': fitz.Rect(BOX[0] * w, BOX[1] * h, BOX[2] * w, BOX[3] * h), 'uri': NAME})
    doc.saveIncr()
    print(path, 'link ->', NAME)
