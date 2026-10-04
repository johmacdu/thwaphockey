# Thwap Hockey - Roadmap to Launch (Vancouver Jr. Rangers 10U)

Goal: get the team using it for real. This splits the work into what YOU (Woody)
own, what I (the agent) own, and what needs the illustrator. No em-dashes, plain
language.

## Where it stands today (live on thwaphockey.com)
- Home in kid voice, three drill pages, Game Day Goals, Sticker Book
- Team leaderboard backed by a real API (Upstash Redis), PIN-gated mark-done
- Honest streaks and a real Monday-based weekly split in the backend
- Player photo on your own card (local-only, parent-gated)
- Accessibility pass on Game Day Goals contrast, focus rings, 48px tap targets
- 40 automated tests

## The launch blocker is CONTENT, and most of it is yours
The app works. It is not usable by the team until the drills have real coaching
content. This is the critical path.

### Phase 1 - Content (Woody owns; this is what unblocks launch)
1. Stickhandling: real cues, steps, and any video links (you gave 19 before; confirm they are complete)
2. Shooting: real cues, steps, videos for the 9 rotating goals (names are in; bodies say "coming soon")
3. Dryland: the remaining video links
4. Confirm the drill rotation cadence is right (how many days, what repeats)

When you hand me each set, I fill it in. No invented content.

### Phase 2 - Real per-player identity (I own the build; you decide the model)
Right now the app is demo-pinned to "Lewie". Everything per-kid (their streak,
their photo, teammate kudos) needs each kid to be "themselves" on their own device.
This is the single biggest unlock and it gates several features below.
- Simple, kid-safe sign-in (pick your name once on your device, remembered locally; PIN to write to the team board)
- No passwords, no emails from kids; parent-gated where a photo or identity is set
- Once this lands: real streaks per kid, real weekly split per kid, and kudos become possible

### Phase 3 - The reward loop (I own build; illustrator owns art)
- Sticker decorating: peel a sticker, place it on your card and stats page (I can build the mechanic now; needs the sticker art to be desirable)
- Teammate kudos: send a positive-only sticker to a teammate (needs Phase 2 identity + the safety model already written)
- Identity badges: Hands Machine, Top Shelf, Speed Week (needs earned-criteria rules + badge art)
- Player photo behind the cage (Option 3): needs per-card layered art (illustrator or AI image tool), then my face-placement engine

### Phase 4 - Polish and trust (I own)
- Full app-wide contrast and colorblind audit across both themes
- Live end-to-end test of the real backend with a few kids
- A short kid usability test (script already written in thwap-docs)
- Dead-CSS cleanup, code health

## Suggested launch definition (minimum to hand to the team)
- Phase 1 content complete for at least Dryland + Stickhandling (Shooting can follow)
- Leaderboard live and correct (done)
- Streaks honest (done)
- A one-page "how to use this" for parents and kids

Kudos, decorating, and photo-behind-cage are all POST-launch delight, not launch
blockers. Ship the training loop first, add the reward system as the team starts
using it.

## Who does what (quick reference)
- Woody: all drill content, video links, the "how to use" note, product/safety calls, merging PRs
- Illustrator (or AI image tool): sticker art, badge art, per-card face-hole layers
- Agent: every code build above, tests, the identity system, the reward mechanics, audits
