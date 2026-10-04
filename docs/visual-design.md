# Visual Design — Thwap Hockey Training

Everything here serves one goal from `child-centered-design.md`: a 9–12 year-old
can read and use it easily, at arm's length or propped on the floor mid-drill.

## Typography (kid-friendly, readable from ~4 feet)
- **Display / headings / brand / big numbers: Fredoka** — rounded, chunky,
  playful. Loaded from Google Fonts. Pinned to **weight 600** with a small
  positive `letter-spacing: .01em` (Fredoka is wide and rounded; negative
  tracking makes it collide and look fuzzy — never tighten it).
- **Body / steps / small print: Poppins** — clean, geometric, gives Fredoka
  contrast (two rounded fonts together read mushy — this is why not Nunito).
- Always set **`-webkit-font-smoothing: antialiased`** on body (and the Firefox
  / `text-rendering` equivalents). Without it, bold rounded fonts render fuzzy on
  macOS/Chrome.
- Never let a heading fall to a weight the loaded font doesn't ship — the browser
  fakes it and it blurs. Give headings an explicit Fredoka weight.

### Size scale (sized up for 4-ft readability)
- Hero H1: `clamp(38px, 10vw, 54px)`.
- Exercise / card title: ~22px.
- Cue + step instructions: **18px** (this is the text kids read while doing the
  drill — keep it big, generous line-height ~1.7, roomy gaps between steps).
- Dose / meta: ~15px. Nav card description: ~16px.
- **Nothing smaller than ~12px** anywhere.

## Color tokens (source of truth)
All color is CSS custom properties so dark/light flip cleanly. **Never hardcode a
hex in a component** — add or reuse a token.
- Dark (default): deep forest green (`--bg`, `--panel`, `--card`, `--soft`,
  `--line*`, `--text/text2/muted`, `--green/green2`, `--onaccent`).
- Light (`html[data-theme='light']`): soft off-white / pale green, white cards,
  hairline borders, dark ink.
- Full token sets live in the app's `index.html`.

## The cards rule (important)
**A "card" (bordered, filled, elevated, rounded) means "tap me to go somewhere."
Card styling is reserved for elements that are BOTH interactive AND navigate the
user somewhere.**
- **IS a card:** home nav tiles (Game Day Goals, Stickhandling, Shooting,
  Dryland), player picker cards. Real links to a new page or state.
- **NOT a card** (flat: whitespace + a 1px `--line` divider): page heroes, the
  exercise rows, "Soon" rows, leaderboard blocks, AND any non-interactive display
  block such as a status line, a greeting, or the player-identity line. If it does
  not take the user somewhere on tap, it never wears the card look. (A "Welcome
  back" greeting inside a card was a real mistake. It is plain text, not a card.)

## Never use em-dashes
Never use em-dashes anywhere: UI copy, workout names, code comments, docs. Use a
period, a comma, a colon, or restructure the sentence. This holds across the
whole app and every deliverable.

## Layout
- Home nav cards: a **single stacked full-width column at every width** (the
  multi-column grid was rejected).
- Roster: responsive grid (1 → 2 → 3). Exercise lists: single column.
- Content centered, `max-width: 1100px`, `padding: 0 16px`.
- **Emoji sit large** on exercise rows (~34px in a ~42px column) — kids like them
  bigger. Emoji are friendly placeholders for a real icon set later.

## Shape, spacing, tap targets
- Radii: nav cards ~22px, pills 999px.
- **Every interactive thing is ≥ 44px tall**, bigger for primary actions. The
  "Mark done" button is generously padded and easy to hit.
- Generous padding so a 9-year-old can tap confidently.

## Motion
Subtle and fast only (a gentle card lift, a chevron rotate, a fade-in). Never on
the decision surface. Always respect `prefers-reduced-motion`: freeze/skip motion
but keep the content visible.
