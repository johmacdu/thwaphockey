# Thwap Hockey Training - Design Direction (North Star)

App: Thwap Hockey Training (thwaphockey.com)
Team: Vancouver Jr. Rangers 10U
Players: ages 8 to 13

This is the north star design document. It captures a design critique and the thinking that should guide every screen, feature, and piece of copy. When a decision is unclear, come back here.

## 0. The Governing Principle: make every detail perfect, limit the number of details

This principle outranks the rest of this document. When it conflicts with a nice-to-have, the principle wins.

Fewer details let us care more about each one. A detail is not just a visual choice. Every feature, control, mode, state, exception, and bit of behavior is a detail someone has to design, understand, and maintain. Attention does not scale with the number of them.

A button is never just a button. Someone decides where it goes, what it says, how it looks, what it does when pressed, what it does when it cannot be pressed, and what happens after. Add a second and you also own the relationship between the two. In software the cost is hidden, because another button, tab, setting, or mode is nearly free to add and expensive forever after.

Rules we hold ourselves to:
- Every control must earn its place. If it does not, remove it. Removing gives time back to make what remains excellent.
- Prefer subtraction. Adding has an advocate; removing has an enemy, so we bias toward removing on purpose.
- One primary control per screen, made truly good, beats many mediocre ones (the iPod wheel, the OP-1's four knobs, the MUJI pull-cord).
- When a request adds a detail, ask whether it earns its way in. If it does not, say so and propose the smaller version.
- Reuse a pattern the kid already knows over inventing a new one.
- Minimalism is not the goal. Caring deeply about every remaining detail is. Few enough things that each one can be perfect.

For an 8 to 13 audience this matters more, not less: a kid has less patience for a crowded screen than an adult does.

## 1. The Core Insight

Thwap should feel like a player's hockey world, not a training planner.

A kid opens the app for reasons like:

- I want to see what I have today
- I want that sticker
- I want to beat my streak
- I want to fill my card
- I want to see what the team did
- I unlocked something

The kid does NOT open it because "it helps me improve at hockey." That is the parent's answer, not the kid's. Improvement is real and it matters, but it is the outcome, not the hook.

Training still happens, but it happens INSIDE the hockey world. The world is the reason to show up. The training is what you do once you are there.

## 2. The Inverted Mental Model

Most training apps put the plan first. Thwap inverts it. The kid's experience should flow like this:

MY HOCKEY to Today to Play or Train to THWAP to I earned something to my card gets better to the team progresses to tomorrow there is something new.

Read it as a loop, not a checklist. Everything the kid does feeds their identity (the card), the team (shared progress), and the promise of something new tomorrow. Training is a step inside that loop, never the front door.

## 3. Home Screen

Home should make "Today" dominant. Near-zero instructional burden. Kid voice.

- One clear thing to look at: what is happening today.
- Talk like a coach who knows the kid: "Hey Lewie, Your hockey today, 3 things about 30 min."
- No settings, no long menus, no walls of text competing for attention.
- If the kid has to read instructions to understand Home, Home has failed.

The goal: a kid lands on Home and instantly knows what today is and wants to tap in.

## 4. Training Card Personalities

Cards are the identity layer. They need a real illustration system with a strong point of view.

- Draw from hockey sticker culture, trading cards, street hockey, and equipment graphics.
- Style is slightly exaggerated. Cool, NOT cute.
- Each training area or skill has personality, so cards feel collectible and worth improving.

Important constraint: this requires a real illustrator. Do not use AI-invented art for the illustration system. The look is the product's soul, and it has to be authored by a person.

## 5. Motion as Feedback, Not Decoration

Motion is the product's interaction language, not garnish. The name says it: tap, slide, shoot, THWAP, reward.

- Shooting complete: the puck rockets to the net.
- Stickhandling: the puck snakes around the UI.
- Streak: flames grow as the streak grows.
- All three done: a "TODAY COMPLETE" collapse.

Two hard rules:

- Motion must stay FEEDBACK, never a gate. It should never block or slow the kid from doing the next thing.
- Motion must honor reduced-motion settings. If a kid or parent turns motion down, the app stays fully usable and still feels good.

## 6. Leaderboard

Team goal first, individual status second.

- Lead with the team: "Rangers vs 150, progress bar, 32 to go."
- We-not-me psychology. The kid is contributing to something shared.
- Individual accomplishments show up as collectible status badges, not constant ordinal ranking.
  - Examples: Hands Machine, Top Shelf, Speed Week, Hockey Brain, Shutdown D.

This also serves the fairness principle for 10U: progress is completion-based, never performance ranking. No kid is publicly ranked worst. Everyone can earn status by showing up and doing the work.

## 7. Sticker Book

The sticker book is the emotional center of the app. It is the Pokemon-card equivalent: high visual quality, worth chasing.

- Stickers are weird, funny, desirable, rare, and sometimes secret.
- Named in hockey slang: BAR DOWN, PUCK THIEF, ANKLE BREAKER, WHEELS, SAUCE, MITTS, BRICK WALL, TAPE JOB, POST, CELLY, THWAP.
- Mystery stickers show as "???" with a prompt like "keep training to discover."
- Visual quality has to be high. A cheap sticker breaks the whole emotional promise.

## 8. Game Day Goals

Today this is an adult decision matrix: 40-plus options across categories. That is far too much for a 9-year-old.

The fix:

- Collapse each coaching category to its 3 to 4 top picks.
- Add a per-section "show more / show less" accordion (a caret with an underlined category link), following Vitaly Friedman's accordion guidance.
- The full library stays available, but it is not all exposed at once.

The kid sees a short, confident set of choices. The depth is there for anyone who wants it, hidden until asked for.

## 9. Writing Rule

If a kid cannot remember the instruction while skating onto the ice, it is too long.

UI copy should be short, memorable, coach-like lines.

- Good examples: "See first. Touch second." / "Pass it. Then GO." / "Middle first." / "Slow. Sell it. Explode."
- Long explanations sit behind a "Why?" expander or a coach/parent layer, never in the main flow.

## 10. Two Age Groups Inside 8 to 13

Design for the center at 10 to 11, and let the edges stretch.

8 to 10 wants:

- More illustration, animation, direct instructions, collecting, and celebration.
- Less text, fewer categories, fewer stats.

11 to 13 wants:

- Identity, skill mastery, stats, streaks, competition, personalization.
- Nothing that feels like a "little kid" app.

Across both: cool beats cute, and avoid mascots.

## 11. Visual Aesthetic

Hockey locker room crossed with a sticker book crossed with a sports game UI.

- Roughly 85 percent clean digital UI, 15 percent hockey texture.
- Texture vocabulary: black tape, rink markings, jersey numbers, puck marks, skate scratches, scoreboard typography, handwritten coach marks.
- Keep the texture restrained so the whole thing reads premium, not busy.

## 12. Everything Tappable

Reward exploration with micro-rewards. Poking around should always give something back.

- Tap the streak flames and they flare.
- Tap the puck and it moves.
- Tap the card and it flips.
- Tap the sticker and it peels.
- Tap a completed workout and a stamp appears.

## 13. The Design Test

Keep "Compete. Improve. Have fun." as a working test, not just footer copy.

- Compete = streaks and team challenges.
- Improve = skills and workouts.
- Have fun = stickers, motion, and personality.

Every feature must serve at least one of these three, or justify why it exists. If it serves none, cut it.

## Build-Ready Now vs Needs an Illustrator or Content

Build-ready now (structure, layout, interaction, copy patterns):

- Home screen with a dominant "Today" and kid-voice copy.
- Inverted navigation and flow (My Hockey to Today to Play or Train).
- Team-goal-first leaderboard with a progress bar and completion-based logic.
- Game Day Goals collapsed to 3 to 4 top picks per category with show more / show less accordions.
- Short coach-line UI copy with "Why?" expanders.
- Reduced-motion-safe motion feedback (puck to net, puck snake, streak flames, TODAY COMPLETE collapse).
- Tappable micro-rewards.

Needs an illustrator or content authoring:

- The training card illustration system (real illustrator, no AI art).
- The full sticker set art, including rare and secret stickers, at high visual quality.
- Named badge art (Hands Machine, Top Shelf, Speed Week, Hockey Brain, Shutdown D).
- The hockey texture pack (tape, rink markings, jersey numbers, puck marks, skate scratches, scoreboard type, coach marks).
- The curated coaching content behind Game Day Goals (the top picks and the deeper library).
