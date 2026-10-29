# Journey scenes (art spec)

My Season > Journey is a season path: one dot per training day, 91 dots, through
four stacked scenes the kid scrolls down through. Each scene needs one picture.
Art comes from Woody (OpenAI image API), in the same style as the existing
Journey art in `journey/art/` (the tier icons and the rink).

Until a scene's file exists, the page shows a plain tinted surface (never a gray
placeholder box). Practice Ice shows the current rink art turned on its side.

## Files

| File | Scene | Dots | Shows |
|---|---|---|---|
| `journey/art/scene-locker.webp` | Locker Room | 1 to 19 | A team locker room with stalls and a tunnel leading out toward the ice. |
| `journey/art/scene-practice.webp` | Practice Ice | 20 to 43 | An empty practice rink seen from above, long side running top to bottom. |
| `journey/art/scene-gameready.webp` | Game Ready | 44 to 67 | A game arena: rink from above, crowd in the stands, lights on. |
| `journey/art/scene-legend.webp` | Legend | 68 to 91 | A championship arena: banners in the rafters, a trophy, spotlights. |

## Size and layout
- **1000 x 1600 px (5:8, portrait), WebP.** The page crops to fill, so keep
  anything important away from the outer 5%.
- **Viewed from above, top to bottom.** The kid's path enters at the top and
  winds down to the bottom (a soft S-curve back and forth across the middle 54%
  of the width). Keep that middle band calm: no faces, logos or busy detail under
  the dots.
- **No text, no numbers, no people standing on the ice.** The page draws the
  dots, numbers and the kid's player (or Sass) on top.
- **Contrast for white and lime dots.** The path is a dotted white line, done dots
  are lime, upcoming dots are white with a dark number. A mid-to-dark surface
  works best; Practice Ice can stay light (dots have a shadow).
- **Locked scenes** are blurred and dimmed by code. No separate locked art.
- **No Sass in the scenes.** The kid picks who skates the path: their own
  player or Sass.

## When the files land
Drop them in `journey/art/` with exactly these names. Nothing else changes. The
test that checks every art slot names a real file allows these four names until
then (`test/journey-page.test.js`).
