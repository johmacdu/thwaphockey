# Thwap Visual Design Spec v1

The authoritative visual system for Thwap. Supersedes the darker, restrained
prototype language. Thwap should feel like something a 10-year-old considers
theirs: hockey game-card energy + Pacific Northwest personality + sports
equipment graphics. Not childish, not noisy, not video-game cosplay.

## 0. The formula (six rules)
1. Big type.
2. Short copy.
3. Bright hits of color.
4. Chunky hockey graphics.
5. Collectible player identity.
6. Bigfoot + PNW personality.

## 1. Three visual layers
- Foundation: clean, highly usable responsive UI. A training instruction must be
  incredibly easy to read. Do NOT make every screen look like a trading card.
- Personality: bold typography, irregular graphic accents, hockey details.
- Reward: player cards, Bigfoot, stickers, streaks, achievements.

## 2. Color
Move away from the near-monochromatic forest interface. Do NOT make the whole
product dark. Training screens: Ice background + dark text + bright accents.
Player cards and special moments: dark, colorful, immersive (that contrast makes
collectibles feel special).

| Token | Color | Use |
|---|---|---|
| Thwap Ink | #15221B | Primary dark, text, dark screens |
| Ice | #F3F7F4 | Main light background |
| Puck | #202522 | Pucks, icon details |
| Thwap Lime | #B9F06B | Primary brand / action |
| Rink Blue | #75B8FF | Secondary accent |
| Goal Orange | #FF9D4D | Streaks, energy, achievements |
| Tape White | #FFFFFF | Cards / contrast |
| Bench Gray | #A5B0A9 | Secondary text |
| PNW Green | #315B43 | Bigfoot / outdoors secondary |
| Alert Red | #F0645A | Errors only |

Ratio: ~65% neutral/Ice, ~20% Ink/dark green, ~10% Lime, ~5% rotating accents.
Lime means GO / COMPLETE / ACTIVE / YOUR PLAYER. Keep it scarce so it stays powerful.

## 3. Typography
Two-font system.
- UI font: Nunito Sans. Instructions, nav, buttons, labels, body. Rounded,
  friendly, readable, does not scream "kids app".
- Display font: Archivo Black. Sparing use: LEWIE, THWAP, 4 DAY STREAK, POWER DAY,
  large jersey numbers. Never for workout instructions.

Type scale:
| Role | Size | Weight |
|---|---|---|
| Hero | 40-48px | 900 |
| Player name | 28-34px | 900 |
| Page title | 30-36px | 900 |
| Section heading | 22-24px | 800 |
| Card title | 17-19px | 800 |
| Button | 16px | 800 |
| Body | 16px | 600 |
| Supporting | 14px | 600 |
| Metadata | 12px | 700 |
| Eyebrow | 11px | 900 |
| Giant jersey number | 64-96px | 900 |

Mobile: no body text below 14px. Hierarchy should be exaggerated: a kid should
glance and read POWER DAY, then Skater Jumps, then 3x8 without parsing paragraphs.

## 4. Spacing
8px base grid; personality elements may break it occasionally.
Scale: 4 / 8 / 12 / 16 / 24 / 32 / 40 / 48.
- Mobile horizontal margin: 16px
- Major section separation: 32-40px
- Card padding: 16px; large/player-card padding: 20-24px
- Card gap: 12px
- Min interactive target: 44x44px
Workout rows roomy. Do not cram six exercises above the fold.

Corners: standard cards 16px; major cards 20-24px; player cards 24-28px;
pills/badges 999px. Do not put everything in a rounded rectangle.

## 5. Iconography
Stop relying on emojis. Custom filled icons with slightly imperfect/rounded
geometry (stroke-only productivity icons feel adult). 1-2 colors max.
Sizes: nav 24px; training cards 28-32px; feature/category 40-48px; empty states 64-96px.

## 6. Bigfoot ("PNW Hockey Mascot")
A team mascot, not a UI assistant everywhere. Compact, hairy, athletic, slightly
goofy, confident; wears hockey gear per scene; expressive without preschool-cute.
Appears at: celebration, workout complete, empty state, streak, error, achievement.
NOT next to every exercise.

## 7. Illustration
- A. Flat mascot illustration (Bigfoot, celebrations): bold silhouette, 3-5 colors,
  little/no gradient.
- B. Sticker graphics (very important): earned like QUICK HANDS, TOP SHELF, HEAD UP,
  5 DAY STREAK, POWER PLAYER, PASS + GO. Look like real hockey stickers (helmet /
  bottle / stick case). Irregular shapes, lightning bolts, tape strips, puck marks,
  scribbled circles.
- C. Tiny hockey diagrams for training (cones, nets, overhead rink movement).

## 8. Photography & player representation
Photography is identity, not decoration: player card / profile / roster only.
1:1 crop, real hockey/action/rink photos, genuine expressions. Avoid stock.

### The three representations (all equally premium)
A player's card representation is one of three, and none of them reads as the
"missing data" version:
- HERO: the player's actual supplied photo (only when a real photo exists).
- BIG NUMBER: a designed graphic identity built from their number + name +
  position. The DEFAULT when there is no photo. It must look intentional and
  just as premium as a photo, never like an empty placeholder.
- BIGFOOT: the Thwap mascot identity. A CHOICE any player can select, desirable
  in its own right, NOT the fallback for missing data.

Rule (social + product): **no photo = Big Number; Bigfoot is a choice.** Never
"no photo = Bigfoot". A kid with a photo can still choose Bigfoot; that is when
Bigfoot is fun. Do not make representation feel arbitrary or make photoless kids
"become the mascot".

### Ethical constraint (hard rule)
NEVER generate, reconstruct, or infer a human player's likeness from a partial or
missing photo. For the current roster, use ONLY the photos actually present in
Woody's uploaded roster screenshots. Everyone else gets a designed Big Number
card. No synthesized faces, ever.

### Card-system hierarchy
1. Identity: name + number + position.
2. Representation: real photo OR Big Number (Bigfoot is a chosen alternative).
3. Personalization: Bigfoot / card style.
4. Progression: unlock additional card treatments (Sticker Bomb, Holographic,
   Tape Job, THWAP!, Weekly Heat, etc.), and Bigfoot variations (goalie, celly,
   slapshot, retro).

## 9. Player cards (strongest visual expression, collectible, two-sided)
A card has a FRONT (identity) and a BACK (Thwap progress). Flipping is meaningful:
front = who I am; back = what I've been doing.

### Front = identity
- Number, name, position.
- Representation: the actual photo when genuinely available, otherwise intentional
  BIG NUMBER artwork (see §8; Bigfoot is a chosen alternative).
- NO Thwap logo. NO training stats. NO slogan.

### Back = Thwap progress (training/completion, NOT performance rankings)
- Header: THIS WEEK.
- Per-discipline completion count: 🏒 3 HANDS · 🥅 2 SHOOTING · ⚡ 2 DRYLAND.
- 🔥 4 DAYS streak.
- "7 sessions this week".
- One current earned treatment/badge, if applicable.
- NO repeated name/number/position. NO generic motivational slogan.
- NO performance stats (GP / G / A / SV% / SO). These are completion stats, not a
  ranking. That is what makes flipping useful and keeps it non-competitive/fair.

### Caution on the mockup image
The reference mockup (player_cards.png) is a LAYOUT reference only. Two things in it
must NOT be shipped as-is: (1) it shows GP/G/A performance stats and motivational
slogans on the back — the real back uses training-completion stats per the list
above; (2) it shows realistic child faces that appear AI-generated — per §8's hard
rule, real cards use only genuinely-supplied photos or Big Number artwork, never a
synthesized likeness of a child.

Personalization (later): card background (Forest/Ice/Electric Blue/Goal Orange/
Night Rink/Mount Hood/Columbia Gorge), 2-3 earned sticker slots.

## 10. Player switching (signature interaction)
Mobile: horizontal swipe. Selected card dominant, neighbors peeking. Incoming card:
snap -> grow ~4% -> settle, ~180-240ms. Not a spinning carousel. CTA: TRAIN AS <NAME>.

## 11. Training cards (simpler than player cards)
Eyebrow date (SUNDAY · SEP 13), big block heading (DRYLAND) + subtitle + time.
Each drill: icon, TITLE, short cue lines, dose (5 MIN / 2x6 EACH), completion circle.
Complete: circle -> chunky check, card gets subtle lime tint; occasional THWAP! stamp,
especially at full workout completion.

## 12. Motion (physical: snap/slide/bounce/stamp/impact; avoid fade->fade)
- Complete drill: circle -> check with 110% -> 100% bounce.
- Complete workout: THWAP! stamp.
- Player switch: card slides + snaps.
- Achievement: sticker slaps on with ~5deg rotation.
- Streak increases: fire briefly expands.
Most interactions < 250ms; celebrations 500-800ms. Respect reduced-motion.

## 13. Graphic texture (accents, not backgrounds)
Hockey tape strips, skate-cut lines, puck scuffs, rink-board marks, hand-drawn
circles, speed lines, snow spray. Example: POWER DAY heading with an irregular
orange marker-stroke underline.

## 14. Voice + visual
Short text -> bigger type -> younger feel.
- "Stick the landing. 3 x 8 each side." (not "Complete three sets of eight...")
- "THWAP! DONE. Nice work." (not "Congratulations! You have completed...")
- "fire 4 DAYS STRAIGHT" (not "You have maintained a four-day activity streak.")

## 15. Responsive (mobile first)
Phone: one-column training; full player card centered, neighbors peeking; 16px margins.
Tablet: player card ~300-340px; training stays one column (don't grid just because
space exists).
Desktop: max content width 960-1100px; training reading column 600-680px. Don't
stretch cards across a 1400px monitor.

## 16. Code contract (the design system IN CODE)

The spec above is enforced by CSS custom properties in `index.html` `:root`.
Build every surface from these tokens and the shared component classes so player
and coach pages are identical. Do NOT hand-set font-size / padding per element.

### Type scale tokens (vw-fluid, mobile reads big)
`--fs-hero` clamp(34,9vw,54) | `--fs-title` clamp(30,7.5vw,44) |
`--fs-player` clamp(26,7vw,40) | `--fs-section` clamp(20,5vw,26) |
`--fs-cardtitle` clamp(17,4.4vw,20) | `--fs-button` 16 | `--fs-body` clamp(15,4vw,17) |
`--fs-support` 14 | `--fs-meta` 12 | `--fs-eyebrow` 11 | `--fs-giant` clamp(48,18vw,96).
No body text below `--fs-support` (14px).

### Spacing tokens (8px base)
`--sp-1..12` = 4/8/12/16/24/32/40/48. Section rhythm `--gap-section` 32,
block gap `--gap-block` 20, card padding `--pad-card` 16 / `--pad-card-lg` 22.

### Sizing tokens
Emoji/icons: `--ic-nav` 24 / `--ic-card` 30 / `--ic-feature` 44 / `--ic-empty` 80.
Min tap target `--tap` 44px on every interactive control.

### Shared components (reuse, do not re-create)
The FULL component catalog, with each control's canonical class, where its CSS
lives, a copy-paste markup snippet, and its reuse rule, is in
`component-library.md`. Read it before building any control; the list below is a
quick index.

- Nav: the `.topbar` + `.toplinks` (`nav-authed` / `nav-coach` / `nav-guest`),
  collapsing to `.kebab` under 640px. Coach pages carry their own `.topbar`.
- `.hero` (`.kicker` eyebrow + `.hero-hey`/h1 + `p`).
- `.seg`/`.segbtn` timeframe/segment toggle.
- `.lb-goal` + `.lb-track` big-number-over-progress readout.
- `.metrics`/`.metric` and `.pl-tot` stat tiles (tappable = filter).
- `.board` + `.row` roster rows (rank/name/value grid, position dots).
- `.idp` monthly-goal editor: free text + tappable skill presets.
- `.pcard` player card; `.glassclose` page-close X (drill-in pages only).

### Rule
A new page is assembled from these classes and tokens. If a value is not a
token, it is a bug. Coach and player surfaces must be visually identical in
type ramp, spacing, sizing, color, and components.

