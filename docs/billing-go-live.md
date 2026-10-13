# Thwap Hockey billing go-live runbook

Seasonal team billing is fully built but inert. Nothing charges and nothing is
gated until you (1) wire up Stripe and (2) flip `BILLING_ENFORCED=1`. This is the
exact, ordered procedure to turn it on safely, plus how to comp Lewie's team and
how to roll back in seconds.

Everything lives on one serverless function (`api/billing.js`, dispatched on
`?action=`) to respect Vercel's 12-function cap. The store is `lib/billing_store.js`
(Upstash Redis). Season windows and prices are pure logic in `lib/seasons.js`. The
enforcement gate (`isGated` / `BILLING_ENFORCED`) is read by `api/done.js` (player
mark-done) and `api/coach.js` (set-plan).

---

## 0. What "active" means (the model)

A team may train when ANY of these is true:

- it is marked **free** (a comp, e.g. Lewie's Jr. Rangers 10U), OR
- it has an **active annual subscription** (auto-renew, covers every season), OR
- the **current season key** is present in its paid-seasons map.

Seasons (America/Vancouver, inclusive), from `lib/seasons.js`:

| Season       | Months          | Price | Season id | Key example  | One-time price env  |
|--------------|-----------------|-------|-----------|--------------|---------------------|
| Fall/Winter  | Sep 1 - Mar 31  | $350  | `fw`      | `fw-2025`    | `STRIPE_PRICE_FW`   |
| Spring       | Apr 1 - Jun 30  | $90   | `sp`      | `sp-2026`    | `STRIPE_PRICE_SP`   |
| Off-season   | Jul 1 - Aug 31  | $60   | `os`      | `os-2026`    | `STRIPE_PRICE_OS`   |

The three seasons total **$500**. The **annual auto-renew** is a single recurring
yearly price of **$500/yr** (`STRIPE_PRICE_ANNUAL`) that covers all three seasons
and renews automatically. Fall/Winter spans two calendar years; its key year is the
September it began (Jan-Mar maps back to the prior year, so Jan 2026 is `fw-2025`).

---

## 1. Create the 4 Stripe prices

Do this in **Test mode first**, then repeat in Live mode. You need 4 Prices across
your Product(s). The season passes are **one-time**; the annual is **recurring**.

1. Fall/Winter pass - **$350.00 USD, One time** -> copy its Price id into `STRIPE_PRICE_FW`
2. Spring pass - **$90.00 USD, One time** -> `STRIPE_PRICE_SP`
3. Off-season pass - **$60.00 USD, One time** -> `STRIPE_PRICE_OS`
4. Annual auto-renew - **$500.00 USD, Recurring, Yearly** -> `STRIPE_PRICE_ANNUAL`

Notes:
- A Price id looks like `price_1Ab...`. These are **not secrets**; they identify
  which Price a Checkout Session bills.
- `STRIPE_PRICE_ANNUAL` MUST be a recurring (yearly) Price. The other three MUST be
  one-time. Mixing these up makes `create-subscription` or `create-checkout` fail.
- The displayed dollar amounts in the app come from `lib/seasons.js`, not Stripe, so
  keep the Stripe amounts in sync with that file ($350 / $90 / $60 / $500).

Also enable the **Customer Billing Portal** (Stripe Dashboard -> Settings ->
Billing -> Customer portal, and Save). The `?action=portal` endpoint opens it so a
coach can update their card, cancel/resume, and download past invoices. Stripe emails
a receipt on every payment, so Thwap intentionally does not generate its own.

---

## 2. Set environment variables in Vercel

Set these on the Production environment (and Preview, if you test there). Mark the
secret ones as Sensitive. **Do NOT set `BILLING_ENFORCED` yet** - that is the last
switch, in step 7.

Stripe (from step 1 and the Stripe Dashboard):

| Env var               | Secret? | Example (non-secret shape)        | Purpose |
|-----------------------|---------|-----------------------------------|---------|
| `STRIPE_SECRET_KEY`   | yes     | `sk_live_...`                     | Server-side Stripe calls (lazy-loaded; billing 503s until this is set) |
| `STRIPE_WEBHOOK_SECRET` | yes   | `whsec_...`                       | Verifies webhook signatures (set in step 4) |
| `STRIPE_PRICE_FW`     | no      | `price_FallWinter350`             | Fall/Winter one-time price |
| `STRIPE_PRICE_SP`     | no      | `price_Spring90`                  | Spring one-time price |
| `STRIPE_PRICE_OS`     | no      | `price_OffSeason60`               | Off-season one-time price |
| `STRIPE_PRICE_ANNUAL` | no      | `price_Annual500yr`               | Annual recurring ($500/yr) price |

Billing controls:

| Env var                | Secret? | Example                 | Purpose |
|------------------------|---------|-------------------------|---------|
| `BILLING_COMP_CODES`   | no      | `MacDuffie2016`         | Comma-separated self-serve comp codes (see step 6) |
| `BILLING_ADMIN_SECRET` | yes     | `pick-a-long-random-string` | Authorizes the admin `set-free` comp toggle |
| `BILLING_ENFORCED`     | no      | `1`                     | **Set to `1` to enforce. Leave UNSET until step 7.** |

Renewal-reminder email (optional; reuses the login/waitlist Resend setup). If either
is missing, the `invoice.upcoming` heads-up email is a silent no-op and billing still
works:

| Env var             | Secret? | Example                 | Purpose |
|---------------------|---------|-------------------------|---------|
| `RESEND_API_KEY`    | yes     | `re_...`                | Sends the pre-renewal heads-up email |
| `PHOTO_FROM_EMAIL`  | no      | `hi@thwaphockey.com`    | From address for that email |

Redis (already set app-wide; listed for completeness). `KV_REST_API_*` is read first,
`UPSTASH_REDIS_REST_*` is the fallback:

| Env var             | Secret? | Purpose |
|---------------------|---------|---------|
| `KV_REST_API_URL`   | no      | Upstash Redis REST URL |
| `KV_REST_API_TOKEN` | yes     | Upstash Redis REST token |

Redeploy after setting env vars so the functions pick them up.

---

## 3. Deploy and smoke-test with enforcement OFF

With Stripe keys + prices set but `BILLING_ENFORCED` still unset:

- `GET /api/billing?action=status&code=<TEAM>` -> `200` with
  `{ active: false, enforced: false, gated: false, currentSeason: "<key>" }`.
- `GET /api/billing?action=screen&code=<TEAM>` -> `200` listing `buyable` seasons
  with prices.
- `POST /api/billing?action=create-checkout` with `{ "code":"<TEAM>",
  "seasons":["<currentKey>"] }` -> `200 { url }` (a real Stripe Checkout URL).

If `create-checkout` returns `503 billing not configured`, `STRIPE_SECRET_KEY` is
missing. If it returns `503 missing Stripe price for <key>`, that season's price env
is missing or misspelled.

Nothing is gated yet: coaches can still edit plans and kids can still log work. Good.

---

## 4. Register the Stripe webhook

The endpoint is the billing function with the `webhook` action:

```
https://thwaphockey.com/api/billing?action=webhook
```

In Stripe Dashboard -> Developers -> Webhooks -> Add endpoint, register **exactly
these event types**:

- `checkout.session.completed`     (records one-time seasons; activates a subscription immediately on subscription-mode checkout)
- `customer.subscription.created`  (stores the subscription + renewal date)
- `customer.subscription.updated`  (status changes, renewal date, cancel-at-period-end)
- `customer.subscription.deleted`  (marks the subscription canceled; keeps the customer id for the portal)
- `invoice.upcoming`               (fires the pre-renewal heads-up email)

Then copy the endpoint's **Signing secret** (`whsec_...`) into
`STRIPE_WEBHOOK_SECRET` (step 2) and redeploy. The handler reads the raw request
body (bodyParser is off) so the signature check sees the exact bytes Stripe sent; a
bad/missing signature returns `400` and records nothing. If `STRIPE_WEBHOOK_SECRET`
is unset, the webhook returns `503` (configure it, don't leave it blank).

For the `invoice.upcoming` email, set how many days ahead Stripe sends it in the
subscription/billing settings (e.g. 7 days before renewal).

---

## 5. Test a real purchase (Stripe Test mode) end to end

Still with enforcement OFF, in Test mode:

1. Create a throwaway team, call `create-checkout` for the current season, open the
   returned URL, and pay with Stripe test card `4242 4242 4242 4242` (any future
   expiry, any CVC/ZIP).
2. Confirm the `checkout.session.completed` event is delivered (Stripe Dashboard ->
   Webhooks shows `200`).
3. `GET ...?action=status&code=<TEAM>` now shows `active: true` and the season key in
   `paidSeasons`. `?action=screen` shows it under `paid` with a receipt amount/date.
4. Test the annual path: `create-subscription`, pay, confirm `customer.subscription.
   created` lands and `status` shows `subscribed: true`.
5. Test the portal: `POST ...?action=portal` for that team returns a portal URL that
   opens.

When all of that works in Test mode, repeat step 1 (create the 4 prices) and step 4
(register the webhook) in **Live mode**, and swap the Live `sk_live_...` /
`whsec_...` / live `price_...` ids into the env.

---

## 6. Comp Lewie's team (and anyone else who should be free)

Two independent ways to comp a team. Both keep that team active with no charge.

**A. Comp code (per season, self-serve).** `BILLING_COMP_CODES=MacDuffie2016`
(comma-separate more codes if needed). A coach or parent enters the code in-app,
which calls:

```
POST /api/billing?action=redeem   { "code": "<TEAM>", "comp": "MacDuffie2016" }
```

Comp-code matching is case-insensitive. It frees the **current season only** and must
be **re-applied each new season** (it records a $0 paid season tagged
`comp:MacDuffie2016`). This is the route named for Lewie's Jr. Rangers 10U. Note the
comp code is Stripe-independent, so it works even before Stripe is wired up.

**B. Permanent free (admin, every season).** Mark a team free forever with no
re-apply, using the admin secret from step 2:

```
POST /api/billing?action=set-free   { "code": "<TEAM>", "free": true, "secret": "<BILLING_ADMIN_SECRET>" }
```

Send `"free": false` to un-comp. Use this (not a comp code) if you want Lewie's team
covered indefinitely without touching it each season.

Verify either way with `?action=status&code=<TEAM>` -> `active: true` (and `free:
true` for route B).

---

## 7. Flip enforcement ON

This is the single go-live switch. Set:

```
BILLING_ENFORCED=1
```

in Vercel (Production) and redeploy. Only the exact string `1` enables enforcement;
any other value (`0`, `true`, unset) leaves it off.

From this point, for a team that is NOT active:
- `POST /api/coach?action=set-plan` returns `402 { gated: true }` (coach cannot edit
  the weekly plan), and
- `POST /api/done` (a kid logging a completion) returns `402 { gated: true }`.

Reads are never gated (status/screen/get-plan/the GET on `done` all keep working), so
the app can show a paywall from data it already fetches.

---

## 8. Verify end to end with enforcement ON

1. **Covered teams keep working.** For Lewie's comped team and any paid/subscribed
   team: `status` shows `active: true`, `set-plan` and `done` still return `200`.
2. **Unpaid team is gated.** For a fresh unpaid team: `status` shows
   `{ enforced: true, active: false, gated: true }`; `set-plan` and `done` return
   `402 { gated: true }`; the in-app paywall appears.
3. **Pay unlocks it.** Run a real (Live mode) purchase for that team; after the
   webhook lands, `status` shows `active: true` and the `402`s become `200`.
4. Spot-check the annual auto-renew team and confirm the `invoice.upcoming` email
   arrives ahead of renewal (if Resend is configured).

The `done` gate FAILS OPEN: if a player's team cannot be resolved, or billing cannot
be read, the kid is allowed to log work rather than being wrongly locked out.

---

## 9. Rollback (seconds, no data loss)

If anything looks wrong after go-live:

1. **Unset `BILLING_ENFORCED`** (or set it to `0`) in Vercel and redeploy.
   Enforcement becomes a complete no-op immediately: every `isGated` check returns
   `false`, all `402`s go away, and the paywall disappears. No billing data is
   touched - recorded seasons, subscriptions, and comps are all preserved, so you can
   re-enable later by setting it back to `1`.
2. If a specific team was gated wrongly, comp it (step 6) rather than disabling
   enforcement globally.
3. To stop charging entirely, also pause/disable the webhook in Stripe and remove
   `STRIPE_SECRET_KEY`; the endpoints then return `503 billing not configured` and
   create no new sessions. (Leave Redis data in place.)

---

## Action reference (api/billing.js)

| Method + action                         | Body / query                         | Returns |
|-----------------------------------------|--------------------------------------|---------|
| `POST ?action=create-checkout`          | `{ code, seasons:[key,...] }`        | `{ url }` one-time Checkout |
| `POST ?action=create-subscription`      | `{ code }`                           | `{ url }` annual auto-renew Checkout |
| `POST ?action=portal`                   | `{ code }`                           | `{ url }` Stripe billing portal |
| `POST ?action=webhook`                  | Stripe event (raw body, signed)      | `{ received: true }` |
| `GET  ?action=status&code=XXX`          | -                                    | `{ active, free, subscribed, currentSeason, enforced, gated, paidSeasons }` |
| `GET  ?action=screen&code=XXX`          | -                                    | `{ paid[], buyable[], subscription, ... }` |
| `POST ?action=redeem`                   | `{ code, comp }`                     | comps the current season |
| `POST ?action=set-free`                 | `{ code, free, secret }`             | admin comp toggle (permanent free) |

Tests covering all of the above: `test/seasons.test.js`, `test/billing-store.test.js`,
`test/billing-endpoint.test.js`, `test/billing-unconfigured.test.js`,
`test/done-gated.test.js`, and the set-plan gate in `test/coach.test.js`. Run the full
suite with `npx vitest run --exclude '**/worktrees/**'`.
