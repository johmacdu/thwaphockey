# Journey scenes (art spec)

My Season > Journey shows one scene at a time: the kid's current stage, with
their player (or Sass) on it and one progress dot per training day underneath.
Tapping a stage in the row below shows that scene. Locked stages are blurred by
code. Each stage needs one picture. Art comes from Woody (OpenAI image API), in
the same style as the existing Journey art in `journey/art/`.

Until a scene's file exists, the page shows a plain tinted surface (never a gray
placeholder box). Practice Ice falls back to the rink art.

## Files

| File | Stage | Training days | Shows | Status |
|---|---|---|---|---|
| `journey/art/scene-locker.webp` | Locker Room | 1 to 19 | A team locker room with stalls and a tunnel out to the ice, team crest on the floor. | Landscape (Oct 29) |
| `journey/art/scene-practice.webp` | Practice Ice | 20 to 43 | An empty practice rink from above. | Landscape (rotated Oct 29) |
| `journey/art/scene-gameready.webp` | Game Ready | 44 to 67 | A game arena: rink from above, crowd, lights. | Landscape (rotated Oct 29) |
| `journey/art/scene-legend.webp` | Legend | 68 to 91 | A championship arena: banners, a trophy, spotlights. | Landscape (Oct 29) |

The rinks were drawn portrait for the old stacked path and rotated 90 degrees,
which works because a rink seen from above has no up or down. The locker room
and the legend arena can't be rotated: the crest and the trophy would lie on
their sides. Until their landscape files land, the page shows the middle of the
portrait picture.

## Size and layout
- **1600 x 1000 px (16:10, landscape), WebP.** The scene shows at 16:10, so a
  file this size fills it exactly. With the image API, ask for 1536 x 1024 (the
  closest landscape size) and save it as WebP: `cwebp -q 88 in.png -o out.webp`.
- **Viewed from above, long side left to right.**
- **Keep the bottom third calm.** The kid's player stands there and slides left to
  right as the dots fill. No faces, logos or busy detail in that band.
- **Keep the top-left corner calm.** When a kid views another stage, its name
  shows in a tag there.
- **No text, no numbers, no people.** The page draws the player on top.
- **No Sass in the scenes.** The kid picks who skates: their own player or Sass.

## Prompts for the two that need redoing

Use the edit mode with the current `scene-practice.webp` and `tier-1.webp` as
reference images, so the style matches.

1. **`scene-locker.webp`**: "Top-down view of a youth hockey team locker room,
   wide landscape, bold cartoon style matching the reference images. Wooden
   stalls with hanging green jerseys and helmets along the top and both sides, a
   dark rubber floor with a round team crest in the center, and a tunnel on the
   right edge leading out to bright ice. Keep the bottom third of the floor open
   and plain. No text, no letters, no numbers, no people."
2. **`scene-legend.webp`**: "Top-down view of a championship hockey arena, wide
   landscape with the rink's long side running left to right, bold cartoon style
   matching the reference images. Gold accents, green banners with a trophy
   symbol along the top edge, spotlights in the corners, and a shining trophy on
   a podium at the right end. Keep the ice in the bottom third uncluttered. No
   text, no letters, no numbers, no people."

## When the files land
Drop them in `journey/art/` with exactly these names. Nothing else changes.
