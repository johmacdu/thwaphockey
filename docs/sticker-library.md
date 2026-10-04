# Thwap Sticker Library

Stickers are the reward layer (design-system.md §7B). Earned like QUICK HANDS,
TOP SHELF, 5 DAY STREAK, POWER PLAYER. They look like real hockey stickers (helmet
/ bottle / stick case): irregular shapes, bold outlines, graffiti/marker energy.
2-3 earned stickers can appear on a player card (design-system.md §9).

## Source art (Woody-provided)
Four sticker-sheet PNGs were provided (contact-sheet grids, ~50 stickers each):
- Sticker Library Vol.1 ("50 stickers for players. by players.") — hockey/mindset.
- Sticker Library Vol.2 ("50 more ways to show up.") — hockey/mindset, two variants.
- Slang Sticker Pack — current internet slang.

These are GRIDS, not individual assets. To use in-app each sticker must be sliced
into its own transparent PNG. Production options: (a) Woody slices to a folder;
(b) build the sticker SYSTEM now with placeholder chips and drop real art in later;
(c) recreate select stickers as SVG (interpretation, last resort).

## Curation (audience = 10U, ages 9-12) — IMPORTANT
The library is for kids. Before any sticker ships, curate for age-appropriateness:

### Do NOT include
- **GOONING** — current slang has a sexual meaning. Exclude from a kids' app.

### Use sparingly / review
- The **Slang Pack** (RIZZ, SKIBIDI, DELULU, MOGGING, SIGMA, LOWKEY/HIGHKEY, etc.):
  very current, dates fast, some carries baggage. A few are clean (W, DUB, LIT,
  SLAY, GLOW-UP). Prefer the timeless hockey/mindset stickers over slang.
- **PUCK REAPER** (hooded skull) — darker than the "mischievous, not childish"
  target. Optional; review tone.

### The clean, on-brand core (safe, timeless, recommended)
Hockey: KING, HEAT, SAUCE, FILTHY, CELLY, TOP CHEESE, TOP SHELF, PUCK YEAH, STICKS,
SEND IT, NET FRONT, BETWEEN THE PIPES, PLAYMAKER, SNIPER, TAPE IT, DIRTY HANDS,
GOOD HANDS, STICK HANDS, PUCKS, FLOW, ICE TIME, SKATE MORE/SKATE LIFE, GAME DAY/
GAME TIME, HELMET ON, RINK RAT, EAT PUCKS, PUCKS OVER (SCREENS/PROBLEMS), HOCKEY LIFE.
Mindset: NO DAYS OFF, GRIND, GOOD HABITS, HARDER/FASTER/SMARTER/STRONGER, ALL IN,
NO QUIT, ALL GAS, EARN IT, LEVEL UP, FEAR LESS, CLUTCH, ACCURACY, ON A MISSION,
DISCIPLINE, CONFIDENCE, CONSISTENCY, RESULTS, TRUST IT, PROCESS, PUT IN THE WORK,
ONE MORE REP, JUST ONE MORE, BETTER TODAY, BIGGER TOMORROW, MAKE IT HAPPEN,
PROGRESS NOT PERFECT, COLD BLOODED, ICE IN MY VEINS, STAY DANGEROUS, DIFFERENT/
JUST DIFFERENT/DIFFERENT BREED, BUILT DIFFERENT.
Team/PNW: TEAM FIRST, RESPECT, GOOD COMPANY, TEAMMATE, SAME WATERS, BUILT HERE,
WINTER BUILT, THE JOURNEY, WOLF MODE, BEAST MODE, SHARK MODE, BEAR, next-level bolt,
mountains, snowflake, pizza reward, recover/sleep, THWAP wordmark.

## System (build now, art later)
- Sticker data model: id, display name, category (hockey/mindset/team), art asset,
  rarity/unlock rule. Real names come from the sheets above (curated); art is
  Woody's sliced PNGs — do NOT invent sticker names or fabricate art.
- Card sticker slots: 2-3 on the player-card back.
- Earn motion (design-system.md §12): sticker "slaps" onto the card with ~5deg
  rotation, ~500-800ms, reduced-motion aware.
