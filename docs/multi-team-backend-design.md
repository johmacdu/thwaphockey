# Thwap Hockey - Multi-Team Product: Backend Design

Status: DRAFT for Woody's review. Nothing here is built yet. Business decisions
(pricing, who pays, launch scope) are marked **[WOODY DECISION]** and are not
invented.

Governing principle still applies: make every detail perfect, limit the number
of details. This doc favors the smallest architecture that supports many teams,
not the most powerful one.

## 0. What changes and why

Today: one static `index.html`, one shared Redis, per-device localStorage. No
teams, no accounts, no login. It works because it serves exactly one team.

To serve many teams we need three things the current app lacks: **identity**
(who is this, which team), **persistent per-team data** (roster, progress,
billing state in a real database), and **authorization** (managers edit, players
view). That is a real backend application. This doc pins the shape before any
code so we build in reviewable slices, not piecemeal onto the static file.

## 1. Roles (the model everything keys off)

Three roles, kept deliberately small:

- **Manager** (coach/team admin): signs in with an account, manages the roster,
  owns billing. One or a few per team.
- **Player/Parent**: no account. Enters the team via a team code, uses the app,
  and the parent photo-consent gate (already built) is the only thing that needs
  a per-action credential (email OTP).
- **(Later) Org/Club admin**: manages multiple teams. NOT in v1. Named here so
  the schema does not have to be rewritten to add it.

Rationale: only the manager needs a real account. Pushing accounts onto every
kid/parent would be a COPPA and adoption disaster. The team code + parent OTP
model keeps children accountless, which is the safe default.

**[WOODY DECISION]** Is a single manager per team enough for v1, or do you need
multiple co-managers (assistant coaches) from the start?

## 2. Team access: team code + optional PIN

- Landing screen: search/pick your team, enter a **team code** to load that
  team's app (roster, drills, leaderboard).
- The team code is low-security by design (it is shared with the whole team); it
  scopes *which team you see*, not *what you can change*.
- **Manager actions are gated by the manager's real login, not the team code.**
  So a kid with the code can use the app; only the signed-in manager can edit the
  roster or billing. This is the separation the current single-PIN model lacks.

**[WOODY DECISION]** Team code only, or team code + a rotating join PIN the
manager can reset (in case a code leaks)? Recommend: code + manager-resettable
PIN, cheap to add.

## 3. Data model (Postgres)

Move off Redis-as-database to a real relational store. Redis stays as a cache
(see section 6). Proposed tables:

```
orgs            (id, name, created_at)                     -- future; nullable FK for v1
teams           (id, org_id?, name, slug, team_code, join_pin_hash,
                 billing_status, plan, stripe_customer_id, created_at)
managers        (id, email, auth_provider_id, created_at)
team_managers   (team_id, manager_id, role)                -- many-to-many, future co-coaches
players         (id, team_id, first_name, last_name, jersey, position, created_at)
drills          (id, team_id?, discipline, name, cue, steps, position_scope)
                 -- position_scope lets a drill apply to all or only some positions
progress        (id, player_id, drill_id, done_date)       -- one row per completion
photos          (player_id, url, consent_token_ref, created_at)  -- already designed
otp / consent   (as already built for the photo gate)
```

Key modeling decisions:

- **`players.position`** is a first-class field. This is where the goalie
  question lands: a drill carries a `position_scope` (e.g. `all` or
  `skater` or `goalie`), so **Shooting can be scoped to skaters** and a goalie
  simply is not shown/scored on it. This is the clean home for the goalie fix -
  designed in here, not retrofitted onto the current single-team app.
- **`progress`** is append-only (one row per completion), which makes streaks,
  leaderboards, and per-discipline counts a query, not a mutated counter. Honest
  by construction: no fabricated numbers.
- **`teams.billing_status`** drives access (active / past_due / canceled),
  written by the Stripe webhook (section 5).

**[WOODY DECISION]** Do drills differ per team (each manager writes their own),
or is there one Thwap-authored drill library all teams share (managers just
toggle which are active)? This changes whether `drills.team_id` is required.
Recommend: shared Thwap library + per-team on/off, so you control content quality
and no team invents unsafe drills.

## 4. Services / logic (Vercel functions)

Keep the serverless-function shape you already use. Endpoints grouped:

- **auth**: manager sign-in (delegated to an auth provider - section 7), session.
- **team**: resolve team by code, get team app payload (roster + active drills +
  leaderboard), manager-only team settings.
- **roster**: manager CRUD on players (create/edit/remove, set position/jersey).
- **progress**: record a completion (player action), read board/streaks.
- **billing**: create Stripe Checkout session, customer portal link, webhook
  receiver.
- **photo**: the OTP + consent + blob endpoints already built, now scoped by team.

Authorization is enforced **server-side per endpoint** (never trust the client):
roster/billing/settings require a valid manager session whose `team_managers` row
matches the target team; progress-record requires only a valid team code.

## 5. Payments (Stripe)

Shape is standard and low-risk once the model is decided:

- Stripe **Checkout** for the manager to subscribe; Stripe **Customer Portal**
  (hosted) for them to manage/cancel - saves us building billing UI.
- A **webhook** (`checkout.session.completed`, `customer.subscription.updated/
  deleted`) writes `teams.billing_status` + `plan`. The app reads that flag to
  gate access.
- Store only `stripe_customer_id` / `subscription_id` - never card data.

**[WOODY DECISION] - this one gates the whole billing build:** who pays, for
what, and how much?
- Per-team subscription (manager pays monthly/yearly for the whole team)?
- Per-season one-time?
- Free tier (e.g. up to N players) + paid above?
**[WOODY DECISION] - DECIDED: seasonal per-team pricing (artifact
`thwap-pricing-model-corrected`, confirmed 2026-09-30).** The TEAM is the paying
customer, never individual parents - one payer, one invoice per team.

- **In-season: $50/month x 9 months = $450.**
- **Off-season: $75 flat** for the whole off-season (a retention play to keep
  teams through summer; the off-season seasonality content must justify even $75,
  so pricing and the seasonality feature are linked).
- **Full year: $525 per team.**
- The team recovers it from parents at its own discretion (~12 players ->
  ~$3.75/player/month). That is the TEAM's sales line to families, NOT Thwap's
  price; Thwap only ever bills the team ($525/yr quoted to the coach/treasurer).

Stripe shape: this is NOT a single flat monthly price. Model it as an in-season
monthly plan ($50) plus an off-season flat charge ($75), or an annual $525 plan -
settle the exact Stripe product shape when the billing slice is built.
`teams.billing_status` (active / trialing / past_due / canceled) gates access via
the webhook.

**The gate is at TRIAL EXPIRY, not at team creation:**
1. Coach creates a team + gets a code - FREE, instant, no card (keep the growth
   loop friction-free).
2. Kids join on a **30-day free trial**.
3. At day 30 the TEAM pays (in-season monthly / off-season / annual) or the team
   goes read-only / locked.

So team creation itself is free; billing is enforced when the trial expires. The
current Jr. Rangers team is a FREE seeded founder team, so none of this blocks it.

## 6. Caching

- **Postgres is the source of truth.** Redis becomes a read-through cache for the
  hot path: the team app payload (roster + active drills + leaderboard), keyed by
  team, short TTL, invalidated on any roster/progress write.
- The leaderboard is the one thing read constantly and written often; cache it
  per team with a few-second TTL so a game-day rush does not hammer Postgres.
- Everything else (billing, auth) hits Postgres directly - low volume.

## 7. Auth approach

Managers need real accounts; kids/parents do not. Options for the manager auth:

- **Managed provider (Clerk / Auth.js / Supabase Auth)** - email magic-link or
  email+password, password reset, sessions handled for us. Least code, fastest,
  fewer ways to get security wrong.
- **Roll our own** - more control, much more responsibility (hashing, reset
  tokens, session security). Not worth it for a small team product.

Recommend a **managed provider with email magic-link** (no passwords to store or
leak; matches the OTP pattern parents already see). If we use Supabase, its
Postgres + Auth come together, which collapses two decisions into one.

**[WOODY DECISION]** Managed auth provider (recommend yes) - and if yes, do you
want to standardize on **Supabase** (Postgres + Auth + storage in one) to keep
the stack small?

## 8. Security / ops

- **Child data is the highest-weight concern.** Player records are names +
  jersey + position + progress; photos are the sensitive asset and already sit
  behind parent OTP consent. Harden photo reads to token-gated private before any
  real team onboards (already flagged as a near-term task).
- **Server-side authorization on every mutating endpoint** - the team code is not
  a permission.
- **Rate-limit** OTP and auth endpoints (already done for OTP).
- **Tenant isolation**: every query is scoped by `team_id`; a manager can never
  read/write another team's data. This is the single most important invariant in
  a multi-tenant app - worth a dedicated test suite.
- **Backups**: Postgres automated backups (managed provider gives this).
- **Secrets** in Vercel env vars (the pattern we just set up for photos).
- **Audit**: log manager mutations (who changed the roster, when).

## 9. Native app vs responsive web vs PWA

- **Responsive web first** - it is what exists, zero install friction, one
  codebase. Kids/parents reach it by URL.
- **PWA** (installable, home-screen icon, offline) is the cheap next step and
  probably the right ceiling for a while - add-to-home-screen without App Store
  overhead.
- **Native (iOS/Android)** only when there is paying-team demand that needs push
  notifications or store presence. It is two more codebases (or React Native) and
  real cost. Not v1.

**[WOODY DECISION]** Confirm: responsive-web/PWA first, native deferred until
demand justifies it?

## 10. Build order (reviewable slices)

Once the decisions above are made, build in this order, each a shippable slice:

1. Postgres + data model + tenant isolation (no UI yet, tested).
2. Manager auth (managed provider) + team creation.
3. Team code access + team app payload (read path; the current app, now
   multi-tenant).
4. Manager roster CRUD.
5. Progress recording + leaderboard on the new backend.
6. Stripe billing + webhook + access gating.
7. Position-aware drills (fixes the goalie/Shooting gap as a feature).
8. Photo consent, scoped per team (port the built flow).

## Create-team: belongs here, not to the single-team file

The lightweight `create-team` action in the current `api/coach.js` mints a team
with no auth and no payment. A free, no-gate "create a team" button is NOT the
product we want. **PR #277 (a UI for that endpoint) was closed on 2026-09-30**
for this reason. The real create-team flow is **slice 2 below** (manager auth +
team creation). Note the gate is at **30-day trial expiry (slice 6 / section 5)**,
NOT at creation: creating a team is free and friction-free (it feeds the growth
loop); the team pays when the trial ends or goes read-only. Requirements carried
over from the closed PR:

- **All three fields required**: team name, association, age group (no silent
  `10U` default - the manager picks it). The current endpoint only requires name.
- Create-team is a **manager-account** action, not a coach-token action.
- A newly created team is `billing_status = trialing`; at day 30 it must become
  `active` (manager completed Stripe) or the team goes read-only / locked.

## Open decisions summary (all yours)

1. Single manager vs co-managers in v1.
2. Team code only vs code + resettable PIN.
3. Shared Thwap drill library vs per-team drills.
4. ~~Billing model + price~~ **DECIDED: seasonal per-team - $50/mo x9 in-season + $75 off-season = $525/yr; free create, 30-day trial, gate at trial expiry (see section 5).**
5. Managed auth provider, and whether to standardize on Supabase.
6. Responsive/PWA first, native deferred - confirm.

Answer these and I can turn build order (section 10) into real slices.

## Goalie drill (Woody chose option B, scheduled NEXT WEEK)

Woody wants Shooting swapped for a goalie-specific drill for goalies (not shown
to skaters). This is the position-aware-drills feature (section 3:
players.position + drills.position_scope). Deferred to next week because it needs
goalie drill CONTENT from Woody (drill names, cues, steps) which cannot be
invented, and it belongs in the position_scope model rather than retrofitted onto
the current single-team file. When picked up: add a goalie drill with
position_scope=goalie, scope Shooting to position_scope=skater.
