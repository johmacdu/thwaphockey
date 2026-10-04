# Thwap Hockey - Delight System (design)

Playful motion and color that reward doing the thing. Governed by the north-star
principle: every effect earns its place, none annoys on the 20th trigger, all are
reduced-motion safe, none plays sound by default.

## 1. Springy press (build now, no assets)
Every tappable card/button gets one consistent press: scale to ~0.96 on press,
bounce back with a slight overshoot on release. One shared class `.thwap-press`
(or a small JS hook that adds a pressed class on pointerdown/up). Replaces the
scattered per-element :active scales with one standard.
- Reduced motion: no bounce, a plain quick opacity dip instead.
- Applies to: drill tiles, nav rows, roster cards, metric/segment buttons, the
  photo button, sticker cells, Game Day goal cards, the Back/Close pills.

## 2. Bolder discipline color (build now, no assets)
Three accent colors, used consistently as the app's playful palette:
- Stickhandling = green (#8fd65e)
- Shooting = blue (#75B8FF)
- Dryland = orange (#FF9D4D)
Use them deliberately: the drill nav rows, the discipline rings/triangles, the
"done" states, and the celebration tints all key off the same three. Do not
introduce a fourth accent. Keep contrast AA in both themes.

## 3. Reward moments (needs design sign-off + Sass art)
Goal: 10+ distinct moments, NO confetti, so disciplines never feel the same.
Each is short (<= 1.2s), reduced-motion safe (falls back to a static badge/flash),
and the repeated ones ROTATE so a kid does not see the identical thing every time.

Per single-drill-done (the common one, must vary by discipline). Each fires on a
TAP of the header emoji (mobile and desktop); long-press is reserved for the future
Sass slapshot because mobile browsers hijack long-press for text-select:
1. Shooting: a puck flies in from the right, hits the post at the front-facing
   goal, then ricochets straight up and off the top of the screen (crossbar ding).
2. Stickhandling: a puck weaves an S-curve dangle trail across the screen, ends
   on a sauce flick.
3. Dryland: charge-up zap (BUILT). Long-press the bolt: it shakes as it charges,
   flashes bright, then fires energy sparks outward. No puck (dryland is off-ice).

Streak milestones (BUILT):
4. 3 days: flame grows one tier.
5. 5 days: flame grows more, stronger glow.
6. 7 days: biggest flame, "On fire!" label.

Sticker + card (BUILT):
7. Sticker earned/slapped: the slap plus a shine sweep across it.
8. Placed a sticker on the card: a thwap overshoot pop at the drop point.

All-three-done today (the big finish, ROTATES between at least 3 so it never
repeats back to back):
9. Slapshot that shatters the header labels ("Stickers / Change player /
   Leaderboard" on desktop; the kebab menu on mobile) then reassembles. Needs a
   Sass-shooting SVG (Woody supplies; v1 can use a plain puck and swap in Sass).
10. Rain of pucks down the screen.
11. A big "GG" / "That is a wrap" banner stamp.

Rotation rule: store the last-shown variant per category in localStorage; pick a
different one next time. Never the same big-finish twice in a row.

## Assets Woody supplies (no invention)
- Sass-shooting SVG for the shatter slapshot (character art). Until then, v1 uses
  a plain vector puck.
- Any other character cameo art.
Generic shapes (puck, speed lines, shatter shards, cross-bar, sparks) are authored
in CSS/SVG here, not characters.

## Guardrails (non-negotiable)
- prefers-reduced-motion: every moment has a static fallback; no auto-motion.
- Duration <= 1.2s; the effect never blocks the next tap.
- No sound by default.
- No effect on a page a kid did not act on (no ambient loops that never stop).
- Count the moments against the principle: ship the ones that reward real
  progress; do not pad to hit a number.
