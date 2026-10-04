# Thwap Hockey Team Leaderboard: Backend Plan

A simple, low-cost way to give the Thwap Hockey static site a real team leaderboard that syncs across every kid's device. Written for a non-technical setup, step by step.

## 1. Architecture

The site stays exactly as it is today (a static site on Vercel). We add three tiny serverless functions and one small database.

- **Static site** (unchanged): the app the kids already use, served from `johmacdu/thwaphockey` at thwaphockey.com.
- **Serverless functions** (new, live in `/api/`):
  - `GET /api/board` reads the whole leaderboard and returns it.
  - `POST /api/done` records a completion for one player (stick, shoot, or dryland) after a PIN check.
  - `POST /api/seed` (admin only) sets up all 16 players the first time. Protected by a secret key.
- **Vercel KV** (new): a small key-value database, part of Vercel, no separate account or server to run. Scales to near-zero cost for a team this size.

### Data model

One record per player, keyed by first name in lowercase:

```
player:lewie -> {
  stick: 0,
  shoot: 0,
  dryland: 0,
  streak: 0,
  stickers: 0,
  updatedAt: "2027-01-14T18:22:00Z"
}
```

- 16 players total, one record each.
- No personal information: no emails, no passwords, no birthdates, no location, no photos.
- No accounts and no sign-up.

## 2. Provision Vercel KV (exact dashboard steps)

1. Go to vercel.com and open the **thwaphockey** project.
2. Click the **Storage** tab.
3. Click **Create Database**, choose **KV**, name it something like `thwap-kv`.
4. When it asks which project to connect, select **thwaphockey** and connect it.
5. Vercel automatically adds the `KV_*` environment variables to the project. You do not copy these by hand, they are injected for you.

### Set the two extra environment variables

In the project, go to **Settings -> Environment Variables** and add:

- `SEASON_YEAR` = `2027`
- `SEED_KEY` = a long random string (see below)

Generate a random `SEED_KEY` by running this in a terminal and pasting the output as the value:

```
openssl rand -hex 24
```

Keep the `SEED_KEY` private. It is only used once, for seeding.

After adding env vars, **redeploy** the project so the functions pick them up.

## 3. The PIN gate

Each kid confirms a completion with a simple PIN.

- **PIN formula**: jersey number followed by the season year.
- Example: Lewie is number 72, season is 2027, so his PIN is `722027`.
- The PIN is checked on the server inside `/api/done`, not just in the browser.

### Honest note on what this is

This is a **team-level speed-bump, not per-kid security**. Kids on the team can figure out each other's PINs, and that is fine for a 10U honor-system team. It stops random outsiders and accidental taps, nothing more.

Each new season, bump `SEASON_YEAR` (for example to `2028`). Every PIN rolls over automatically, so last season's PINs stop working.

## 4. Room to grow (KV to Supabase later)

If the team outgrows Vercel KV, we can move to a bigger database (Supabase) without rewriting the app.

- Every database call lives in **one file**: `/api/store.js`.
- The three functions (`board`, `done`, `seed`) and the whole frontend only talk to `store.js`, never to the database directly.
- Migrating later means: rewrite `store.js` and add a "team" dimension to the data (so multiple teams can share the backend). The routes and the frontend do not change.

Keeping all database logic in `store.js` is the whole trick that makes this cheap to do now and easy to grow later.

## 5. COPPA and privacy note

- The leaderboard ties completion counts to a coach-known **first name plus jersey number**, nothing more.
- No emails, no passwords, no birthdates, no location, no photos.
- No self-registration: kids cannot create their own entries. The coach manages a fixed 16-player roster.
- This is deliberately minimal-data by design.
- This is **not legal advice**. If the program grows or adds any real personal data, review it with someone qualified.

## 6. One-time seeding

After KV is connected and the project is deployed, create all 16 player records once.

Run this in a terminal, replacing the domain and using your real `SEED_KEY`:

```
curl -X POST https://thwaphockey.com/api/seed \
  -H "x-seed-key: PASTE_YOUR_SEED_KEY_HERE"
```

- Send it once. It sets up the 16 players with zeroed counts.
- If it succeeds you will get a short confirmation response.
- After seeding, `GET /api/board` should return the full roster.

You only seed once per season setup. Normal use never needs the `SEED_KEY` again.
