#!/usr/bin/env python3
"""Generate Thwap Hockey selectable app icons: 4 Sass skills x a color palette,
for the in-app picker, iOS (alternate icons) and Android (activity-alias icons).

Outputs:
  app-icons/preview/<skill>-<color>.png              256px light preview, for the in-app picker
  app-icons/preview/<skill>-<color>-dark.png         256px dark-appearance preview
  app-icons/manifest.json                            drives the picker (+ ios/android keys, dark)
  app-icons/ios-appearance/<AltIcon>.appiconset/     iOS 18 light+dark appearance set (staged)
  ios/App/App/AltIcon-<Skill><Color>@2x.png / @3x    iOS alternate icons (120 / 180)
  android .../res/mipmap-*/ic_<skill>_<color>.png     legacy launcher (48..192, API 23-25)
  android .../res/mipmap-*/ic_<skill>_<color>_fg.png  adaptive foreground (108..432 canvas)
  android .../res/mipmap-anydpi-v26/ic_<skill>_<color>.xml   adaptive icon (API 26+)
  android .../res/values/ic_launcher_colors.xml       adaptive background colors
  + <activity-alias> entries patched into AndroidManifest.xml

iOS Info.plist CFBundleAlternateIcons are added by a separate step (see app-icons/README).
Sass art is the real mascot (login/sass-*.webp). Re-run after editing SKILLS or COLORS."""
import os, json
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS = [('hands', 'Hands', 'login/sass-dangle.webp'), ('shooting', 'Shooting', 'login/sass-slapshot.webp'),
          ('passing', 'Passing', 'login/sass-pass.webp'), ('dryland', 'Dryland', 'login/sass-power.webp')]
COLORS = [('green', 'Green', '#8FD65E'), ('blue', 'Blue', '#75B8FF'), ('orange', 'Orange', '#FF9D4D'),
          ('purple', 'Purple', '#7A5AF0'), ('pink', 'Pink', '#EC4E9B')]
INK = (0x15, 0x22, 0x1B)   # brand ink; the dark-appearance background is pulled toward it
DARK_T = 0.45              # 0 = keep the color, 1 = full ink; 0.45 reads as "deep <color>"

def hx(h): h = h.lstrip('#'); return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
def dark_rgb(bg): return tuple(round(c * (1 - DARK_T) + i * DARK_T) for c, i in zip(bg, INK))
def rgb_hex(t): return '#%02X%02X%02X' % tuple(t)

def square(bg, pose, size, fill=0.78):
    base = Image.new('RGB', (size, size), bg)
    p = Image.open(os.path.join(ROOT, pose)).convert('RGBA'); s = (size * fill) / max(p.size)
    p = p.resize((max(1, int(p.width * s)), max(1, int(p.height * s))))
    base.paste(p, ((size - p.width) // 2, (size - p.height) // 2), p); return base

def fg(pose, size, fill=0.60):  # adaptive foreground: Sass on transparent, inside the safe zone
    base = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    p = Image.open(os.path.join(ROOT, pose)).convert('RGBA'); s = (size * fill) / max(p.size)
    p = p.resize((max(1, int(p.width * s)), max(1, int(p.height * s))))
    base.alpha_composite(p, ((size - p.width) // 2, (size - p.height) // 2)); return base

PREV = os.path.join(ROOT, 'app-icons', 'preview'); IOS = os.path.join(ROOT, 'ios', 'App', 'App')
ARES = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
APPR = os.path.join(ROOT, 'app-icons', 'ios-appearance')  # staged .appiconset bundles (light+dark)
os.makedirs(PREV, exist_ok=True); os.makedirs(APPR, exist_ok=True)
LEG = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
FGD = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

manifest, colors_xml, aliases = [], [], []
for sid, slabel, pose in SKILLS:
    for cid, clabel, chex in COLORS:
        bg = hx(chex); dbg = dark_rgb(bg); dhex = rgb_hex(dbg)
        square(bg, pose, 256).save(os.path.join(PREV, f'{sid}-{cid}.png'))
        square(dbg, pose, 256).save(os.path.join(PREV, f'{sid}-{cid}-dark.png'))
        ios_key = f'AltIcon-{slabel}{clabel}'
        if os.path.isdir(IOS):
            square(bg, pose, 120).save(os.path.join(IOS, f'{ios_key}@2x.png'))
            square(bg, pose, 180).save(os.path.join(IOS, f'{ios_key}@3x.png'))
        # iOS 18 appearance set (light + dark), staged for the asset catalog (see README).
        # Additive: does not touch the loose-PNG alternates or Info.plist the native switch uses.
        aset = os.path.join(APPR, f'{ios_key}.appiconset'); os.makedirs(aset, exist_ok=True)
        square(bg, pose, 1024).save(os.path.join(aset, 'icon-light.png'))
        square(dbg, pose, 1024).save(os.path.join(aset, 'icon-dark.png'))
        with open(os.path.join(aset, 'Contents.json'), 'w') as f_:
            json.dump({'images': [
                {'filename': 'icon-light.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
                {'appearances': [{'appearance': 'luminosity', 'value': 'dark'}],
                 'filename': 'icon-dark.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'},
            ], 'info': {'author': 'xcode', 'version': 1}}, f_, indent=2)
        res = f'ic_{sid}_{cid}'; alias = f'Icon{slabel}{clabel}'
        if os.path.isdir(ARES):
            for dens, px in LEG.items():
                square(bg, pose, px).save(os.path.join(ARES, f'mipmap-{dens}', f'{res}.png'))
            for dens, px in FGD.items():
                fg(pose, px).save(os.path.join(ARES, f'mipmap-{dens}', f'{res}_fg.png'))
            xml = (f'<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                   f'    <background android:drawable="@color/{res}_bg" />\n    <foreground android:drawable="@mipmap/{res}_fg" />\n</adaptive-icon>\n')
            with open(os.path.join(ARES, 'mipmap-anydpi-v26', f'{res}.xml'), 'w') as f_:
                f_.write(xml)
            colors_xml.append(f'    <color name="{res}_bg">{chex}</color>')
            aliases.append(
                f'        <activity-alias\n            android:name=".{alias}"\n            android:enabled="false"\n'
                f'            android:exported="true"\n            android:icon="@mipmap/{res}"\n            android:roundIcon="@mipmap/{res}"\n'
                f'            android:label="@string/app_name"\n            android:targetActivity=".MainActivity">\n'
                f'            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n'
                f'                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity-alias>')
        manifest.append({'skill': sid, 'skillLabel': slabel, 'color': cid, 'colorLabel': clabel, 'hex': chex,
                         'darkHex': dhex, 'iosKey': ios_key, 'androidAlias': alias,
                         'appearanceSet': f'{ios_key}.appiconset',
                         'preview': f'app-icons/preview/{sid}-{cid}.png',
                         'darkPreview': f'app-icons/preview/{sid}-{cid}-dark.png'})

with open(os.path.join(ROOT, 'app-icons', 'manifest.json'), 'w') as f_:
    json.dump({'skills': [{'id': s[0], 'label': s[1]} for s in SKILLS],
               'colors': [{'id': c[0], 'label': c[1], 'hex': c[2]} for c in COLORS], 'icons': manifest}, f_, indent=2)

if os.path.isdir(ARES) and colors_xml:
    with open(os.path.join(ARES, 'values', 'ic_launcher_colors.xml'), 'w') as f_:
        f_.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' + '\n'.join(colors_xml) + '\n</resources>\n')
    mani = os.path.join(ARES, '..', 'AndroidManifest.xml')
    s = open(mani).read()
    MARK = '<!-- selectable app icon aliases (generated) -->'
    if MARK not in s:
        block = f'\n        {MARK}\n' + '\n'.join(aliases) + '\n'
        s = s.replace('    </application>', block + '    </application>')
        open(mani, 'w').write(s)
        print(f'patched AndroidManifest with {len(aliases)} activity-aliases')
    else:
        print('AndroidManifest aliases already present; left as-is')

print(f'generated {len(manifest)} variants ({len(SKILLS)} skills x {len(COLORS)} colors) + light/dark appearance sets')
