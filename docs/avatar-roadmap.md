# Player character roadmap

Thwap replaces player photos with a blocky hockey character each kid builds and
grows over the season. The character lives on the player card everywhere it
shows (home, deck, roster, teammate cards, coach view). Gear, poses and
celebrations unlock from real training.

Design and interaction rules live in `docs/avatar-design.md`.

## Why a character, not photos

- No likeness of a real child is stored or shown. A look is a small set of
  choices (`skin`, `hair`, `jersey`, `num`, gear ids), not personal data.
- It retires the photo pipeline: parent email consent for uploads, background
  removal, the server photo store and manual re-cuts.
- Unlocks give kids a visible, personal reason to come back and train.

## How it is built

- **Character in code.** The body is CSS 3D boxes (`avatar.js`). A pose or
  celebration is a set of joint angles, so every item works in every pose.
- **Art is textures and icons.** In-rig box textures are authored **directly** as
  flat palette-exact pixel tiles (hand pixel art / PIL), because image models bake
  lighting and miss the grid -- and the code already shades the boxes. OpenAI stays
  for the shaded **Locker Room item icons** and marketing/style renders. Flat (no
  baked lighting), pushed on an `art/*` branch. See `docs/avatar-texture-spec.md`.
- **Looks and unlocks on the server.** Each player's look syncs across devices.
  Unlocks are computed on the server from recorded completions, never from
  localStorage.
- **Working across two laptops.** Git is the bridge. Art lands on its branch
  about 2 weeks before the phase that needs it. Until then the rig shows plain
  colored boxes, so code never waits on art.

## What the real data says (checked Oct 27 2026)

From the public leaderboard (`/api/board`), all-time activity totals across
16 players, about 4 weeks after launch:

| | Activities |
|---|---|
| Top 3 | 200, 134, 118 |
| Median | 31 |
| Mean | 52 |
| Lowest | 0 (one player has never logged) |

- **The spread is huge.** The most active kid already has 200 activities. A
  ladder based only on activity count would hand that kid nearly everything
  on day one.
- **More than half the team has gone quiet.** 9 of 16 players have not logged
  anything since Oct 10. This week only 3 kids have logged (16 activities).
  The early tiers matter most: they are how lapsed kids come back.
- **History is complete.** Per-discipline all-time counters and the list of
  active days are both stored per player (the per-event log is capped at 400,
  the counters and days are not), so credit for past training works at launch.
- Not checked: per-player active-day counts (stored server-side, not exposed
  on the public board).
- This is one month of data from a brand-new app, so the quiet spell may be
  novelty wearing off rather than the real season pace. Treat the ladder
  numbers as a starting point and recheck them against December's data
  before Phase 2 ships.

## Unlock ladder

Two currencies, so one big day cannot run the whole ladder:

- **Activities** (every drill or quiz counts) for the quick early wins.
- **Training days** (at most one per day) for everything bigger. This rewards
  showing up often, not grinding 30 drills on a Sunday.

| Tier | Earned by | What it feels like |
|---|---|---|
| 1 | 5 activities | First new item in week one |
| 2 | 10 activities | Second item right after |
| 3 | 25 activities | First celebration |
| 4 | 10 training days | New jersey |
| 5 | 20 training days | Helmet stripe |
| 6 | 35 training days | New pose |
| 7 | 50 training days | Chrome gear (rare) |
| 8 | 75 training days | Big celebration |
| 9 | 100 training days | Gold stick (epic) |
| 10 | 130 training days | Legendary item |
| 11 | 160+ training days | Season legend items |

A kid who trains 4 days a week from August to June reaches about 170 days.
A kid who trains 2 days a week reaches about 85. Both have something to
chase all season. Numbers get a final check against real day counts before
Phase 2 ships.

Second track, by discipline: 25 completions in a discipline unlock that
discipline's pose (shooting, passing, Hockey IQ, dryland, stickhandling;
net play for goalies).

Guardrails: no payments for items, no random loot boxes, every locked item
says exactly what earns it, the C and A are granted by the coach only.

## Season calendar

The app's own seasons (`lib/seasons.js`): Fall/Winter Sep 1 to Mar 31, Spring
Apr 1 to Jun 30, Off-season Jul 1 to Aug 31. The character season runs with
the hockey year, August to June, and rolls over in August.

## Phases

### Phase 1, November 2026: base character
- Skin tone, hair, number, Rangers Red/Black/White jerseys, one standing pose.
- Locker Room with Gear only. First-run builder (skin, hair, jersey), all
  pre-picked so a kid can tap Done.
- Unlocks at 5, 10 and 25 activities, with credit for past training.
- Photos stop showing on cards. Photo upload is removed. Stored photos are
  deleted only after Woody confirms, a week or two after launch.
- Art: style test, then skin, hair, three jerseys, base gear.
- Done when: every Ranger has a character on their card.

### Phase 2, December: the ladder
- Gear tiers to 75 training days: helmet, stripe, cage, gloves, stick.
- Unlock moment after a drill (THWAP sound, item pops, "New" dot).
- Teammate cards and the roster show characters.
- Holiday streak item for training over winter break.
- Art: gear textures and icons per tier.
- Done when: unlocks fire on their own from real completions.

### Phase 3, January to February: poses and celebrations
- Joints on the rig. Poses: ready stance, shooting, passing, goalie stance.
- Discipline track (25 in a discipline unlocks its pose).
- Celebrations play on milestone days and from a Play button, never on a
  card tap (tap flips, double tap spins). Reduced motion shows the end frame.
- 100 training days: the gold stick.
- Art: little to none, poses are data.
- Done when: a kid picks a pose and celebration and it shows everywhere.

### Phase 4, March to April: the team layer
- Weekly team goal hit (the ramp in `TEAM_GOAL_SCHEDULE`) gives everyone a
  shared item that week.
- Coach grants the C and A. Coach home shows the roster's characters.
- Playoff or tournament jersey, only during that window.
- Art: team items, playoff jersey.
- Done when: a team goal shows on every card and the coach can grant letters.

### Phase 5, May to June: season finale
- Season 1 finish items, bigger ones for higher totals.
- Season card: a keepsake snapshot of the character, totals and best streak.
- Legendary tiers.
- Art: Season 1 items, season card frame.
- Done when: every kid has a finished Season 1 card in June.

### Phase 6, July to August: rollover into Season 2
- Kids keep everything. Season 1 items move to a Collection tab.
- A fresh ladder starts in August with new items.
- Summer dryland track so July is not dead.
- New-player onboarding for next year's 10U kids, groundwork for more teams.
- Art: Season 2 set, generated in June.
- Done when: the August 2027 kickoff needs no manual reset.

## Status

- [x] Plain-box character prototype (`avatar.js`, preview with `?avatar=1`,
  lab page `avatar-lab.html`)
- [x] Style test -> **A (pixel voxel) chosen** (`docs/avatar-style-test/`)
- [x] Phase 1 texture spec, written to style A (`docs/avatar-texture-spec.md`)
- [x] Flat-texture pipeline proof (jersey + helmet tiles render crisp + shade
  cleanly in the rig; `avatar-tex/`)
- [x] Full Phase 1 texture kit (every part style-A pixel, 3 jersey colorways)
- [ ] Server look storage and unlock rules
- [ ] Locker Room
