# Interaction Design — Thwap Hockey Training

How Thwap behaves. Grounded in `child-centered-design.md`: voluntary, safe,
per-exercise credit, no pressure.

## The daily session ("Today's training")
- Home opens on **today's session**: three time-guided blocks —
  **Stickhandling (~10–15 min) · Shooting (~15 min) · Dryland (~15 min)** — so
  the whole thing stays **30–45 minutes**.
- All three blocks are shown to everyone, in order, plainly.
- **No "complete the day" concept.** There is no whole-session checkmark, no
  "you finished today" gate, no requirement to do all three. A kid does what they
  can; each thing they finish stands on its own.

## Completion is per-exercise only
- Each exercise is a **tap-to-expand row**: tap opens the detail (cue + how-to
  steps + video slot + a **Mark done** button). Tap again collapses.
- Marking done is one tap on the button inside the detail. When done, a small
  green **"Done"** badge shows next to the exercise name.
- **No empty circle / fake checkbox** on the row — it reads as tappable but isn't.
  The only control that marks done is the "Mark done" button. (This was a real
  false-affordance fix.)
- Per-player completion saves locally (browser localStorage) through the current
  phases. A shared team backend is a later decision.

## Fairness (see `child-centered-design.md`)
- Shooting is shown to everyone with **no "optional" label**, but it never blocks
  the day and never counts against a kid who can't shoot at home.
- Because completion is per-exercise, no kid falls short of a whole-day bar.

## Dryland: balanced daily mix
- Dryland rotates a real 4-week program (one workout per calendar day), each
  trimmed to a **balanced ~6-exercise set**: roughly 1–2 per category (agility,
  power/speed, strength, core), **max 6**, so ~15 minutes.
- **No weekday/week label shown** to the player (the workout rotates by date, so a
  "Wednesday" label on a Tuesday is wrong/confusing). Header reads
  "Today's Dryland Mix," not a single category name like "Power."

## Navigation: close vs back
- A one-level-deep page uses an **iOS-glass close (✕), top-right**, aligned to the
  1100px content grid (not the viewport edge).
- The **back (‹) chevron is reserved for genuine multi-step flows** only.
- Theme toggle lives in the **footer** (moon/sun + Dark/Light), persists in
  localStorage, applied before paint (no flash), across the whole app.

## Videos
- Each exercise detail has a 16:9 YouTube slot. Empty → an honest
  "Video coming soon" placeholder. A coach-supplied URL → a real embed.
- **Never fabricate a video ID.** Videos come from coach-picked links only.

## States to always handle honestly
Empty ("nothing yet"), pending content (real structure, not a dead "coming soon"
page), done ("Done" badge), not-yet-built ("Soon" tag, dimmed, no chevron).
Never a dead end or a control that looks tappable but does nothing.

## Motion / tap feedback
Tappable things look tappable (subtle lift); non-tappable things must not. Motion
subtle and fast, respects `prefers-reduced-motion`. Tap targets ≥ 44px.
