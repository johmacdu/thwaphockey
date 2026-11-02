# New team onboarding

How a new team starts using Thwap Hockey. Written for coaches and team managers
who are not tech savvy: one task per screen, one obvious button, plain words.

Status: decisions agreed with Woody on Nov 1 2026. The screens are designed in
`index.html` (the Join Thwap page and the coach home checklist). The server side
is NOT built yet:

- `api/coach.js` needs `coach-start` (email a 6-digit code, keep the draft team
  details) and `coach-verify` (check the code, create the coach or manager and
  the team, return `{ token, coach, team, paid }`).
- `api/billing.js` `create-subscription` needs a `plan` of `monthly` or
  `yearly`, the two new Stripe prices, and a success URL of `/#joined`.
- The manager role needs its permissions enforced on the server.

Until those exist, the page only works against the local design stand-in.

## Decisions

| Topic | Decision |
|---|---|
| Entry point | **Join Thwap** replaces "Join Waitlist" in the first-screen header. The sign-in sheet's line becomes "Coaching or managing a team? Join Thwap." The waitlist goes away. |
| Who signs up | A head coach or a team manager. |
| Team manager role | Its own role. A manager can pay, manage the roster and send invites. A manager cannot change the training plan. |
| Coach and manager sign-in | A code sent to their email, the same way parents sign in. No passwords. |
| Required team fields | Team name, association and age group. Association is required. |
| Price | $50 a month, or $500 a year ("2 months free", about 17% off $600). Replaces the three season passes ($350 / $90 / $60). |
| Payment | Before the team can be used. Card entry happens on Stripe's own checkout page (Apple Pay and Google Pay included), never a card form of ours. Comp codes and permanently free teams keep working. |

## The flow

1. **Join Thwap** (header button on the first screen).
2. **Your team:** team name, association, age group.
3. **About you:** your name, your email, and whether you are the coach or the team manager.
4. **Check your email:** enter the 6-digit code we sent.
5. **Pick a plan:** Yearly ($500, 2 months free) or Monthly ($50). Opens Stripe checkout.
6. **Your team is ready:** the team code and a ready-to-send message for the parent group chat.
7. **Team page, day one:** a short checklist (Add players, Invite families) that ticks off as they go, instead of an empty page.

Leaving halfway is safe: signing in again picks up at the first unfinished step.

## Known gaps to close (from the Nov 1 2026 code read)

- The sign-in sheet's "Create your team" link is never shown.
- The sign-in Team list is fixed to Vancouver Jr. Rangers 10U and Demo Team, so a new team's kids cannot pick their team.
- "Rangers" is written into pages (coach home kicker, Standings, team goal "Rangers vs") and the watch app.
- Some endpoints fall back to the Rangers team when no team code is sent (schedule, get-plan, and one more in `api/coach.js`).
- No empty state for a team with zero players.
- `docs/multi-team-backend-design.md` asks for photo reads to be token-gated before any real team onboards.
