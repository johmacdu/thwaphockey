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
| arms (sleeves) | `sleeve-{red,black,white}.png` (two-stripe) | todo |
| legs (socks) | `sock-{red,black,white}.png` | todo |
| pants | `pants.png` (black, flat) | todo |
| gloves | `glove.png` (black, knuckle segments) | todo |
| skate boot | `skate.png` (black) | todo |
| head (skin) | `skin-s{1..6}.png` (flat; or keep flat color) | todo |
| hair flow | `hair-{color}.png` (flat; or keep flat color) | todo |
| cage / blade / stick | keep flat (steel / dark), they read fine | n/a |

Numbers (chest/back) stay as the `.av-num` text layer over the jersey tile, not baked into it,
so any number works.

## What "done" means for Phase 1 textures

Every visible part uses a flat style-A tile (3 jersey colorways), the character reads as a
pixel-voxel hockey player at 120px on light and dark, and nothing looks muddy under the code
shading. Then it's wired into the card everywhere (replacing the photo slot when a look exists).
