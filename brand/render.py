"""Lemma icon rasterizer: SVG geometry -> PNG multi-size (Pillow, same source as brand/icon.svg)."""
from PIL import Image, ImageDraw
import os

S = 1024
img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

k = S / 512
def p(v): return int(v * k)

top = (26, 26, 46); bot = (15, 15, 35)
grad = Image.new("RGBA", (S, S))
gd = ImageDraw.Draw(grad)
for y in range(S):
    t = y / S
    c = tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)) + (255,)
    gd.line([(0, y), (S, y)], fill=c)
mask = Image.new("L", (S, S), 0)
md = ImageDraw.Draw(mask)
md.rounded_rectangle([p(16), p(16), p(496), p(496)], radius=p(112), fill=255)
img.paste(grad, (0, 0), mask)

ink_top = (232, 232, 240); ink_bot = (184, 184, 208)
ink = Image.new("RGBA", (S, S))
idr = ImageDraw.Draw(ink)
for y in range(S):
    t = y / S
    c = tuple(int(ink_top[i] + (ink_bot[i] - ink_top[i]) * t) for i in range(3)) + (255,)
    idr.line([(0, y), (S, y)], fill=c)
m2 = Image.new("L", (S, S), 0)
m2d = ImageDraw.Draw(m2)
lam = [(168,108),(232,108),(316,330),(348,376),(364,388),(388,392),
       (388,444),(340,444),(292,440),(268,412),(244,384),(228,344)]
m2d.polygon([(p(x), p(y)) for x, y in lam], fill=255)
img.paste(ink, (0, 0), m2)

acc = (16, 163, 127)
slash = [(300,128),(372,128),(300,340),(284,300),(268,264)]
overlay = Image.new("RGBA", (S, S), (0, 0, 0, 0))
od = ImageDraw.Draw(overlay)
od.polygon([(p(x), p(y)) for x, y in slash], fill=acc + (255,))
img = Image.alpha_composite(img, overlay)

line = Image.new("RGBA", (S, S), (0, 0, 0, 0))
ld = ImageDraw.Draw(line)
ld.rounded_rectangle([p(140), p(452), p(372), p(462)], radius=p(5), fill=acc + (150,))
img = Image.alpha_composite(img, line)

os.makedirs("brand/png", exist_ok=True)
img.save("brand/png/icon-1024.png")
for size in (512, 256, 128, 64, 32):
    img.resize((size, size), Image.LANCZOS).save(f"brand/png/icon-{size}.png")
print("icons written")
