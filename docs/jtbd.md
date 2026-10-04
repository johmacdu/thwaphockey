# Thwap Jobs-To-Be-Done (the WHY for every page)

This is the reference for what each page is FOR. Before changing a page, check
its job here. A page does its ONE job; anything that does not serve that job
does not belong on it. Dead simple beats complete.

## Player

**Player core job:** "Get better at hockey and feel like a real player."
(functional: improve; emotional: pride/identity; social: belong to the team.)

| Page | Job (why it exists) | Must do | Must NOT become |
|---|---|---|---|
| Home | Know what to train today and do it | Today's drills (stick/shoot/dryland per the plan), Game Day Goals, greeting by name | A dashboard; a stats page |
| Stickers | Feel rewarded + collect identity | Earned stickers, locked/mystery slots, progress to next | A store; a chore list |
| Team | See my teammates + my own card | Roster of cards, tap a card, my card highlighted | Coach admin; standings |
| Standings | Feel the team is winning together (non-competitive) | Team goal bar (everyone's training fills it), team roll-up | Individual leaderboard/ranking |

## Coach

**Coach core job:** "Develop my players and grow my team."
(functional: players improve; emotional: no kid slips through the cracks;
social: look prepared + invested to players and parents.)

**Nav:** Home is the LANDING (not a tab). Tabs = **Team, Plan, Standings** (header
nav, kebab on mobile), each an X-close page returning to Home. Mirrors the player
(Home landing + Stickers/Team/Standings tabs).

| Page | Job (why it exists) | Supporting job | Must NOT become |
|---|---|---|---|
| Home (landing) | See how the team is and what needs me today | 3 blocks only: **Participation** (who's working/behind) · **Development focus** (set each player's IDP) · **Who needs attention** (1-2 kids slipping) | A grab-bag; >3 blocks; Kraken-style readiness/sleep/spreadsheet |
| Team (tab) | Manage the roster | Full roster; add/remove player (first, last, position, #, ONE parent email); tap a player -> their stats/progress | The Standings page; a coach-only redesign of the roster look |
| Plan (tab) | Decide what the team trains each day | Per-day, per-category drill selection (Mon stickhandling = <drill>) | A generic settings page |
| Standings (tab) | Same team-progress view the players see | Identical to player Standings | A separate coach analytics view |

## Home discipline (both roles)
- The Home has ONE core job and a hard cap on supporting blocks (player: today's
  work; coach: 3 blocks). A new idea displaces an existing block or goes on a
  page. Never a fourth coach block.

## Design system
All pages are built from the code-level design system in `design-system.md`
section 16 (type/spacing/sizing tokens + shared components). Coach and player
surfaces are visually identical. Body/UI text never below 14px (Vitaly's
legibility floor): set the legible body baseline first, then the expressive
display sizes.

## Kraken (reference, not a target)
Kraken 10U has readiness scores, sleep tracking, energy/soreness charts, a
spreadsheet grid, PIN admin, daily alarms. For a 10U coach that is complexity
without a job. Take only the good ideas (IDP focus with skill presets; a clean
coach board) and leave the rest. Thwap's edge is being dead simple.
