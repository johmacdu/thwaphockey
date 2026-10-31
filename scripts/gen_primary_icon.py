#!/usr/bin/env python3
"""Generate the Thwap Hockey DEFAULT app icon (iPhone + Android) from the approved master.

Art: Sass stickhandling (login/sass-dangle.webp) zoomed out on Thwap lime #B9F06B.

Inputs:
  app-icons/primary/thwap-icon-1024.png   approved master (1024 square, opaque). Source of truth
                                          for the iPhone icon and the Android legacy squares.
  login/sass-dangle.webp                  Sass cutout (with transparency) for the Android
                                          adaptive foreground layer.

Outputs:
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024, opaque, no alpha
  android .../res/mipmap-<dens>/ic_launcher.png                      legacy square (48..192)
  android .../res/mipmap-<dens>/ic_launcher_round.png                legacy round (48..192)
  android .../res/mipmap-<dens>/ic_launcher_foreground.png           adaptive fg (108..432)
  android .../res/values/ic_launcher_background.xml                  lime background color

The 20 selectable alternates (scripts/gen_app_icons.py) are separate and untouched.
Usage: python3 scripts/gen_primary_icon.py            (needs Pillow)
       python3 scripts/gen_primary_icon.py --master   (also rebuild the master from the webp)
"""
import math, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIME_HEX = '#B9F06B'
LIME = tuple(int(LIME_HEX[i:i + 2], 16) for i in (1, 3, 5))
POSE = os.path.join(ROOT, 'login', 'sass-dangle.webp')
MASTER = os.path.join(ROOT, 'app-icons', 'primary', 'thwap-icon-1024.png')
IOS_ICON = os.path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png')
ARES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
LEG = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FGD = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}
SAFE = 33 / 108      # adaptive safe zone: 66dp circle on the 108dp canvas, as a radius fraction
MARGIN = 0.96        # stay a little inside the safe circle


def build_master():
    """Mirror of the approved composition: Sass 820px wide, centered, shifted up 2%."""
    base = Image.new('RGB', (1024, 1024), LIME)
    p = Image.open(POSE).convert('RGBA')
    w = 820; h = round(p.height * w / p.width)
    p = p.resize((w, h), Image.LANCZOS)
    base.paste(p, ((1024 - w) // 2, round(512 - 0.48 * h)), p)
    return base


def foreground(size):
    """Sass on transparent, every visible pixel inside the adaptive safe circle."""
    p = Image.open(POSE).convert('RGBA')
    p = p.crop(p.getchannel('A').point(lambda a: 255 if a > 16 else 0).getbbox())
    a = p.getchannel('A'); cx, cy = p.width / 2, p.height / 2
    px = a.load(); far = 0.0
    for y in range(0, p.height, 2):
        for x in range(0, p.width, 2):
            if px[x, y] > 16:
                far = max(far, math.hypot(x - cx, y - cy))
    s = (size * SAFE * MARGIN) / far
    p = p.resize((max(1, round(p.width * s)), max(1, round(p.height * s))), Image.LANCZOS)
    out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    out.alpha_composite(p, ((size - p.width) // 2, (size - p.height) // 2))
    return out


def round_icon(master, size):
    sq = master.resize((size * 4, size * 4), Image.LANCZOS).convert('RGBA')
    mask = Image.new('L', sq.size, 0); ImageDraw.Draw(mask).ellipse((0, 0, sq.width - 1, sq.height - 1), fill=255)
    sq.putalpha(mask)
    return sq.resize((size, size), Image.LANCZOS)


def main():
    if '--master' in sys.argv or not os.path.exists(MASTER):
        os.makedirs(os.path.dirname(MASTER), exist_ok=True); build_master().save(MASTER)
    master = Image.open(MASTER).convert('RGB')  # drop any alpha: Apple rejects it
    assert master.size == (1024, 1024), master.size
    master.save(IOS_ICON)
    for dens, px in LEG.items():
        d = os.path.join(ARES, f'mipmap-{dens}')
        master.resize((px, px), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'))
        round_icon(master, px).save(os.path.join(d, 'ic_launcher_round.png'))
    for dens, px in FGD.items():
        foreground(px).save(os.path.join(ARES, f'mipmap-{dens}', 'ic_launcher_foreground.png'))
    with open(os.path.join(ARES, 'values', 'ic_launcher_background.xml'), 'w') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                f'    <color name="ic_launcher_background">{LIME_HEX}</color>\n</resources>\n')
    print('primary icon written')


if __name__ == '__main__':
    main()
