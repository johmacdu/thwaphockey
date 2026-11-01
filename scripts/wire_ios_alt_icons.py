#!/usr/bin/env python3
"""Wire the 20 selectable iOS app icons into the asset catalog.

Apple rejected build 1 (ITMS-90032) because Info.plist listed 20 loose
CFBundleAlternateIcons PNGs that were never added to the Xcode target, so none
shipped in the bundle. Asset-catalog alternate icons fix that, and also give
iPad its 152/167 sizes (ITMS-90890/90892) from one 1024 image.

This writes ios/App/App/Assets.xcassets/AltIcon-<Skill><Color>.appiconset/
(light + dark 1024 + Contents.json), drawn with the SAME square() logic, art,
colours and dark tint as scripts/gen_app_icons.py, so they match the picker
previews exactly. The appiconset name is what setAlternateIconName() uses.
"""
import os, json
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = [('hands', 'Hands', 'login/sass-dangle.webp'), ('shooting', 'Shooting', 'login/sass-slapshot.webp'),
          ('passing', 'Passing', 'login/sass-pass.webp'), ('dryland', 'Dryland', 'login/sass-power.webp')]
COLORS = [('green', 'Green', '#8FD65E'), ('blue', 'Blue', '#75B8FF'), ('orange', 'Orange', '#FF9D4D'),
          ('purple', 'Purple', '#7A5AF0'), ('pink', 'Pink', '#EC4E9B')]
INK = (0x15, 0x22, 0x1B)
DARK_T = 0.45

def hx(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def dark_rgb(bg): return tuple(round(c * (1 - DARK_T) + i * DARK_T) for c, i in zip(bg, INK))

def square(bg, pose, size, fill=0.78):
    base = Image.new('RGB', (size, size), bg)
    p = Image.open(os.path.join(ROOT, pose)).convert('RGBA'); s = (size * fill) / max(p.size)
    p = p.resize((max(1, int(p.width * s)), max(1, int(p.height * s))))
    base.paste(p, ((size - p.width) // 2, (size - p.height) // 2), p); return base

CAT = os.path.join(ROOT, 'ios', 'App', 'App', 'Assets.xcassets')
CONTENTS = {
    'images': [
        {'filename': 'icon-light.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
        {'appearances': [{'appearance': 'luminosity', 'value': 'dark'}],
         'filename': 'icon-dark.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
    ],
    'info': {'author': 'xcode', 'version': 1},
}
names = []
for sid, slabel, pose in SKILLS:
    for cid, clabel, chex in COLORS:
        name = f'AltIcon-{slabel}{clabel}'
        d = os.path.join(CAT, name + '.appiconset'); os.makedirs(d, exist_ok=True)
        bg = hx(chex)
        square(bg, pose, 1024).save(os.path.join(d, 'icon-light.png'))      # RGB: no alpha, as Apple requires
        square(dark_rgb(bg), pose, 1024).save(os.path.join(d, 'icon-dark.png'))
        with open(os.path.join(d, 'Contents.json'), 'w') as f:
            json.dump(CONTENTS, f, indent=2); f.write('\n')
        names.append(name)
print(' '.join(names))
