# Phase 1 texture spec (style A: pixel voxel)

Written to the chosen style ([style test](avatar-style-test/) -> **A, pixel voxel**).
How the `avatar.js` box character gets its pixel-voxel look, and how to author the tiles.

## The rule that drives everything

`avatar.js` shades each box face in code (`.av-top` brightness 1.18, `.av-right/.av-left`
.78, `.av-back` .88, `.av-bottom` .6). So **textures must be FLAT** -- no baked shadows,
highlights, or lighting gradients. A tile with its own lighting gets shaded twice and looks
muddy. (Proof: the Phase 1 tiles below are flat and shade cleanly in the lab.)

## Author the tiles directly -- do NOT AI-generate them

Important finding from Phase 1: **flat pixel tiles are better authored directly** (hand pixel
art, or procedurally with PIL) than generated with an image model. Image models bake lighting
and can't hit an exact palette or a 16px grid -- the opposite of what this needs. Minecraft
textures are small, flat, palette-exact pixel art; author them that way.

- The proof tiles were drawn with PIL (`scripts/` style), flat, palette-exact, 16x16.
- The OpenAI pipeline stays for the **marketing/style-test renders and the My Player item
  icons** (which DO want shading), not the in-rig textures.

## How a tile is applied

A tile is a PNG set as a face `background`, stretched to the face and kept crisp:

- `avatar.js` sets `background-size:100% 100%` and `image-rendering:pixelated` on `.av-f`.
- A textured face passes `url('avatar-tex/<name>.png')` as its `bg` (see `jTex`/`helTex` in
  `html()`); the code shading still applies on top.
- Tiles live in `avatar-tex/` at the repo root (served next to `avatar.js` from both
  `avatar-lab.html` and `index.html`).

## Tile size

- **16 x 16 px per tile** (one "block unit" of the style). Stretched to the face by the box,
  so one tile covers a face as chunky pixels regardless of the face's em size.
- Larger parts (torso) can use 16-wide tiles; the stretch keeps the pixel rhythm consistent.

## Palette (Rangers)

| name | hex | use |
|------|-----|-----|
| red | `#C8102E` | red jersey body |
| red-dark | `#A50D25` | flat weave variation on red |
| black | `#151515` | black jersey body, pants |
| white | `#F2F2F2` | white jersey body, trim |
| ink | `#141414` | helmet, gloves, skate boot |
| steel | `#C9CED3` | cage, skate blade |
| skin s1-s6 / hair | see `SKIN` / `HAIR` in `avatar.js` | head, flow |

## Phase 1 parts -> tiles

Box parts `avatar.js` renders (see `html()`), and the tile each needs for the base character.
**Done** = textured in this change (the proof); the rest are the remaining Phase 1 kit.

| part | tile | status |
|------|------|--------|
| torso (jersey) | `jersey-{red,black,white}.png` (body + hem stripe) | **done** |
| helmet shell | `helmet.png` | **done** |
| arms (sleeves) | `grain.png` over the sleeve gradient | **done** |
| legs (socks) | `grain.png` over the sock gradient | **done** |
| pants (breezers) | `grain.png` over black | **done** |
| gloves | `grain.png` over the glove color | **done** |
| skate boot | `grain.png` over black | **done** |
| head (skin) | flat `SKIN` color (voxel skin reads fine flat) | **done** (flat) |
| hair (all styles) | flat `HAIR` color | **done** (flat) |
| cage / blade / stick | keep flat (steel / dark / stick color), they read fine | n/a |

Numbers (chest/back) stay as the `.av-num` text layer over the jersey tile, not baked into it,
so any number works.

## The weave overlay (`grain.png`)

The jersey and helmet are opaque per-colorway tiles that bake the style-A weave in. The
rest of the fabric (sleeves, socks, pants, gloves, skates) does **not** get its own
per-colorway tile -- instead a single transparent 16x16 tile, `grain.png`, is laid **over**
each part's existing fill:

- `grain.png` is the jersey's exact weave as transparency: a 2x2-block checker, half the
  pixels transparent and half black at ~18% alpha (`#C8102E` -> `#A50D25` is x0.825). Laid
  over any color it reproduces the same two-tone weave.
- In `html()`, `gr(fill)` returns `url(avatar-tex/grain.png),<fill>`. The sleeve/sock
  **gradients** (which carry each colorway's stripes) and the pants/glove/skate **solids**
  show through underneath, so **all five jersey colorways still work** -- no per-colorway
  sleeve/sock tiles needed, and forest/legend are covered for free.
- It stays flat (no baked lighting), so the code's per-face shading still composes cleanly.

Skin and hair stay flat colors on purpose (voxel skin/hair read fine flat); no tiles.

## What "done" means for Phase 1 textures

Every visible fabric part carries the same style-A weave (jersey/helmet tiles + the
`grain.png` overlay on everything else), the character reads as a pixel-voxel hockey player
at 120px on light and dark across all colorways, and nothing looks muddy under the code
shading. Then it's wired into the card everywhere (replacing the photo slot when a look exists).
