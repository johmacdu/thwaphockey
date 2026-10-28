# Thwap Hockey on Apple Watch (design doc)

Status: draft for product owner review. No app code has changed.

Anything marked **PROPOSED** is a decision the agent made to fill a gap. It is not settled until the product owner agrees. Everything else is either fixed scope from the product owner or a fact read from the code in this repo, with the file named.

## 1. Why a watch app

Many Thwap players are 9 to 12 years old and have an Apple Watch but no phone. Many of those watches are set up with Apple Family Setup, which means a parent manages the watch from the parent's own iPhone and there is no kid iPhone paired to it. Today those kids can only train with Thwap on a shared family tablet or laptop. A watch app lets them see today's drills, run the timer, and check drills off on their own wrist, at the rink or in the driveway.

## 2. Scope

In version 1 (fixed by the product owner):

1. **Today's drills checklist.** Tap a drill and its timer starts. The wrist buzzes when a set is done. Tap again to mark the drill done.
2. **Watch face complication.** A small widget on the watch face shows this week's Stickhandling, Shooting and Dryland rings. It refreshes on a schedule and may lag by a few minutes.
3. **The THWAP stamp.** A strong buzz on every check-off, the wrist version of the THWAP stamp the web app shows.
4. **Game Day Goals, read only, on game day.**

Not in version 1: videos, picking goals, profile and settings, rankings (the leaderboard).

## 3. How it is built

**A standalone watch app.** It is written in SwiftUI (Apple's screen-building framework) and talks straight to `https://thwaphockey.com` over the watch's own Wi-Fi or cellular connection. It does not depend on WatchConnectivity (Apple's watch-to-iPhone link), because a Family Setup watch has no kid iPhone to talk to.

What this means in practice:

- The watch app is its own target in Xcode, marked "supports running without iOS app installation", so it can be installed from the App Store on the watch itself. **PROPOSED:** it lives in the existing `ios/App` Xcode project as a new watch target, sharing the bundle identifier family `com.thwaphockey.app.watchkitapp`, so one App Store listing covers both.
- The iPhone app today is a thin Capacitor shell that loads the live website (`capacitor.config.json`, `server.url = https://thwaphockey.com`). There is no native drill code to share, so the watch app is written fresh in Swift.
- Minimum watchOS version: **PROPOSED** watchOS 10, which covers Apple Watch Series 4 and later and the SE models that Family Setup supports. Open question for the product owner (see section 13).

### Simulator check on this Mac (run 2026-10-28)

`xcodebuild -version` reports Xcode 26.6 (build 17F113).

`xcodebuild -showsdks` lists both `watchos26.5` (the watchOS 26.5 SDK) and `watchsimulator26.5` (the watchOS Simulator SDK). So the watch app can be compiled.

`xcrun simctl list runtimes` lists only one runtime:

```
iOS 26.5 (26.5 - 23F77) - com.apple.CoreSimulator.SimRuntime.iOS-26-5
```

**There is no watchOS simulator runtime installed.** The app can be built but not run in a simulator until the runtime is added, for example with `xcodebuild -downloadPlatform watchOS` or from Xcode, Settings, Components. Haptics and the complication still need a real watch to judge properly.

## 4. Screens

All screens follow `docs/visual-design.md` (Fredoka for big numbers and headings, Poppins for body text, the existing color tokens, the dark drill "stage" used by the web drill runner).

1. **Sign in** (first launch only). See section 5.
2. **Today.** A scrolling list of today's drills, grouped by discipline (Stickhandling, Shooting or Net play for goalies, Dryland). Each row: the drill name, the dose (for example "4 sets of 30 sec"), and a checkmark when done. On a rest day (Saturday and Sunday in the web app's fixed plan, `window.thwapIsRestDay` in `index.html`) the list says "No training today. Rest up." and stops there. **PROPOSED:** the weekend "bonus reps" the web app offers are left out of version 1.
3. **Drill timer.** Opens when a drill row is tapped. Big countdown number, the phase ("Work", "Rest", "Set 2 of 4"), a Pause button, and a Done button. Drills with no timer in the web app (the 20-minute run, `noTimer: true` in `index.html`) skip straight to Done.
4. **Done stamp.** A one-second full-screen THWAP stamp with the strong buzz, then back to Today with the row checked.
5. **Game Day Goals** (game day only). A read-only list of the goals the player picked on the web app or tablet, plus the coach's team goal line. Reached from a card at the top of Today that only shows on game day.
6. **Complication** on the watch face (section 8).

Tapping a done row asks "Undo this drill?" with Undo and Keep buttons. This matches the web app, where tapping a done row un-marks it, but adds a confirm step because a wrist tap is easy to make by accident.

## 5. Signing in on the wrist

### 5.1 What the web app does today (read from code)

- The sign-in form in `index.html` (`#loginSignInView`) asks for a team, an email, and a code. The code is the player's jersey number followed by a season year, for example jersey 72 in 2026-27 is `722027` (`playerForPassword` in `index.html`, `CODE_SEASONS = ['2026', '2027']` in `api/login.js`).
- The server checks that code at `POST /api/login?action=code-signin` and sets a cookie named `thwapSession` (`api/login.js`).
- The session is a stateless signed token, not a database row: `<playerId>.<emailHash>.<expiry>.<signature>`, signed with HMAC (a hash-based message authentication code) using the `SESSION_TOKEN_SECRET` environment variable (`lib/session_store.js`). It lasts 30 days when "keep me signed in" is ticked (`SESSION_TTL_MS`).
- A second, stronger path already exists: `POST /api/login?action=request-code` emails a 6-digit one-time code to the parent email or emails **already on file** for that player (never to a typed address), and `POST /api/login?action=verify` checks it, records parent consent (`recordConsent` in `lib/photo_store.js`), and sets the same cookie. Codes expire in 10 minutes, lock after 5 wrong tries, and are limited to 5 requests per hour (`lib/photo_store.js`).
- Team codes are made from the team name plus two digits, for example `RANGERS72` (`createTeam` in `api/coach.js`). They contain letters.

Two facts that shape the watch design:

- The jersey code is easy to guess (a jersey number plus one of two years). That is acceptable for a browser session a parent is usually standing next to. It is weak for a token that will sit on a child's wrist for weeks. This is why section 6 adds parent approval.
- `code-signin` checks the player against the fixed `ROSTER` list in `lib/store.js` (16 players, one team), not against the multi-team members store. A watch sign-in for a player on a newer team would fail today. See open questions.

### 5.2 Watch sign-in flow (PROPOSED)

1. **Team code.** The kid enters the team code their coach shared. Typing letters on a watch is hard, so the field accepts Scribble (drawing letters with a finger) and dictation, and is not case sensitive (the server upper-cases team codes, `codeNorm` in `lib/schedule_store.js`).
2. **Pick your name.** The watch shows the team's players as first name plus jersey number. Large rows, one tap.
3. **Your code.** The kid types their jersey code on a number pad.
4. **Ask a parent.** The watch says "We emailed your parent. Ask them to approve this watch." and waits. See section 6.
5. **Signed in.** A welcome THWAP and the Today screen.

The kid never types an email address on the watch. The parent email is never shown on the watch.

### 5.3 Storing the session token (PROPOSED)

- The web app relies on the browser keeping the cookie. A native watch app can read the `Set-Cookie` response header itself (the cookie's HttpOnly flag only hides it from web page scripts), so the watch takes the token from the response and stores it in the **Keychain** (Apple's encrypted on-device secret store).
- Keychain settings: generic password item, accessible "after first unlock, this device only", not synced to iCloud. The token never leaves this one watch.
- On every request the watch sends the token back as a header: `Cookie: thwapSession=<token>`. **This works with today's server with no change**, because every endpoint reads the session through `readSessionCookie(req)` in `lib/session_store.js`, which only looks at the `Cookie` header.
- **Expiry.** The token carries its own expiry (the third dot-separated part, milliseconds since 1970). The watch reads it to know when the sign-in ends, and also calls `GET /api/login?action=session` at launch, which answers `{ authed: false }` for an expired or tampered token. Seven days before expiry the Today screen shows a quiet "Ask a parent to renew this watch" line. After expiry, check-offs keep queueing locally (section 9) and the watch shows the sign-in screen with the kid's name pre-picked.
- **Sign out.** Deletes the Keychain item, the cached drills, and the offline queue. Unsent check-offs are lost, so the watch warns first: "2 drills have not synced yet. Sign out anyway?"
- **Revocation gap.** Because the token is stateless, the server today cannot cancel one watch's token before it expires. A parent who loses a watch has no way to cut it off. Section 6.3 proposes a fix.

## 6. Parent consent for a watch sign-in

### 6.1 The rule (PROPOSED)

A watch session is only issued after a parent on file approves it. This reuses the same model the app already has for photos and the "Forgot your code?" sign-in: a one-time code emailed to the parent email already on the player's record, never to an address typed on the device (`docs/parent-photo-consent.md`, `api/login.js` `request-code`).

### 6.2 Two ways to build it

**Option A, works with today's server (no new endpoints).** After the kid picks their name, the watch calls `POST /api/login?action=request-code { playerId }`. The parent gets the existing "Your Thwap Hockey sign-in code" email, reads the 6-digit code, and either types it into the kid's watch or reads it out. The watch calls `POST /api/login?action=verify { playerId, code, keep: true }` and stores the token. Downsides: the email copy says "sign-in code", not "approve a watch"; the jersey code step is skipped entirely; the parent has to be physically next to the watch.

**Option B, recommended (PROPOSED, new endpoints).** The watch calls a new `watch-request` action with the player and their jersey code. The server checks the jersey code, then emails the parent "Lewie wants to use Thwap on a watch. Approve?" with a big Approve button (a one-time link) and, as a fallback, the 6-digit code. The watch polls a new `watch-status` action every 5 seconds for up to 10 minutes. When the parent taps Approve on their own phone, the next poll returns the token. The parent never has to touch the kid's watch, which suits a parent at work approving a kid at the rink.

Both options record consent through the existing `recordConsent` call, so the consent record stays in one place.

### 6.3 Revoking a watch (PROPOSED)

Add a small server-side list of approved watches per player (`watch:<playerId>`, holding a device label, approval time, and a hash of the token). `/api/done` and the other watch-used endpoints check that a watch token's hash is still on the list. The approval email includes a "Remove this watch" link, and the web app's parent area can list and remove watches later. This is the only part of the design that adds a storage read on every watch request.

## 7. Endpoints

Everything below was read from the files named. The project is at Vercel's 12-function limit on the Hobby plan (comments in `api/board.js`, `api/billing.js`, `api/push.js`, `api/coach.js`), so **every new endpoint is a new `?action=` or `?view=` on an existing file**, never a new file in `api/`.

### 7.1 Endpoint table

| Watch need | Endpoint | Status | Request | Response (read from code) |
|---|---|---|---|---|
| Sign in with jersey code | `POST /api/login?action=code-signin` | Exists | `{ playerId, code, email?, keep }` | `200 { ok, player: { id, name, number } }` plus `Set-Cookie: thwapSession=...`. `401 { error: 'bad code' }`, `400 { error: 'unknown player' }` |
| Email parent a one-time code | `POST /api/login?action=request-code` | Exists | `{ playerId }` | `200 { ok, sent }` (count of emails sent, always 200 so it cannot probe the roster). `429` when rate limited, `503` when email is not set up |
| Check parent code, issue session | `POST /api/login?action=verify` | Exists | `{ playerId, code, keep }` | `200 { ok, player }` plus `Set-Cookie`. `401 { error: 'bad code', reason }` |
| Is my token still good | `GET /api/login?action=session` | Exists | none (token in `Cookie` header) | `200 { authed, player? }` |
| Sign out | `POST /api/login?action=logout` | Exists | none | `200 { ok }` (clears cookie; the watch also deletes its Keychain item) |
| Today's checkmarks | `GET /api/done` | Exists | none (session only, never a client id) | `200 { ok, player, date, drills: ['dryland:0', 'dryland#wall-sit', ...], disciplines: { dryland: true } }`. `401` without a session |
| This week's checkmarks | `GET /api/done?week=1` | Exists | none | `200 { ok, player, week: { start, end }, drills, disciplines }` |
| Check off a drill | `POST /api/done` | Exists | `{ player, discipline, drillId, drillName, date? }` | `200 { player: <counts>, ok, drills }`, or `200 { ok, duplicate: true, drills }` when that drill was already recorded that day. `401`, `403 'not your account'`, `402 { gated: true }` (unpaid season), `400 'bad date'` (more than 7 days back or in the future) |
| Undo a check-off | `POST /api/done` | Exists | `{ player, drillId, undo: true }` | `200 { ok, undo: true, drills }`. Today only; does not lower the count |
| Weekly counts | `GET /api/board?tf=week` | Exists, but not a good fit | none, public | `200 { players: [ { id, stick, shoot, dryland, netplay, iq, pass, cheers }, ... ] }` for the whole roster. The watch would download every teammate's numbers to show its own rings |
| Team schedule | `GET /api/coach?action=schedule&code=` | Exists | `code` | `200 { ok, schedule: { practices, events: [ { id, kind: 'game', date, time, home, opponent, place } ] }, next }` |
| Coach's weekly plan | `GET /api/coach?action=get-plan&code=` | Exists | `code` | `200 { ok, plan, billing }` |
| Coach's team goal | `GET /api/coach?action=team-goal&code=` | Exists | `code` | `200 { ok, teamGoal }` |
| Team player list for the name picker | `GET /api/login?action=team-players&code=` | **New (PROPOSED)** | `code` | `200 { ok, team: { name }, players: [ { id, firstName, number } ] }`. No last names, no emails |
| Ask a parent to approve a watch | `POST /api/login?action=watch-request` | **New (PROPOSED)** | `{ playerId, code, deviceLabel }` | `200 { ok, requestId, sent }`. Checks the jersey code first; `401` on a bad code |
| Wait for approval | `GET /api/login?action=watch-status&requestId=` | **New (PROPOSED)** | `requestId` | `200 { status: 'pending' \| 'approved' \| 'expired', token?, exp?, player? }`. The token is returned once, then the request is deleted |
| Parent approves from email | `GET /api/login?action=watch-approve&t=` | **New (PROPOSED)** | one-time link token | A plain web page: "Approved. Lewie's watch is signed in." Records consent |
| Parent removes a watch | `POST /api/login?action=watch-revoke` | **New (PROPOSED)** | `{ t }` from the email link, or a parent web session | `200 { ok }` |
| Today's drill list with timer scripts | `GET /api/done?view=today` | Built (lib/drills.js) | none (session) | `200 { ok, date, restDay, drills: [ { id: 'dryland:0', discipline: 'dryland', name, dose, cue, steps, timer: { type, sets, workSeconds, restSeconds } \| null, done } ] }` |
| My rings for the complication | `GET /api/done?view=rings` | Built (goal = player view per-discipline count) | none (session) | `200 { ok, week: { start, end }, rings: { stick: { done, goal }, shoot: { done, goal }, dryland: { done, goal } } }` (`netplay` replaces `shoot` for goalies, per `disciplinesFor` in `lib/store.js`) |
| Save game day picks | `POST /api/coach?action=save-game-goals` | **New (PROPOSED)** | `{ gameId, goalIds }`, session gated | `200 { ok }`. Called by the web Game Day Goals page, not the watch |
| My game day goals | `GET /api/coach?action=my-game-goals` | **New (PROPOSED)** | none (session) | `200 { ok, gameDay, game: { id, date, time, opponent, home, place } \| null, goals: [ { id, title } ], teamGoal }` |

### 7.2 Why "today's drills" needs a new endpoint

Today's drill list is built entirely in the browser. `index.html` holds the drill library (`MOVE`, `WORKOUTS`), the weekday rotation (`thwapWeekday`, `thwapWeekdaySlot`), the coach's picks from `get-plan` (`thwapCoachDrillNames`), and the timer scripts (`scriptFor` and `buildSteps` behind `window.thwapDrillTimer`). The server never sees the list.

Drill ids are positional: `dryland:3` means "the fourth dryland drill on today's list" (`thwapMarkDone('dryland', 'dryland:'+i, ...)` in `index.html`). A second id based on the name, like `dryland#wall-sit`, is also stored (`nameSlugId` in `api/done.js`). If the watch built its own list and got the order even slightly different from the web app, a drill checked on the watch would show up as a different drill checked on the tablet.

**PROPOSED:** move the drill library, rotation and timer scripts into a shared server module (for example `lib/drills.js`) that both `index.html` and the new `GET /api/done?view=today` use, so there is one source of truth. The rejected alternative is copying the library into the Swift app, which would drift the first time a drill is renamed.

### 7.3 Why Game Day Goals needs new endpoints

The goals a player picks on `hockey_game_goals.html` are saved only in that device's browser storage (`localStorage` key `thwapGameGoals`). The server only has a log of check-offs (`log-game-goal`), not the picks. A watch has no way to see picks made on a tablet. The web page has to start saving picks to the server before the watch can show them.

Game day is defined the same way the web app's "next game" card does it: an event with `kind: 'game'` on today's Vancouver date in the schedule (`lib/schedule_store.js`, `window.ThwapGameDay` in `index.html`).

### 7.4 Ring goals

The weekly count per discipline is server truth (`weekBoard` in `lib/store.js`, Monday-based weeks, Vancouver time). The ring's goal (the number that fills the ring) is only worked out in the browser today, and the code has more than one version (a flat `WEEK_TARGET = 10` on the coach view, and a per-discipline goal from the drill catalog on the player stat view). The new `rings` view needs one agreed goal. See open questions.

## 8. The complication

- Built with WidgetKit (Apple's widget framework). Families: circular (three small rings stacked or a single combined ring), rectangular (three labeled bars), and corner. **PROPOSED:** ship circular and rectangular first.
- Data comes from `GET /api/done?view=rings`. The widget's timeline asks the system to refresh about every 30 minutes. watchOS sets the real budget, so it can lag by minutes, which the product owner has accepted.
- After every successful check-off the watch app writes the new counts into a shared App Group container (storage both the app and widget can read) and asks WidgetKit to reload. So the complication is usually right within seconds of a check-off made on the watch, and only lags for check-offs made on another device.
- A queued, unsynced check-off counts toward the ring on the watch straight away, so the kid sees their work land. If the server later rejects it, the ring goes back.
- Tapping the complication opens the Today screen.

## 9. Offline check-offs

Rinks and basements often have no signal, so check-offs must never be lost because the watch was offline.

**PROPOSED rules:**

1. **Every check-off is saved on the watch first,** shown as done straight away, and put in a queue on disk. Each queue entry holds `{ discipline, drillId, drillName, date, action: 'mark' | 'undo', createdAt }`. The `date` is the Vancouver calendar date at the moment of the tap, because that is the day the server uses (`localDateStr` in `lib/store.js`).
2. **The queue sends in order** whenever the watch has a connection, at app launch, and in a background refresh task.
3. **A mark is sent with its `date`.** `POST /api/done` accepts a `date` up to 7 days back (`validBackdate`), so a drill done Monday night offline and synced Tuesday morning is still filed on Monday and the streak is right.
4. **Done is safe to repeat.** If the same `drillId` is already on the server for that day, the server records nothing new and answers `duplicate: true` (the idempotency guard in `api/done.js`). A retry after a dropped connection can never double-count.
5. **The server wins.** After the queue empties, the watch calls `GET /api/done` and replaces its own checkmarks with the server's list. If a parent un-checked a drill on the tablet, it is un-checked on the watch.
6. **Undo only works for today.** The server's undo has no `date` field and always acts on today (`removeDrillDone` defaults to today). A queued undo whose day has passed is dropped quietly.
7. **What happens to failures:**
   - `401` (sign-in expired): keep the queue, show the sign-in screen. Send it all after the parent approves again.
   - `402` (season not active): drop the entry and show "Your team's season is not active yet. Ask your coach."
   - `400 bad date` (more than 7 days old): drop the entry.
   - Network error or `5xx` server error: keep it and try again later, waiting longer each time.
8. **The watch never shows a red "failed" buzz** for a sync problem. A small cloud icon with a count ("2 waiting to sync") is enough.

## 10. Haptic map

All buzzes use `WKInterfaceDevice.current().play(_:)` with a `WKHapticType`. Apple only plays one at a time, so a "strong" buzz is two played back to back. **PROPOSED, needs a real-wrist test with kids:**

| Event | `WKHapticType` | Why |
|---|---|---|
| Timer starts | `.start` | The standard "something began" tap |
| Last 3 seconds of a work or rest phase | `.click` once per second | A countdown the kid can feel without looking |
| A set is done, rest begins | `.stop` | Clear "stop now" |
| Rest is over, next set | `.directionUp` | "Go again" |
| Drill finished, timer ends | `.success` | The timer part is done; the kid still taps Done |
| **Check-off, the THWAP stamp** | `.notification`, then `.success` about 150 milliseconds later | The strongest pattern on the watch; this is the signature moment |
| Undo a check-off | `.directionDown` | Feels like taking something back, but gentle |
| Sign-in approved by parent | `.success` | Celebration |
| Wrong jersey code | `.retry` | "Try again", not a scolding buzz. `.failure` is never used for kids |
| Pause or resume | `.click` | Light confirm |

Haptics are never the only signal. Every buzz has a matching on-screen change, and kids with buzzing turned off in watch settings still see everything.

To keep the timer running when the kid lowers their wrist, **PROPOSED:** use an extended runtime session of the "physical therapy" type (`WKExtendedRuntimeSession`, up to an hour), not a HealthKit workout session. A HealthKit workout would need permission to read and write a child's health data, which version 1 does not need.

## 11. Accessibility

- **Large type.** All text uses Dynamic Type (the user's text size setting) and is tested at the largest accessibility sizes. Drill names wrap rather than shrink. The timer number scales but never below the size that fits the round screen.
- **Big targets.** Every tappable item is at least 44 by 44 points, with full-width rows. Done and Pause are separate, far apart, and Done is the larger one.
- **VoiceOver** (the screen reader). Every row reads as a sentence, for example "Wall Sit. 4 sets of 30 seconds. Not done. Double tap to start." The timer announces phase changes ("Rest, 10 seconds") rather than every second. The THWAP stamp reads "Done. Wall Sit checked off."
- **Digital Crown** scrolls the Today list and never changes a timer value by accident.
- **Reduce Motion.** The stamp animation becomes a simple fade.
- **Color is never the only signal.** Done rows have a checkmark shape, not just a color change, and rings carry a number.
- **Plain words.** Copy follows `docs/ux-writing.md` (ages 8 to 13, short action-first lines).

## 12. Privacy for children's data

Thwap's players are under 13, so the Children's Online Privacy Protection Act (COPPA, United States) and the Personal Information Protection and Electronic Documents Act (PIPEDA, Canada) apply, as `docs/terms-and-privacy.md` already notes.

**PROPOSED rules for the watch:**

- **Stored on the watch:** the player id (a first name, which the app already uses as the id), jersey number, the session token in the Keychain, today's drill list, the ring numbers, and the offline queue. Nothing else.
- **Not collected:** no HealthKit data (heart rate, workouts), no location, no microphone, no contacts, no analytics, no ads, no third-party code libraries. Apple's App Store privacy label for the watch app should read "Data not collected" apart from the sign-in itself.
- **Parent emails never reach the watch.** The new `team-players` action returns first names and jersey numbers only.
- **Consent is recorded the same way as today,** through `recordConsent` at the moment a parent approves.
- **Sign out wipes everything** on the watch.
- **The session token holds no email,** only a hash of it (`lib/session_store.js`), so a lost watch does not leak a parent's address.
- The privacy policy needs a short new section saying a watch can be signed in, what it stores, and how a parent removes it.

**Found while reading the code (not caused by the watch, but the watch must not use these):**

- `GET /api/coach?action=roster&code=` needs no sign-in and returns every player's `parentEmails` (`roster` in `api/coach.js`). Anyone with a team code can read parent email addresses.
- `POST /api/coach?action=join` needs no sign-in and returns the full member record from `getMember`, which includes parent emails.
- `POST /api/coach?action=log-game-goal` needs no sign-in, so anyone can write to any player's game goal log.

These are worth fixing before the watch launches, because a watch app makes team codes more widely typed and shared.

## 13. Open questions for the product owner

1. **Parent approval: Option A or Option B?** Option A (parent reads the emailed code into the watch) needs no new server work. Option B (parent taps Approve in the email, the watch signs in by itself) is a better experience but needs four new server actions. The agent recommends B.
2. **How long should a watch stay signed in?** Today's longest session is 30 days. Should a watch get the same, longer (for example a full season), or shorter? A longer life only feels safe with the "remove this watch" list from section 6.3.
3. **Do we build the "remove this watch" list in version 1?** Without it, a lost watch keeps working until its token expires.
4. **Multi-team players.** `code-signin` only knows the 16 players in the fixed `ROSTER` in `lib/store.js`. Should the watch wait for sign-in to move to the multi-team members store, or launch for the Jr. Rangers 10U team only?
5. **Team codes have letters** (for example `RANGERS72`), which are slow to enter on a watch. Is that acceptable, or should coaches get a numbers-only watch code?
6. **What fills a ring?** The web app has two different weekly goals today (a flat 10 drills on the coach view, a per-discipline count from the drill catalog on the player view). Which number should the complication use?
7. **Goalies.** Should the second ring say "Net play" for goalies (matching `disciplinesFor`), or always "Shooting"?
8. **Moving the drill library to the server.** Are you comfortable with the drill library, rotation and timer scripts moving out of `index.html` into a shared module the web app and the watch both use? This is the largest piece of work in the plan.
9. **Game Day Goals picks are only saved on one device today.** Is it OK for the web Game Day Goals page to start saving picks to the server (needed for the watch to show them)?
10. **Weekend bonus reps.** Leave them out of the watch in version 1, or show them?
11. **Undo on the wrist.** Is a confirm step ("Undo this drill?") right, or should a tap on a done row undo straight away like the web app?
12. **Minimum watch.** Is watchOS 10 (Series 4 and later, and the SE models) the right floor, or do players have older watches?
13. **App Store setup.** Ship the watch app inside the existing iPhone app listing, or as its own listing? Do we want the Kids category, which forbids any analytics or ads?
14. **The three unauthenticated endpoints in section 12** that expose parent emails or allow writes. Fix them before the watch launch?
15. **Haptic strength.** Who tests the haptic map on real kids' wrists, and is the double buzz for THWAP strong enough or too much?

## 14. Suggested build order (PROPOSED)

1. Server: `team-players`, the shared drill module, `GET /api/done?view=today`, and `view=rings`. Unit tests for each, alongside the existing tests in `test/`.
2. Server: parent approval (Option A works with no server change if B is not chosen yet).
3. Install the watchOS simulator runtime. Watch app: sign in, Today list, check-off with the offline queue.
4. Timer and haptics, tested on a real watch.
5. Complication.
6. Game Day Goals (needs the web page to save picks to the server first).
7. Privacy policy update, App Store privacy label, and a small test session with players.

## 15. Decisions (product owner, Oct 28 2026)

- **Parent approval: Option B.** The parent taps Approve in the email. This happens once per player, not once per sign-in.
- **Teams:** move sign-in to the multi-team members store before the watch launches. No launch limited to Jr. Rangers 10U.
- **Security:** fix the three endpoints in section 12 first, as their own PR, before any watch server work.
- **Shared data:** move the drill library, rotation and timer scripts to a shared server module, and save Game Day Goals picks on the server.

Agent defaults, open to change in review: a 30-day watch session, a "remove this watch" list in version 1, rings filled by the player view's per-discipline count, "Net play" as the goalie's second ring, no weekend bonus reps in version 1, a confirm step before undo, watchOS 10 as the oldest supported version, and shipping inside the existing iPhone app listing.

Build order: (1) security fix, (2) multi-team sign-in, (3) shared drill module plus server-saved Game Day Goals, (4) parent approval actions, (5) the watch app's real API client replacing the placeholder data.
