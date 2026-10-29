# Player character: visual and interaction design

Companion to `docs/avatar-roadmap.md`. Check this before generating art or
changing the My Player screen.

## Visual strategy

### Blocky body, real hockey gear
- Minecraft-style proportions: square head, box torso, box arms and legs.
- The gear makes it hockey: shoulder pads under the jersey, hockey pants,
  shin guards, skates with blades, helmet with cage, gloves, stick.
- Cool, not cute. No big chibi eyes, no baby proportions. A player a
  10-year-old wants to be.

### Simple face, never a likeness
- Eyes, brows and a mouth on the face box. A few expressions (focused, grin,
  game face).
- Never an attempt to look like a real kid. Identity comes from choices:
  skin tone, hair, number, gear.
- Hair matters where it shows outside the helmet: out the back, and at the
  sides so it reads from the front too. Ten Minnesota hockey hair styles
  (Buzz to Locs), each a few boxes, with color as a separate choice.
- **Two hair styles are free from day one (Flow and Short); the rest unlock
  early through training** (decided Oct 28 2026, replacing "all free"). Most
  unlock on low activity counts (10 to 90) so a kid can reach the style that
  looks like them in the first couple of weeks. A style a kid already wore
  before the change is kept (saved to their grants).
- Long styles stop just above the back number so it stays readable.

### Flat textures, lighting in code
- `avatar.js` shades every box the same way: top lighter, sides darker,
  back darker still.
- Textures must be flat with no baked shadows or highlights, or they get
  shaded twice and turn muddy.

### One standard view
- 3/4 view turned about 25 degrees, seen slightly from above, feet anchored
  to the bottom of the photo slot.
- The card back shows the back view: number on the jersey.

### Color and rarity
- Base gear in Rangers red, black and white.
- Rarity reads in the material: Rangers colors (Rookie, no label), glacier
  ice (Pro), gold (All-Star), Bigfoot (Legend). The tier is always written too, never
  color alone.
- Same saturation discipline as the discipline icon set. Must read on light
  and dark card plates; the code adds a thin dark edge so the character never
  melts into a dark background.

## Naming

Every name comes from Thwap's own world, never from a competitor's app.
A reference screenshot is inspiration, not a source of words.

- **Sources:** Rangers colors, the Bigfoot mascot, the THWAP sound, the app's
  own discipline words (Hands, Shooting, Passing, Dryland, Hockey IQ, Net
  play) and real kid hockey slang (snipe, dangle, tape to tape, toe drag).
- **Matches existing features:** a plain, kid-obvious name like Sticker Book,
  Standings and Players. The screen is **My Player**.
- **Tiers:** Rookie (no label), Pro, All-Star, Legend. Hockey words, not
  generic game rarity words.
- **Voice:** `docs/ux-writing.md`, grade 3 to 4, verb first, no "activities".

| Slot | Thwap names |
|---|---|
| Jersey | Rangers Red, Rink Black, Ice White, Thwap Green, Bigfoot Legend |
| Helmet | Game helmet, Glacier helmet |
| Stripe | Plain, Bolt stripe, Double Bolt |
| Gloves | Game gloves, Rangers Red gloves, Bigfoot gloves |
| Stick | Game stick, Old School stick, Golden Stick |
| Hair style | Buzz, Short, Flow, Lettuce, Mullet, Wings, Curls, Ponytail, Braids, Locs (Minnesota hockey hair) |
| Pose | Ready, Toe drag, Dangle, Snipe, Tape to tape, Head up, Power, Big save |
| Celebration | THWAP!, Knee slide |

## Interaction strategy

### First run: build your player in under a minute
- Five steps: skin tone, hockey hair, hair color, jersey, which way you shoot.
  All pre-picked, so a kid can tap Done.
- Then the card reveal: the character lands on the card with the THWAP sound.

### My Player: a Thwap page, five groups, edited on the card
- Built like every other Thwap page: glass close top-right, a hero ("My Player"
  plus one line, "Tap to wear it. Drag to turn. Pinch to size."), the 1100px
  content column. Not a bespoke pop-up with its own header.
- The stage is the kid's real card front, so they see exactly what teammates see.
  It stays in view (sticky) while the list scrolls.
- Five groups on the shared `.seg` toggle, all visible at once:
  Me (skin, hair, hair color), Jersey (jersey, socks), Helmet (helmet, cage,
  stripe, sticker), Stick (gloves, stick, tape, which way you shoot),
  Moves (moves, cellys). Each part sits under a plain uppercase label over a
  hairline, never a box around the group.
- No View or Size tab. Drag the card to turn the player; on release they settle
  on the nearest side (left, front, right) and the card keeps it. Pinch to size
  on a phone; trackpad pinch or the scroll wheel on desktop; the - / + buttons
  beside the card always work (the one-finger option a pinch needs). Sizing
  re-centers the player: there is no move control.
- Tiles at least 48px with 8px spacing.
- Tap an owned item: it goes on the character and saves. No Save button.
- Tap a locked item: try it on, with a progress line ("Golden Stick. Train 100 days to unlock.
  You're at 62.").

### Unlock moment, where it was earned
- After marking a drill done: a short "New gear!" moment (200 to 400ms, never
  blocks the next tap). Tap it to try the item on in My Player.
- A dot on the My Player entry stays until the new item has been seen.

### Poses and celebrations (Phase 3)
- Picked in the Moves group (Moves and Cellys).
- Celebrations play on milestone days and from a Play button, never on a card
  tap (tap flips, double tap spins).
- Reduced motion shows the final frame, no animation.

### Teammates and coach
- Teammate cards show their characters, view only.
- The coach sees the roster's characters and is the only one who grants the
  C and A.

### Copy
Short, kid voice, verb first: "My Player", "Finish 5 drills to unlock",
"Train 100 days to unlock". Never "activities" (banned in `ux-writing.md`). Longer
explanations sit behind a Why layer.

## Style test (Woody's laptop)

Run the shared prompt three times, adding one style line each time. Keep
everything else identical.

```
A full-body youth hockey player character for a kids' hockey app (ages 8-13), built entirely from rectangular blocks like a Minecraft character: square head, box torso, box arms and legs. Wearing real hockey gear: helmet with a cage, bulky shoulder pads under a red jersey with black and white stripes, number 72 on the chest, hockey pants, shin guards, gloves, skates with blades, holding a hockey stick.

Pose: standing in a ready stance, stick blade on the ice, turned 3/4 view about 25 degrees to the viewer's left.
Face: simple blocky face with focused eyes and brows, NOT cute, NOT chibi, no big eyes. A generic character, not a likeness of any real person.
Hair: brown hockey "flow" sticking out the back of the helmet.
Feel: cool and confident, a player a 10-year-old wants to be.
No logos, no team crests, no text except the number 72.
Background: fully transparent (PNG with alpha). Centered, full body visible, feet at the bottom, nothing cropped.
```

Style lines:

- A, pixel voxel: `Style: pixel-art textures on every block face, 16 pixels per block unit, crisp hard pixel edges, like Minecraft.`
- B, clean blocks: `Style: clean flat-colored blocks with smooth vector-sharp edges and no pixel texture, like a modern toy figure.`
- C, soft blocks: `Style: slightly rounded block edges and bevels, chunky and friendly but still clearly made of boxes.`

How to pick:

1. Shrink to about 120px (roster card size). Still clearly a hockey player?
2. Put it on a dark background. Does it disappear?
3. Ask a 10-year-old which one they want.
4. Can it be built from boxes? Curved parts will not survive in code.

Push the winner, or all three, on `art/avatar-style-test`.

## Preview the prototype

- Lab page: open `avatar-lab.html` (Red, Black, White jerseys on card plates).
- In the app: add `?avatar=1` to any URL. This device then shows characters in
  every card's photo slot. `?avatar=0` turns it off. Players never see it
  unless they add the flag.
- My Player: with the flag on, tap the My Player button or open `#locker`.
  It needs a signed-in player. Saved looks show on every card after closing.
