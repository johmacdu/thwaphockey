#!/usr/bin/env python3
"""Generate Thwap Hockey selectable app icons: 4 Sass skills x a color palette.
Outputs square, opaque, iOS-spec PNGs (no alpha, iOS applies the squircle mask):
  app-icons/preview/<skill>-<color>.png   (256px, for the in-app picker)
  ios/App/App/AltIcon-<Skill><Color>@2x.png (120)  + @3x.png (180)   iOS alternate icons
Re-run after editing SKILLS or COLORS. Sass art is the real mascot (login/sass-*.webp)."""
import os
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = [  # (id, Label, pose cutout)
    ('hands',    'Hands',    'login/sass-dangle.webp'),
    ('shooting', 'Shooting', 'login/sass-slapshot.webp'),
    ('passing',  'Passing',  'login/sass-pass.webp'),
    ('dryland',  'Dryland',  'login/sass-power.webp'),
]
COLORS = [  # (id, Label, hex)
    ('green',  'Green',  '#8FD65E'),
    ('blue',   'Blue',   '#75B8FF'),
    ('orange', 'Orange', '#FF9D4D'),
    ('purple', 'Purple', '#7A5AF0'),
    ('pink',   'Pink',   '#EC4E9B'),
]
def hx(h): h=h.lstrip('#'); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def icon(bg, pose, size):
    base = Image.new('RGB', (size, size), bg)          # opaque, fills to corners
    p = Image.open(os.path.join(ROOT, pose)).convert('RGBA')
    s = (size*0.78)/max(p.size); p = p.resize((max(1,int(p.width*s)), max(1,int(p.height*s))))
    base.paste(p, ((size-p.width)//2, (size-p.height)//2), p)
    return base
prev = os.path.join(ROOT, 'app-icons', 'preview'); ios = os.path.join(ROOT, 'ios', 'App', 'App')
os.makedirs(prev, exist_ok=True)
manifest = []
for sid, slabel, pose in SKILLS:
    for cid, clabel, chex in COLORS:
        bg = hx(chex)
        icon(bg, pose, 256).save(os.path.join(prev, f'{sid}-{cid}.png'))
        key = f'AltIcon-{slabel}{clabel}'
        if os.path.isdir(ios):
            icon(bg, pose, 120).save(os.path.join(ios, f'{key}@2x.png'))
            icon(bg, pose, 180).save(os.path.join(ios, f'{key}@3x.png'))
        manifest.append({'skill': sid, 'skillLabel': slabel, 'color': cid, 'colorLabel': clabel, 'hex': chex, 'iosKey': key, 'preview': f'app-icons/preview/{sid}-{cid}.png'})
import json
with open(os.path.join(ROOT, 'app-icons', 'manifest.json'), 'w') as f:
    json.dump({'skills': [{'id': s[0], 'label': s[1]} for s in SKILLS], 'colors': [{'id': c[0], 'label': c[1], 'hex': c[2]} for c in COLORS], 'icons': manifest}, f, indent=2)
print(f'generated {len(manifest)} variants ({len(SKILLS)} skills x {len(COLORS)} colors)')
