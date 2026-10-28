# My Season Journey: art spec

The art for `journey.html`, the player's season book. The book has three pages
(My Season Journey, My Badges, My Season So Far), a cover, a Season Complete page
that only appears after the season ends in March, and a shelf of past books.

Generate each file below, save it to `journey/art/` with the exact file name, and
the page picks it up on reload. Until a file exists, its slot shows a gray box
with the file name.

## Ground rules

1. **No words in any image.** Names, numbers, tier names and the season year are
   live text drawn on top. Baked-in text can't change per kid and screen readers
   can't read it.
2. **No people.** Sass and objects only. Never generate a child or a face.
3. **One artist.** Start every prompt with the style anchor and attach the
   reference files, so the set matches the existing Sass art.
4. **Transparent unless noted.** Use the API's transparent background, export
   WebP, keep each file under 250 KB.
5. **Thwap palette.** Greens and lime with the discipline colors. No navy and red.
6. **Made for 10 to 12 year olds.** Bold, cool, readable at phone size. Not cute,
   not babyish, not busy.

## Style anchor (paste at the start of every prompt)

> Bold cartoon sports illustration matching the attached reference art: thick
> confident black outlines, flat cel shading with one shadow tone, slightly
> gritty texture, energetic. Palette: forest green #2F6B41, lime #B9F06B, ice
> white #F3F7F4, ink #15221B, with accents of blue #75B8FF and orange #FF9D4D.
> Cool and tough-but-friendly for kids aged 10 to 12. No text, no letters, no
> numbers, no logos, no people.

**Attach as references:** `login/sass-welcome.webp`, `login/sass-celly.webp`,
`login/sass-stride-m.webp`.

## Assets

| # | File (`journey/art/`) | Final size | Generate at | Bg | Where | Starter prompt (after the anchor) |
|---|---|---|---|---|---|---|
| 1 | `cover.webp` | 1200x1600 | 1024x1536 | Opaque | Book cover | A hardcover season book cover, deep forest green with a worn lime stripe along the bottom and faint ice-scratch texture. Sass bursting forward on skates in the center throwing ice spray. Keep the top third empty for a title. |
| 2 | `rink-path.webp` | 1600x700 | 1536x1024 | Transparent | My Season Journey | Top-down hockey rink in the same bold outline style: boards, center red line, two blue lines, faceoff circles. Light and open so markers can sit on top. No path, no dots. |
| 3 | `tier-1.webp` to `tier-4.webp` | 256x256 each | 1024x1024 | Transparent | Tier stops on the rink | Four round icons drawn as one set, same line weight and size: (1) a hockey bag, (2) two practice cones, (3) a hockey net, (4) a trophy with a star. Generate together in one image, then cut apart. |
| 4 | `badge-01.webp` to `badge-08.webp` | 320x320 each | 1024x1024 | Transparent | My Badges | Eight round badge icons drawn as one set, each a single bold symbol in a circular ring. Symbols follow Woody's badge list. Only draw the earned look; the page grays out unearned ones. |
| 5 | `finale.webp` | 1600x1000 | 1536x1024 | Opaque | Season Complete (March only) | A rink at night after the last game: empty ice under arena lights, a hockey bag and stick resting by the bench door. A warm "you did it" feeling. |

**Sass poses come from the existing art in `login/`.** No new Sass needed:
`sass-stride-m.webp` skates the rink, `sass-celly.webp` celebrates on Season
Complete, and one of the existing poses sits on the Badges page.

## Done checklist

- [ ] File names match the table exactly (lowercase, `.webp`).
- [ ] No text, letters or numbers in any image.
- [ ] No people or faces.
- [ ] Transparent where the table says so (check on a dark background).
- [ ] Each file under 250 KB.
- [ ] Tier icons and badges each read as one matching set.
- [ ] Each piece holds up next to the Sass art at phone size.
