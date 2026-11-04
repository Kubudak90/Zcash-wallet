#!/usr/bin/env python3
"""Contact sheet of stills with their timestamps: sheet.py out.png frame1.png frame2.png ...
The time is read from the file name (…tNN.NN.png). 2 columns, 960 px wide cells, so details stay legible."""
import re
import sys

from PIL import Image, ImageDraw, ImageFont

out, files = sys.argv[1], sys.argv[2:]
CELL_W = 960
cols = 2 if len(files) > 1 else 1
ims = []
for f in files:
    im = Image.open(f).convert('RGB')
    h = round(im.height * CELL_W / im.width)
    ims.append((f, im.resize((CELL_W, h), Image.LANCZOS)))
rows = (len(ims) + cols - 1) // cols
cell_h = ims[0][1].height
pad, label_h = 10, 30
sheet = Image.new('RGB', (cols * CELL_W + (cols + 1) * pad, rows * (cell_h + label_h) + (rows + 1) * pad), (48, 48, 48))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', 20)
except OSError:
    font = ImageFont.load_default()
for i, (f, im) in enumerate(ims):
    x = pad + (i % cols) * (CELL_W + pad)
    y = pad + (i // cols) * (cell_h + label_h + pad)
    m = re.search(r't([\d.]+)\.png$', f)
    draw.text((x + 4, y + 3), f't = {float(m.group(1)):.2f}s' if m else f, fill=(255, 210, 90), font=font)
    sheet.paste(im, (x, y + label_h))
sheet.save(out)
