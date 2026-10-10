#!/usr/bin/env python3
"""Cut images/mascot-trash.png into the layers the animated login mascot uses.

Run from the repo root:  python3 scripts/build-mascot-layers.py
Needs Pillow and numpy. Writes images/mascot/*.webp at 768px.

Layers, bottom to top, as index.html stacks them:
  base   the picture with the hand, banana, pupils and mouth taken out
  head   the head again, so the scratching arm can pass behind it
  hand   hand and banana, which turn at the wrist for the bite
  tip    the top of the banana, hidden once it is bitten off
  fingers  the far hand's fingers on the banana, hidden while that hand scratches
  mouth  the mouth line, which moves when he chews

All coordinates are in the 1024px source image, the same units the SVG uses.
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SRC = 'images/mascot-trash.png'
OUT = 'images/mascot'
DARK = (15, 25, 23)
CREAM = (243, 246, 236)
GREY = (87, 93, 93)

# Hand and banana. The left edge is the wrist line, where hand meets forearm.
HAND = [(589, 632), (592, 600), (590, 560), (610, 525), (660, 520), (684, 535),
        (684, 420), (765, 420), (775, 555), (812, 575), (820, 700), (765, 720),
        (720, 745), (660, 772), (612, 772), (600, 735), (588, 712)]
# The far hand's two finger tips, wrapped round the banana
FINGERS = (730, 630, 765, 714)
# Rounded end for the forearm, seen when the hand turns away from it
WRIST_CAP = (558, 634, 614, 709)
# Pupils: (x0, y0, x1, y1, column of clean eye white to copy from)
PUPILS = [(492, 335, 531, 354, 485), (611, 335, 644, 352, 605)]
MOUTH = (498, 424, 644, 470)
# Everything above and left of the far arm's reach: head, ear and face
HEAD = (0, 0, 712, 520)


def bite_line(x):
    """Edge of the bite across the banana. Slopes so it sits level at the mouth."""
    return 447 + (x - 688) * 0.652 + 5 * math.sin((x - 688) / 69 * math.pi * 3)


def grow(mask, px):
    im = Image.fromarray((mask * 255).astype('uint8'))
    return np.array(im.filter(ImageFilter.MaxFilter(px * 2 + 1))) > 127


def poly_mask(points, size):
    im = Image.new('L', size, 0)
    ImageDraw.Draw(im).polygon(points, fill=255)
    return np.array(im) > 127


def layer(px, mask):
    """Pixels of px inside mask, with a soft edge."""
    a = Image.fromarray((mask * 255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2))
    out = px.copy()
    out[..., 3] = np.minimum(out[..., 3], np.array(a))
    return out


def save(arr, name):
    im = Image.fromarray(arr)
    # Resize with colour multiplied by alpha, so clear pixels do not tint edges
    half = im.convert('RGBa').resize((768, 768), Image.LANCZOS).convert('RGBA')
    path = os.path.join(OUT, name + '.webp')
    half.save(path, 'WEBP', quality=90, method=6)
    print('%-6s %6d bytes' % (name, os.path.getsize(path)))


def main():
    os.makedirs(OUT, exist_ok=True)
    src = Image.open(SRC).convert('RGBA')
    px = np.array(src)
    h, w = px.shape[:2]
    lum = px[..., :3].mean(-1)
    # Solid picture only. The backdrop's soft outer edge is pale and is not artwork.
    solid = ~grow(px[..., 3] < 250, 8)
    drawn = (lum > 45) & solid   # anything that is not outline or backdrop
    ys, xs = np.mgrid[0:h, 0:w]

    # Hand and banana, with a rim of outline so it reads over the face
    inside = poly_mask(HAND, (w, h))
    hand_all = grow(drawn & inside, 9) & inside
    cut = np.vectorize(bite_line)(np.arange(w))[None, :]
    tip = hand_all & (ys < cut) & (xs > 676) & (xs < 772) & (ys < 505)
    x0, y0, x1, y1 = FINGERS
    box = (xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)
    fingers = grow(drawn & box, 5) & box
    save(layer(px, tip), 'tip')
    save(layer(px, fingers), 'fingers')
    save(layer(px, hand_all & ~tip & ~fingers), 'hand')

    base = px.copy()
    base[grow(drawn & inside, 4) & grow(inside, 2)] = DARK + (255,)
    cap = Image.new('L', (w, h), 0)
    ImageDraw.Draw(cap).ellipse(WRIST_CAP, fill=255)
    base[np.array(cap) > 127] = GREY + (255,)

    for x0, y0, x1, y1, clean in PUPILS:
        base[y0:y1, x0:x1] = base[y0:y1, clean:clean + 1]

    x0, y0, x1, y1 = MOUTH
    ink = np.clip((235.0 - lum[y0:y1, x0:x1]) / 200.0, 0, 1)
    mouth = np.zeros_like(px)
    mouth[y0:y1, x0:x1, :3] = DARK
    mouth[y0:y1, x0:x1, 3] = (ink * 255).astype('uint8')
    save(mouth, 'mouth')
    box = np.zeros((h, w), bool)
    box[y0:y1, x0:x1] = lum[y0:y1, x0:x1] < 235
    base[grow(box, 2)] = CREAM + (255,)

    save(base, 'base')

    base_lum = base[..., :3].mean(-1)
    x0, y0, x1, y1 = HEAD
    head = grow((base_lum > 45) & solid, 14)
    head &= (xs >= x0) & (xs < x1) & (ys >= y0) & (ys < y1)
    save(layer(base, head), 'head')


if __name__ == '__main__':
    main()
