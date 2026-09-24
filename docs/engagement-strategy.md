# Thwap — Engagement & Celebration Strategy

Living design doc for the reward, streak, and celebration systems that keep a
9-year-old coming back Monday–Friday. This captures both what is **built today**
and the **planned celebration ladder** so the ideas are not lost between sessions.

Status legend: ✅ built · 🟡 partial / demo data · ⬜ planned (not built).

---

## 1. The engagement stack (four interlocking loops)

Thwap's engagement is not one feature — it is four loops that feed each other:

1. **Effort → Stickers** (collection). Training earns stickers; the Sticker Book
   shows locked (🔒 grayscale) → earned (lime border) → placed. ✅
2. **Stickers → Unlockable card backgrounds** (progression). Card themes start at
   red + blue; more unlock by total stickers earned (`thwapThemeUnlocked` →
   `cb2Unlocked`). Locked swatches show 🔒. ✅
3. **Standings** (competition). Weekly + all-time leaderboard; "you" row
   highlighted. Social comparison with teammates. ✅
4. **Streak** (consistency). 🔥 flame with tiers at 3 / 5 / 7 days, for the
   player and the team. 🟡 (coded, demo data until Phase 4, hidden until day 3.)

**The gap today:** these live on separate pages. The player home does not surface
the daily hook that ties them together ("2-day streak · 3rd on the team · 1
sticker from a new card"). Closing that is the single highest-leverage change.

---

## 2. Streak model

### Individual streaks
- **Day streak** — consecutive days the player completed *something*. Flame tiers:
  - 🔥 **m3** (3 days) — flame grows slightly. ✅ (threshold live)
  - 🔥 **m5** (5 days) — brighter glow.
  - 🔥 **m7** (7+ days) — biggest glow, "On fire!" label.
- **Category streak** — consecutive days a *specific* discipline (Hands / Shoot /
  Dryland) was trained. ⬜ (not yet distinct from day streak.)
- **Perfect day** — all of the day's assigned items completed. This is the trigger
  for the celebration ladder in §3. 🟡 (completion is tracked; celebration ladder ⬜.)

### Team streaks
- **Team day streak** — consecutive days *every* player trained at least once.
  🔥 shown only at ≥ 3 days (`#lbStreak`). 🟡
- **Team category sweep** — the whole team hit a category in one day. ⬜
- **Team perfect week** — all players, all assigned days, Mon–Fri. ⬜ (biggest team payoff.)

---

## 3. The celebration ladder (escalating "perfect day" rewards)

The core idea: **completing all of a day's items is a moment, and the moment
escalates the more the player earns it.** First time is a surprise; repeats build
a signature vocabulary the kid recognizes and chases. All respect
`prefers-reduced-motion` (fall back to a static stamp).

### Individual — "I finished everything today"
| Time | Celebration | Notes |
|---|---|---|
| **1st ever perfect day** | 🏒 **Pucks rain down** the screen | The big first-time surprise. Full-screen, ~1.5s, then settles. |
| **2nd perfect day** | A puck **flies in and cracks the screen**, then **"THWAP"** stamps | Reuses the existing THWAP stamp; adds a one-time crack overlay that clears. |
| **3rd** | Puck cracks screen + **flame ignites** on the streak (ties to the 🔥 tier) | Bridges the moment to the streak system. |
| **Hitting a streak tier (3/5/7)** | Flame grows + **"On fire!"** + a short cheer | Already partly built (flame tiers); add the cheer + label moment. |
| **Unlocking a new card background** | Card **flips to reveal** the newly unlocked theme | Connects effort → the progression loop the kid can see. |

### Team — shown to everyone on the team
| Trigger | Celebration |
|---|---|
| **Whole team trained today** | Team flame on Standings + a "Team on fire 🔥" banner |
| **Team perfect week (Mon–Fri, all players)** | Big team celebration on Standings — confetti + a shared badge |

### Design rules for celebrations
- **Escalate, don't repeat.** The 1st perfect day must feel different from the 50th.
- **Short and skippable.** ≤ 1.5s, never blocks the next tap. (Vitaly on toasts:
  don't turn the UI into a race against time.)
- **Reduced-motion path** for every animation — a static "THWAP" / badge instead.
- **Tie every moment back to a loop** — a celebration that doesn't advance a
  sticker, a card unlock, or a streak is just noise.
- **Team beats individual** in prominence — the point is kids encouraging each other.

---

## 4. Where each lives in code (today)

- Streak flame + tiers: `.plflame` `.m3/.m5/.m7`, `#plStreak` (player), `#lbStreak`
  (team, ≥3 days). `demoStreak()` supplies demo values until Phase 4.
- Stickers: `.stickcell` locked/earned, Sticker Book page.
- Card unlock: `CB2_START_UNLOCKED=['red','blue']`, `thwapThemeUnlocked()`,
  `cb2Unlocked()`, `.cardsw.locked`.
- THWAP stamp: `.exthwap` / `.pl-thwap` (fires on drill done today).

## 5. Planned build order (post-launch)
1. **Home daily hook** — surface streak + standing + next-unlock on the player home.
2. **Perfect-day detection** — a single event when all of today's items are done.
3. **Celebration ladder** — pucks-rain (1st) → crack+THWAP (2nd) → tiered flame.
4. **Team celebrations** — team-trained-today + perfect-week.
5. **Wire streaks to real consecutive-day data** (replace demo values).

This doc is the source of truth for these ideas — update it as the ladder is built.
