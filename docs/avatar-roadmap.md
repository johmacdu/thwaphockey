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
  for the shaded **My Player item icons** and marketing/style renders. Flat (no
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
| 3 | 25 activities | Wooden stick |
| 4 | 10 training days | New jersey |
| 5 | 15 training days | First celebration (fist pump, plays once Phase 3 adds celebrations) |
| 6 | 20 training days | Double Bolt helmet stripe |
| 7 | 35 training days | New pose |
| 8 | 50 training days | Glacier helmet (Pro) |
| 9 | 75 training days | Big celebration |
| 10 | 100 training days | Golden Stick (All-Star) |
| 11 | 130 training days | Bigfoot gloves (Legend) |
| 12 | 160+ training days | Season legend items |

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
- My Player screen with gear only. First-run builder (skin, hair, jersey), all
  pre-picked so a kid can tap Done.
- Unlocks at 5, 10 and 25 activities (gloves, stripe, wooden stick), with
  credit for past training. All three are gear, so every Phase 1 unlock shows
  on the card right away.
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
- 100 training days: the Golden Stick.
- Art: little to none, poses are data.
- Done when: a kid picks a pose and celebration and it shows everywhere.

### Phase 4, March to April: the team layer
- **Team set (decided Oct 28 2026).** Each week the team hits the weekly goal
  (adaptive, see below) unlocks the NEXT item in a fixed,
  visible order, for everyone on the roster, kept forever. No random drops.
  Team items are Rangers-themed, so they read as "we did it" next to the
  personal ladder's "I trained". Starting order (names are placeholders to
  check against the brand doc):
  1. Rangers tape (red and black tape on the stick blade)
  2. Rangers decal (an R on the helmet side)
  3. Team socks (a Rangers sock pattern)
  4. Rangers gloves (team-colored cuffs)
  5. Warm-up jersey (the team practice jersey)
  6. Team celly (a group celebration)
  7. Bigger items later in the season
  Everyone gets it, including kids who did not train that week: the message
  ("The Rangers did it! New team item: Rangers tape") is how quiet kids come
  back. The message also says how many drills each kid added.
- **Weekly goal (changed Oct 28 2026).** In October one week had 16 team
  activities against a goal of 125, so the fixed date ramp was replaced: the
  goal starts at 75 (week of Oct 26) and goes up by 10 each week the team
  hits it, to 145. A missed week keeps the goal; it never goes down. Finished
  weeks are recorded once on the server (`currentTeamGoal` in `lib/store.js`,
  key `teamgoal:ladder`) and the bar reads the goal from `/api/board?tf=week`.
- Coach grants the C and A (done, #457). Coach home shows the roster's characters.
- **Tournament jersey (decided Oct 28 2026).** The coach marks an event on the
  team schedule as a tournament; the jersey opens that week. Earned, not
  handed out: train 2 days during tournament week, then it is kept forever
  (like the Frozen Pond winter jersey). No dates in code.
- Art: optional, team items can be drawn in team colors in code.
- Done when: a team goal shows on every card and the coach can grant letters.

### Phase 5, May to June: season finale
- Season 1 finish items, bigger ones for higher totals.
- Season card: a keepsake snapshot of the character, totals and best streak.
- Legend tier items.
- Art: Season 1 items, season card frame.
- Done when: every kid has a finished Season 1 card in June.

### Phase 6, July to August: rollover into Season 2
- Kids keep everything. Season 1 items also become stickers in the Sticker
  Book, so the season lives where kids already collect.
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
- [x] Phase 1 texture kit: shared weave overlay (`avatar-tex/grain.png`) on
  sleeves, socks, pants, gloves and skates; skin and hair stay flat on purpose
- [x] Unlock rules (`lib/avatar_items.js`) and look storage
  (`lib/look_api.js`, routed via `api/board.js?action=look|looks` to stay
  inside the Vercel 12-function cap)
- [x] My Player screen, gear tabs, tap to wear, try on locked items (preview only)
- [x] First-run builder (skin, hair, jersey, Done), opens once for a player
  with no saved look, then the character drops onto the card
- [x] Unlock moment after a drill (New gear toast, New tags, dot on the
  My Player button)
- [x] Launch (Oct 28 2026): `var LIVE=true` in `avatar.js`. Every card shows a
  character. A player who has not built one gets a starter look picked from
  their name (hair style, hair color, one of the free Rangers jerseys; skin
  stays the default), so the roster is never a row of twins. No player photos
  anywhere; Lewie's built-in photo was removed.
- [x] Photo retirement: stored player photos and consent records deleted from
  the admin page (Roster, "Retire player photos") on Oct 28 2026.
- [x] Light edge around the character so black gear reads on dark card plates.
- [x] Phase 2 gear to 75 training days: Rangers Red helmet (25), Ice White
  gloves (30), Blackout cage (40, new `cage` slot), Rangers Red stick (60).
- [x] Winter break item: Frozen Pond jersey, 5 training days between
  Dec 19 2026 and Jan 4 2027 (`window` rule, counted from the real day list).
- [x] Unlock sound on New gear (bar-down ring and a crowd pop; silent with
  reduced motion or sounds muted).
- [ ] Recheck the ladder numbers against December's data before Phase 2 is
  called done.
- [x] Phase 3 stances: joints on the rig and all 8 catalog poses as joint data
  (`POSES` in `avatar.js`): Ready, Dangle, Toe drag, Snipe, Tape to tape,
  Head up, Power, Big save. Ready is unchanged; a picked stance shows on
  every card.
- [x] Moves tab in My Player: pick a stance, try on locked ones. Moves held
  back by the #447 rule now announce as "New move!".
- [x] Celebrations (THWAP!, Knee slide) as stance keyframes the rig blends
  between (`CELLYS` in `avatar.js`). Cellys tab in My Player with a Play
  button; tapping a celebration plays it (locked ones as a try-on). Milestone
  moment: the New gear message shows the kid's player doing their celebration
  in the new item. Never on a card tap. Reduced motion shows the final pose.
- [x] Phase 4 letters: the coach gives a player the C or an A from the
  edit-player sheet (`?action=set-letter`). Coach must run the team; one C
  per team (giving it moves it); at most two A's. Drawn high on the chest on
  every card; the kid gets "Coach gave you the C!" once.
- [ ] Phase 4 team set and tournament jersey: decided (see Phase 4 above).
  The weekly goal is now adaptive (75, +10 per hit, to 145); next is the team set.
- [ ] Unlock ladder check against December's data (early January).
