# My Player items, batch 2

New items for each My Player category, about 25 per category with the items that already exist. Written Oct 28 2026 for the OpenAI image run on the other laptop. Nothing here is in the catalog yet.

## How to run it

1. On the other laptop, read `docs/avatar-items-batch-2.json`. Each item has an `id`, a `label`, a `tier`, a `file` path and a full `prompt`.
2. Generate one transparent image per item (1024 x 1024 from the model; the app scales it down) and save it at its `file` path, under `avatar-icons/`. Shipped as transparent **WebP** to match the rest of the art (the model returns PNG; it is converted down from ~1 MB to ~80 KB each). The `file` paths in the JSON end in `.webp`.
3. Use the same model and settings for the whole set, in one run, so the style stays uniform (see `docs/avatar-style-test/README.md` for the model that worked last time): `gpt-image-2.5-sunburst`, transparent background, high quality.
4. Push the images on an `art/*` branch, the same way the stickers and textures go.
5. Check every image before it ships: no text or logos, nothing scary or mean, and it reads at small size on a dark card.

## What the images are for

These images are the **icons** in the My Player grid. The character on the card is drawn in code, so each new item also needs a small code change before kids can wear it:

- **Jerseys, helmets, gloves, sticks:** mostly a color change. Jerseys carry exact hex colors in the JSON. Patterned ones (plaid, flames, checkerboard and so on) need a flat 16px texture tile, made by hand or in code, not by the image model (see `docs/avatar-texture-spec.md`).
- **Hair styles:** each one needs its own set of boxes in `avatar.js`, like the 13 that exist now.
- **Moves and cellys:** each one is a pose or an animation written in code. The image only shows what it looks like in the grid.

Unlock rules are not set yet. Tiers are suggestions: Rookie (no label), Pro, All-Star, Legend.

## Shared style line

Every gear prompt starts with this:

> A single hockey item icon for a kids' hockey app, in a blocky pixel-voxel style like Minecraft: chunky boxes, pixel-art texture on every block face at 16px per block unit, crisp hard pixel edges, soft simple shading. Shown alone, centered, three-quarter view turned about 25 degrees and seen slightly from above, on a fully transparent background. No text, no letters, no numbers, no logos, no brand marks, no people's faces. Bold, cool, not cute. Must read clearly at 120px on both light and dark backgrounds.

Moves and cellys use this instead, then describe the action:

> A blocky pixel-voxel hockey player (square head, box torso, box arms and legs, in a plain red jersey, black pants, black helmet with a steel cage, black gloves, dark stick, skates), seen in three-quarter view, full body, on a fully transparent background, in the style of Minecraft: crisp hard pixel edges, 16px per block unit. Simple face with no likeness of a real person. No text, no logos. Cool, not cute.

## Hair styles (12 new, 25 total)

| id | Name | Tier |
|---|---|---|
| `hairstyle-fade` | Fade | Rookie |
| `hairstyle-crewcut` | Crew cut | Rookie |
| `hairstyle-spikes` | Spikes | Rookie |
| `hairstyle-fauxhawk` | Faux hawk | Pro |
| `hairstyle-sidepart` | Side part | Rookie |
| `hairstyle-waves` | Waves | Rookie |
| `hairstyle-twists` | Twists | Rookie |
| `hairstyle-cornrows` | Cornrows | Rookie |
| `hairstyle-spacebuns` | Space buns | Pro |
| `hairstyle-topknot` | Top knot | Rookie |
| `hairstyle-shag` | Shag | Pro |
| `hairstyle-longflow` | Long flow | All-Star |

## Jerseys (17 new, 25 total)

| id | Name | Tier | Body | Stripe | Trim |
|---|---|---|---|---|---|
| `jersey-navy` | Midnight Navy | Rookie | `#16243F` | `#F2F2F2` | `#C8102E` |
| `jersey-sky` | Sky Blue | Rookie | `#6FB7E8` | `#F2F2F2` | `#16365C` |
| `jersey-teal` | Teal Wave | Rookie | `#138A8A` | `#F2F2F2` | `#111111` |
| `jersey-royal` | Royal Blue | Rookie | `#1F4FBF` | `#F2F2F2` | `#D4A72C` |
| `jersey-grape` | Grape | Rookie | `#5B2B86` | `#F2F2F2` | `#111111` |
| `jersey-sunset` | Sunset Orange | Rookie | `#E86A1C` | `#111111` | `#F2F2F2` |
| `jersey-gold` | Gold Rush | All-Star | `#D4A72C` | `#111111` | `#F2F2F2` |
| `jersey-silver` | Silver Ice | Pro | `#B8C2CC` | `#16365C` | `#F2F2F2` |
| `jersey-retro` | Retro Cream | Pro | `#EDE3C8` | `#C8102E` | `#111111` |
| `jersey-barber` | Barber Pole | Pro | `#C8102E` | `#F2F2F2` | `#111111` |
| `jersey-plaid` | Pond Plaid | Pro | `#A3232F` | `#111111` | `#F2F2F2` |
| `jersey-aurora` | Northern Lights | All-Star | `#0F2A3A` | `#4FE0A0` | `#A98BFF` |
| `jersey-lava` | Lava | All-Star | `#151515` | `#E8501C` | `#FFB020` |
| `jersey-snow` | Snowstorm | Pro | `#F2F2F2` | `#8CC8EA` | `#16365C` |
| `jersey-night` | Night Game | All-Star | `#111111` | `#B9F06B` | `#B9F06B` |
| `jersey-hattrick` | Hat Trick | All-Star | `#C8102E` | `#D4A72C` | `#111111` |
| `jersey-lime` | Thwap Lime | Rookie | `#B9F06B` | `#111111` | `#111111` |

## Helmets (22 new, 25 total)

| id | Name | Tier |
|---|---|---|
| `helmet-black` | Rink Black | Rookie |
| `helmet-white` | Ice White | Rookie |
| `helmet-green` | Thwap Green | Rookie |
| `helmet-navy` | Midnight Navy | Rookie |
| `helmet-sky` | Sky Blue | Rookie |
| `helmet-lime` | Thwap Lime | Rookie |
| `helmet-matte` | Matte Black | Pro |
| `helmet-twotone` | Two-tone | Pro |
| `helmet-stripe` | Racing Stripe | Pro |
| `helmet-pinstripe` | Pinstripe | Pro |
| `helmet-bolt` | Bolt | Pro |
| `helmet-flame` | Flame | All-Star |
| `helmet-icecrack` | Ice Crack | Pro |
| `helmet-stars` | Star Field | All-Star |
| `helmet-checker` | Checkerboard | Pro |
| `helmet-tracks` | Bigfoot Tracks | All-Star |
| `helmet-snowflake` | Snowflake | Pro |
| `helmet-carbon` | Carbon | All-Star |
| `helmet-mirror` | Mirror Silver | All-Star |
| `helmet-gold` | Gold | Legend |
| `helmet-aurora` | Northern Lights | All-Star |
| `helmet-lava` | Lava | All-Star |

## Gloves (20 new, 25 total)

| id | Name | Tier |
|---|---|---|
| `gloves-navy` | Midnight Navy | Rookie |
| `gloves-sky` | Sky Blue | Rookie |
| `gloves-green` | Thwap Green | Rookie |
| `gloves-lime` | Thwap Lime | Rookie |
| `gloves-orange` | Sunset Orange | Rookie |
| `gloves-grape` | Grape | Rookie |
| `gloves-teal` | Teal | Rookie |
| `gloves-silver` | Silver | Pro |
| `gloves-redwhite` | Red and White | Pro |
| `gloves-blackgold` | Black and Gold | Pro |
| `gloves-checker` | Checkerboard | Pro |
| `gloves-bolt` | Bolt | Pro |
| `gloves-snowflake` | Snowflake | Pro |
| `gloves-leather` | Old School | Pro |
| `gloves-flame` | Flame | All-Star |
| `gloves-carbon` | Carbon | All-Star |
| `gloves-aurora` | Northern Lights | All-Star |
| `gloves-lava` | Lava | All-Star |
| `gloves-glow` | Glow | All-Star |
| `gloves-gold` | Gold | Legend |

## Sticks (21 new, 25 total)

| id | Name | Tier |
|---|---|---|
| `stick-twig` | The Twig | Rookie |
| `stick-matte` | Matte Black | Rookie |
| `stick-white` | Ice White | Rookie |
| `stick-navy` | Midnight Navy | Rookie |
| `stick-sky` | Sky Blue | Rookie |
| `stick-green` | Thwap Green | Rookie |
| `stick-lime` | Thwap Lime | Rookie |
| `stick-orange` | Sunset Orange | Rookie |
| `stick-grape` | Grape | Rookie |
| `stick-teal` | Teal | Rookie |
| `stick-silver` | Silver | Pro |
| `stick-twotone` | Two-tone | Pro |
| `stick-checker` | Checkerboard | Pro |
| `stick-candycane` | Candy Cane | Pro |
| `stick-snowflake` | Snowflake | Pro |
| `stick-bolt` | Bolt | Pro |
| `stick-carbon` | Carbon | All-Star |
| `stick-flame` | Flame | All-Star |
| `stick-aurora` | Northern Lights | All-Star |
| `stick-lava` | Lava | All-Star |
| `stick-glow` | Glow | All-Star |

## Moves (17 new, 25 total)

| id | Name | Tier |
|---|---|---|
| `pose-slapshot` | Slap shot | Pro |
| `pose-wrister` | Wrister | Rookie |
| `pose-backhand` | Backhand | Rookie |
| `pose-onetimer` | One-timer | Pro |
| `pose-saucer` | Saucer pass | Pro |
| `pose-pokecheck` | Poke check | Rookie |
| `pose-shotblock` | Shot block | Pro |
| `pose-crossovers` | Crossovers | Rookie |
| `pose-hockeystop` | Hockey stop | Rookie |
| `pose-spin` | Spin-o-rama | All-Star |
| `pose-betweenlegs` | Between the legs | All-Star |
| `pose-lacrosse` | Lacrosse lift | Legend |
| `pose-faceoff` | Faceoff | Rookie |
| `pose-breakaway` | Breakaway | Pro |
| `pose-backwards` | Backwards skate | Rookie |
| `pose-sticklift` | Stick lift | Pro |
| `pose-glovesave` | Glove save | Pro |

## Cellys (22 new, 25 total)

| id | Name | Tier |
|---|---|---|
| `celebration-armsup` | Arms up | Rookie |
| `celebration-stickraise` | Stick raise | Rookie |
| `celebration-glovepound` | Glove pound | Rookie |
| `celebration-airplane` | Airplane | Pro |
| `celebration-heart` | Heart hands | Rookie |
| `celebration-flex` | Flex | Rookie |
| `celebration-glass` | Glass bump | Pro |
| `celebration-spin` | Spin | Pro |
| `celebration-salute` | Salute | Rookie |
| `celebration-rocket` | Rocket launch | All-Star |
| `celebration-moonwalk` | Moonwalk | All-Star |
| `celebration-shuffle` | Ice shuffle | Pro |
| `celebration-snowangel` | Snow angel | All-Star |
| `celebration-sky` | Point to the sky | Rookie |
| `celebration-thumbs` | Thumbs up | Rookie |
| `celebration-robot` | Robot | Pro |
| `celebration-flamingo` | Flamingo | Pro |
| `celebration-penguin` | Penguin slide | All-Star |
| `celebration-stomp` | Bigfoot stomp | Legend |
| `celebration-kangaroo` | Kangaroo hops | Pro |
| `celebration-guitar` | Stick guitar | All-Star |
| `celebration-wave` | Wave to the crowd | Rookie |
