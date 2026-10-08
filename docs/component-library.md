# Thwap Component Library

**Why this file exists.** Thwap is a few large single-file pages (`index.html`,
`about.html`). Because the same visual control is hand-written in several places,
it keeps drifting: a close button gets re-styled on one page, a menu gets its own
one-off outside-click handler, a card look lands on something that isn't tappable.
This file is the single catalog of every UI element used **more than once**. Before
you build any control that already appears here, **reuse the canonical class and
markup below** instead of writing a new one.

## How to use this catalog

1. Need a control? Find it here first. If it's listed, copy its **canonical class
   and markup** and change nothing structural.
2. Each entry says **where the CSS lives** (`index.html` is the source of truth).
   If you use a component on a page that doesn't define its rule yet (e.g.
   `about.html`), **copy the rule verbatim from `index.html`**, do not re-style it.
   (This is exactly the bug that put the plain `×` on the About Terms page: the
   `glassclose` class was used but its rule was never copied over.)
3. Everything is built from the tokens and type/spacing scale in
   `design-system.md §16`. If a value isn't a token, it's a bug.
4. When you add a genuinely new reusable component, **add it here** in the same
   format, so the next editor reuses it instead of reinventing it.

The authoritative visual language (color, type, spacing, motion, cards, mascot)
lives in `design-system.md`. This file is the component index that enforces it.

---

## 1. Buttons & interactive controls

### Glass close button: `.glassclose`
The ONE close/dismiss affordance for any full-screen page (Terms, Privacy, coach
signup, any drill-in page). iOS-style frosted glass circle, 48×48, top-right.
**There is exactly one close button in the product. Never hand-roll a `×`.**

- **Defined in:** `index.html` (`.glassclose`, `.glassclose:hover`, `.glassclose:active`).
- **Markup:**
  ```html
  <button type="button" class="glassclose" aria-label="Close">&#215;</button>
  ```
  Add a page-specific positioning modifier only (e.g. `policy-x`, `cs-x`), never
  override the glass look (radius, blur, size, colors).
- **Reuse rule:** circular (`border-radius:50%`), 48×48, `backdrop-filter` blur,
  theme tokens for fill/border/text. If you're on a page that hasn't defined
  `.glassclose`, copy the rule block from `index.html` first.
- **Do NOT:** use a rounded-square with a solid fill, a bare glyph with no button,
  or a per-page custom close. (Learned: the sign-in sheet close and the About
  policy close both regressed to non-glass variants and had to be fixed.)

### Glass back button: `.glassback`
Pill-shaped glass "Back" control for drill-in / sub-pages. Plain label **"Back"**,
NO chevron (`<`/`‹`).

- **Defined in:** `index.html` (`.glassback`).
- **Reuse rule:** label text is exactly `Back`. Chevrons on list-row indicators are
  a separate thing and are left alone.

### Nav kebab: `.kebab` + `.kebabmenu` ("Explore")
The mobile (`<=640px`) nav menu that collapses `.toplinks`. Two instances: player
(`#kebab`/`#kebabMenu`) and coach (`#kebabC`/`#kebabMenuC`).

- **Defined in:** `index.html` (`.kebab`, `.kebabmenu`).
- **Behavior:** registered with the **shared menu manager** (see §4). Do not add a
  bespoke open/close handler.

### Footer kebab: `.footkebab` + `.footmenu` + `.footmenu-item`
The three-dot footer menu (bottom-right of `.footer`). Items: About, Sign out, and
the **in-product-only** Report a bug / Request a feature.

- **Defined in:** `index.html` (`.footkebab`, `.footmenu`, `.footmenu-item`).
- **Markup for an item:**
  ```html
  <a class="footmenu-item" href="/about" role="menuitem">About Thwap</a>
  ```
- **Placement rules (important, these have regressed before):**
  - **Visibility matrix by auth state (two gate classes on the items):**
    | Item | Splash (signed out, `body.login-locked`) | In product (signed in) |
    |---|---|---|
    | About Thwap | shown | shown |
    | Terms of Use | shown | hidden |
    | Privacy Policy | shown | hidden |
    | Report a bug | hidden | shown |
    | Request a feature | hidden | shown |
    | Sign out | hidden (already signed out) | shown |
  - Terms/Privacy items carry `footmenu-splash`; Report/Feature/Sign out carry
    `footmenu-inproduct`; About carries neither (always shown). The CSS gate:
    ```css
    .footmenu-item.footmenu-splash{display:none}
    body.login-locked .footmenu-item.footmenu-inproduct{display:none}
    body.login-locked .footmenu-item.footmenu-splash{display:block}
    ```
  - Splash Terms/Privacy (`#menuTerms`/`#menuPrivacy`) open the full-page policy
    overlay via `window.thwapOpenPolicy('terms'|'privacy')` (same handler used
    elsewhere). Terms/Privacy ALSO live on the About page footer; they do NOT
    appear in the in-product footer.
- **Behavior:** registered with the shared menu manager (see §4).

### Segment / timeframe toggle: `.seg` + `.segbtn`
Week / All-time style pill toggle.

- **Defined in:** `index.html`. Reuse for any two-or-three-way view switch; don't
  build a second toggle style.

### Sound & theme toggles: `.sfxtoggle`, `.themetoggle`
The footer sound-on/off icon and the light/dark toggle. Live in `.footer-actions`
(web chrome); in the native shell they move to the Profile tab.

- **Defined in:** `index.html`. State keys: `thwapSfxOn`, `thwapTheme`.
- **Reuse rule:** any sound effect MUST check `thwapSfxOn` before playing
  (narration mute is the separate `thwapMuted`). The splash impact sound regressed
  by checking only `thwapMuted`.

---

## 2. Surfaces & containers

### Full-page overlay: `.policy-page` / `.cs-page`
A full-screen page that sits above everything (`position:fixed; inset:0`), scrolls
internally, and is dismissed by the glass close button (§1). Used for Terms,
Privacy, and the coach signup.

- **Defined in:** `index.html` (`.policy-page`); `.cs-page` is the coach-signup
  variant with a `.cs-inner` content wrapper.
- **Reuse rule:** when a flow needs its own page, use this pattern, NOT a centered
  `.login-modal` bottom sheet. A sheet is for a short confirm; a page is for
  content you scroll (legal copy, a multi-field form).
- **Pairing:** always ships with a `.glassclose` and an Esc-to-close.

### Centered sheet: `.login-modal`
A centered dialog card (max-width ~360) for the sign-in / waitlist short forms.

- **Defined in:** `index.html`.
- **Reuse rule:** short forms only. If it scrolls or is a whole flow, use a
  full-page overlay instead.

### Card: `.pcard` (player card) and the "cards rule"
Player card is the strongest visual expression (front identity / back progress);
see `design-system.md §9`.

- **THE CARDS RULE (hard, product-wide):** never put the card look (border / fill /
  elevation / rounded container) on something that is **not interactive and does
  not navigate**. A greeting, a status line ("Welcome back / Not you?"), a plain
  label must be styled flat. Cards are for picking/collecting; rows are for action
  queues and checklists.

---

## 3. Lists, rows & data display

### Roster / leaderboard row: `.board` + `.row`
Rank / name / value grid rows with position dots (`.pos-fwd` / `.pos-def` /
`.pos-goalie`). Used on the roster and standings.

- **Defined in:** `index.html`.
- **Reuse rule:** action queues (who needs attention, talking points) are **rows**,
  not cards (see the cards rule).

### Stat tiles: `.metrics`/`.metric` and `.pl-tot`
Weekly rings and all-time totals on the player stats page. Tapping a tile/ring
filters the activity list (both the week rings and the all-time tiles toggle the
same `plFilter`).

- **Defined in:** `index.html`.
- **Reuse rule:** if a metric is tappable it must actually filter, don't ship a
  ring that only animates. (Learned: the week rings had no filter handler.)

### Drill row: `.exrow` (expandable checklist row)
A drill in the Stickhandling/Shooting/Dryland checklist: chunky discipline-colored
row, expands to cue / steps / "Watch how" video, then Mark done (lime + THWAP
stamp). Discipline colors: Hands green `#4E9128`, Shooting blue `#3E88D8`, Dryland
orange `#E07A1F`.

- **Defined in:** `index.html`.
- **Reuse rule:** a do-and-check-off task is a checklist row, NOT a Game Day Goals
  card. Video affordance is the inline `▶ Watch how` expand link, not an embedded
  iframe.

### Hero: `.hero` (`.kicker` eyebrow + h1 + `p`)
The page-top greeting/intro block.

- **Defined in:** `index.html`.
- **Reuse rule:** do not stack a second big-bold label under the greeting; one
  greeting line plus the supporting line.

### Pill / tag: `.pill`
Duration pills, "optional training" tags, status chips. Rounded 999px.

- **Defined in:** `index.html`.
- **Reuse rule:** an optional/bonus pill is a LIGHTER version of its sibling in the
  SAME color family (same `.pill` tokens), never a different intense hue.

### Footer trademark: `.trademark`
Quiet muted centered line with the TM wordmark. Uses the plain `&trade;` entity (TM,
not ®). Product name is "Thwap Hockey".

- **Defined in:** `index.html`.

---

## 4. Shared menu manager (behavioral component)

**One popover menu open at a time, across the whole page.** The footer kebab and
both nav kebabs register with a single manager (`registerThwapMenu()` in
`index.html`). Opening one closes the others; a single document-level listener
closes whichever menu a click (or Escape) fell outside of.

- **Reuse rule:** register every new popover/kebab/dropdown with the manager:
  ```js
  var reg = (window.__thwapMenus || (window.__thwapMenus = registerThwapMenu()));
  reg.add(triggerEl, menuEl);
  ```
- **Do NOT** give a menu its own bespoke open/close handler, and **never call
  `stopPropagation()`** in a menu handler. That was the exact root cause of
  "tapping Explore didn't close the footer kebab": each menu stopped the click
  before the others' outside-click listeners could see it. Let every click reach
  the document.
- **Covers:** tap-outside-to-close, tap-another-trigger-to-switch (bidirectional),
  and Escape-to-close, for free.

---

## 5. Punctuation & copy rules (apply to every component)

- **No middle-dot (`·`) and no em/en dashes (`—` / `–`)** anywhere in copy or UI.
  Use plain words, commas, or line breaks. Verify with `grep -nE "·|—|–"` after
  edits.
- Back buttons read plain **"Back"** (no chevron).
- Short, kid-voice copy. "THWAP! DONE. Nice work.", not "Congratulations!".

---

## Checklist before you ship a UI change

- [ ] Does this control already exist in this catalog? If so, reuse its class +
      markup; don't restyle it.
- [ ] If I used a shared class on a new page, did I copy its CSS rule verbatim from
      `index.html` (not approximate it)?
- [ ] Is every popover registered with the shared menu manager (no bespoke
      handler, no `stopPropagation`)?
- [ ] Does the close button use `.glassclose`? Back button plain "Back"?
- [ ] Card look only on something interactive that navigates?
- [ ] No `·`, no `—`/`–`? (`grep -nE "·|—|–"`)
- [ ] Values are tokens from `design-system.md §16`, not hand-set px?
- [ ] If I built something genuinely new and reusable, did I add it to this file?
