# About Thwap - Page Plan, Strategy, Writing, Design

Status: plan (not built). This writes down the About/marketing page we have
talked about but never documented. It is grounded in the existing steering docs
(`brand.md`, `jtbd.md`, `child-centered-design.md`, `thwap-roadmap.md`) and the
content-integrity rule: nothing on this page is invented. No em-dashes, no
middle-dots, plain language.

## 1. The problem this page solves

thwaphockey.com today is ONLY the product. A visitor who is not already a signed
in player hits the splash and a sign-in wall. There is nowhere that answers the
first question anyone new asks: what is this, who is it for, and why would my kid
use it. A coach forwarded the link, a parent taps it, and the first thing they
meet is a locked door.

The About page is that missing front door. It explains Thwap in plain language
to the people who decide whether a kid uses it (parents and coaches), without
getting in the way of the kid who just wants to train.

## 2. Who it is for (in priority order)

1. **A parent** who got the link from their coach and is deciding whether to let
   their kid in. Wants: is this safe, is it free, what does my kid actually do,
   do I have to do anything.
2. **A coach** evaluating it for the team. Wants: what does it do for my players,
   how much work is it for me, is it built for 10U.
3. **The kid**, who may land here too. Should feel the energy and want in, but
   this page is not where they train. One tap gets them to the real thing.

The product talks to the player. This page talks mostly to the adult who lets the
player in, while never talking down about the kid.

## 3. Strategy and scope

- **This is a marketing/explainer page, not a second product.** It does its one
  job (explain Thwap, send the right person to the right next step) and stops.
  Same JTBD discipline as every Thwap page: one job, no grab-bag.
- **It is the public face.** It can live before the sign-in wall so a logged-out
  visitor reaches it, with the product one tap away.
- **It is honest.** It describes only what Thwap actually is today (the training
  loop, the team board, the card, the rewards that are built). It does not
  promise drills, videos, or features that are not shipped. If something is
  coming, it is not on this page until it ships. This is the same content
  integrity rule from `brand.md`: never present a placeholder as the real thing.
- **It is for Jr Rangers 10U first.** Thwap is built for one real team right now.
  The page speaks to that reality rather than inventing a generic SaaS pitch. If
  it ever opens to more teams, this page is where that story would change, and
  that is a deliberate later decision, not a silent assumption now.

**Decision (locked):** the About page sits at `/about`. It does NOT replace the
logged-out splash. The splash and its Break-the-Ice animation, sound, and theme
toggles stay exactly as they are. The product entry flow is untouched. Because of
that, discovery is the thing this plan must solve, see section 7.1.

## 4. The one thing it must get across

> Thwap is where a young hockey player trains at home and feels like a real
> player, and where the whole team pulls in the same direction.

Everything on the page serves that sentence. It is a kid's hockey world (training
happens inside it), not a parent's training-planner. That framing (from
`thwap-design-direction.md`) is the soul of the pitch: cool, not cute; the kid is
the hero, the adult is trusted.

## 5. Page structure (sections, top to bottom)

Each section is one idea. A visitor should be able to skim the headings alone and
get it.

### 5.0 Discovery: how anyone reaches `/about`

This is the one weakness of the `/about` choice and the plan has to answer it
head on, because a coach pastes `thwaphockey.com`, not `thwaphockey.com/about`.
`/about` only does its job if there is a reliable path to it. The plan:

- **A quiet link on the splash itself.** A small, non-intrusive "What is Thwap?"
  text link on the logged-out splash (not a button competing with Sign In / Join
  Waitlist), so a new visitor who hits the wall has one honest way to understand
  it. This is the single most important hookup, since the splash is where the
  cold traffic actually lands.
- **The share link coaches hand out can point at `/about`.** When Woody or a
  coach forwards Thwap to a new parent, the link to share is
  `thwaphockey.com/about`, not the apex. The apex stays the product for people
  who already know it.
- **A link in the header nav** (logged out) so it is reachable from any screen.

Without at least the splash link, `/about` is a page almost nobody finds. That
link is part of this build, not optional.

1. **Hero.** The mascot (free standing, never boxed, per `brand.md`), the
   wordmark, and the one line from section 4 in plain kid-and-parent language.
   One primary action: Open Thwap (sends a player to the product splash), with a
   quieter Join Waitlist for a new parent or coach who is not ready to enter.
2. **What a kid does.** Three plain blocks matching the real product: train today
   (stickhandling, shooting, dryland), set Game Day Goals, collect their card and
   stickers. Show, do not tell: a real screen, not a mock promise.
3. **How the team wins together.** The team board / Standings idea stated the way
   the product means it: everyone's training fills a shared team goal. Explicitly
   not a ranking of kids. This is a differentiator and a trust signal at once.
4. **Why it is safe (for parents).** Plain answers: no kid passwords, no kid
   emails, photos are parent-gated with email consent, per-device, nothing
   shaming or pressuring. Pull the real stance from `child-centered-design.md`.
   This is the section that turns a cautious parent into a yes.
5. **For coaches.** One short block: set each player's focus, see who is training
   and who needs attention, pick what the team trains. Built for 10U, dead
   simple, not a Kraken-style spreadsheet.
6. **Who made it / why.** A short, honest origin line. Built for a real team
   (Vancouver Jr Rangers 10U) by a hockey parent, designed around the kid first.
   Keeps it human and local, not a faceless app-store product.
7. **Footer.** The real slogan (placeholder "Compete. Improve. Have fun." until
   the coach gives the team's real motto, per `brand.md`), the TM wordmark, the
   sound and theme toggles, and the Thwap Hockey trademark line already shipped.

Hard rule from `jtbd.md` and `no_cards_without_navigation`: a block that is
read-only explanation is plain type in whitespace, not a card. Cards are only for
things you tap. An About page is mostly reading, so most of it is flat.

## 6. Writing (voice, tone, sample copy)

Voice (from `brand.md`): fun, encouraging, a little bold. A cool teammate, not a
schoolteacher. For the parent-facing safety section, warm and straight, no hype.

Writing rule (from the kid design lens): if a kid cannot remember it skating onto
the ice, it is too long. Short sentences. Long explanation goes behind a Why
layer, not on the surface.

Sample copy (placeholder, for shape only, Woody confirms the final words):

- Hero line: "Train at home. Show up for your team. Feel like a real player."
- What a kid does: "Three things, about 30 minutes. Stickhandling, shooting, and
  dryland, picked for today. Check them off, build your streak, fill your card."
- Team section: "Every drill anybody does fills the team bar. Nobody is ranked.
  The whole team gets better together."
- Safety line (to parents): "No passwords for kids. No emails from kids. Photos
  are added by a parent, with your okay. Your kid trains, you stay in control."
- Coach line: "See who is training, set each player's focus, pick what the team
  works on. Built for a 10U team, not a spreadsheet."

Banned everywhere (from stored prefs): the middle-dot character and em-dashes.
Use plain words, commas, or line breaks. Verify with grep after writing copy.

## 7. Design direction

- **Same design system as the product** (`design-system.md` section 16 tokens),
  so the About page and the app feel like one thing. Deep forest green dark
  theme, green accent, Nunito Sans + Archivo Black, flips cleanly to light.
- **Mobile first.** Most visitors tap a link on a phone. Single column, big type,
  generous whitespace. Shared 1100px max container at desktop (per the width
  rule), one column under the 760px breakpoint.
- **Body/UI text never below 14px** (Vitaly legibility floor). Set the legible
  baseline first, then expressive display sizes.
- **The mascot is free standing and transparent, never in a box.** It is the warm
  human-ish anchor of the hero, same as the splash.
- **Show real screens, not invented mockups.** A screenshot of the real home, the
  real card, the real team bar. Honesty is the brand. Do not render a fake screen
  that promises content that is not shipped.
- **Delight earns its place** (`delight-system.md`): any motion rewards reading or
  arriving, is short, respects prefers-reduced-motion, no confetti, no autoplay
  sound. The page can be calm, it does not need to perform.
- **Accessibility baked in:** 48px tap targets, focus-visible rings, color never
  the only cue, measured WCAG contrast on real hex values both themes (not
  eyeballed), per the stored contrast rule.

## 8. Primary actions (what the page sends people to)

- Player: "Open Thwap" into the product (splash / sign in).
- New parent or coach: a clear, low-pressure way in. Today that is the existing
  Join Waitlist / Sign In in the header nav. The About page points to those; it
  does not invent a new signup flow.
- No action is forced. A visitor can read the whole page and leave, same voluntary
  stance as the product.

## 9. What this page must NOT become

- A second dashboard or a feature list that outlives the product's real state.
- A page that promises drills, videos, or features that are not shipped.
- A generic multi-team SaaS pitch while Thwap is one real team's app.
- A wall of cards for read-only content.
- A place that talks down about kids to sell to parents.

## 10. Build notes (when Woody says go)

- Decision locked: `/about` is a separate page reachable from the splash. The
  splash is NOT replaced. The must-build hookup is a quiet "What is Thwap?" link
  on the logged-out splash (section 5.0), without which `/about` is unreachable.
- Reuse the shipped header nav (auth-aware: logged out Sign In / Join Waitlist;
  signed in Stickers / Players / Standings) rather than inventing navigation.
- Build it as a mockup first (per Woody's build-the-mockup-before-touching-
  index.html preference) so the shape is agreed before it goes near the product.
- No invented content. Every claim maps to a shipped feature or gets cut.
