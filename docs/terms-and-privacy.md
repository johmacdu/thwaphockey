# Thwap Hockey - Terms of Use and Privacy Policy

Status: DRAFT for legal review (Woody, 2026-10-07). This replaces the stub copy
currently in the sign-in sheet and footer kebab. It is written to map to what
Thwap actually collects and stores (see `parent-photo-consent.md` and the
`api/` endpoints), not to invented practices.

> **This is not legal advice and I am not a lawyer.** Thwap is a children's app
> that collects a parent email, sends one-time codes, and stores a child's
> photo. That puts it squarely under COPPA (US) and PIPEDA (Canada). Before this
> text goes live as the real policy, a lawyer who knows children's-privacy law
> should review it, especially the verifiable-parental-consent method, the
> sub-processor list, retention periods, and the data-deletion promise. The
> notes in **REVIEW** callouts below flag the decisions a lawyer should settle.

---

## How this is maintained

There is ONE source of policy text: this file. The in-app policy sheet
(`policySheet` in `index.html`, opened from both the sign-in links and the
footer kebab) must carry the same words. When this doc changes in a way that
matters, bump the effective date here AND in the app, and the sign-in flow asks
the user to agree again (the app already re-prompts on a material change).

**Current effective date: September 2026** (placeholder until the first
legal-reviewed version ships; set the real date on launch).

---

## Part 1 - Terms of Use

Thwap Hockey is a home-training app for youth hockey players. It gives a player
short daily stickhandling, shooting and dryland drills, tracks the training they
mark done, and shows that progress to the player and their team coach. By using
Thwap Hockey you agree to these terms.

### Who uses it
Thwap Hockey is used by youth players, their parents, and their team coaches. A
player under 13 may use the app only with a parent's involvement and consent. A
coach uses the app to set the team plan and see how players are progressing.

### What you agree to
- Use the app for its purpose: youth hockey training and coaching.
- Keep your sign-in details private. A team password gates the coach view; do
  not share it with players.
- Do not upload content that is not yours to share, and do not misuse another
  person's account.
- A parent, not a child, adds a player photo, and only of their own child.

### Training and safety
The drills are general training suggestions, not medical or professional
coaching advice. A player should train within their ability and stop if
something hurts. A parent or coach should judge whether a drill is right for a
given player. Thwap Hockey is not responsible for injuries that happen during
training.

### The app as-is
Thwap is offered as-is for a youth hockey team. We work to keep it running and
accurate, but we do not promise it will be uninterrupted or error-free.

> **REVIEW:** a lawyer should decide how far the as-is / limitation-of-liability
> and the injury disclaimer can and should go for a free youth-sports app, and
> whether an arbitration/governing-law clause is wanted (Washington state).

### Changes
We may update these terms as the app grows. When the terms change in a way that
matters, we will ask you to agree again at sign-in. Continuing to use the app
after a change means you accept the updated terms.

### Contact
Questions about these terms: hello@thwaphockey.com.

---

## Part 2 - Privacy Policy

Thwap Hockey is built for children, so we collect as little as we can and we are
plain about what we keep and why. This section explains what we collect, why,
who can see it, how long we keep it, and how a parent removes it.

### What we collect

**About a player**
- First name, jersey number, and position (from the team roster).
- The training the player marks done (which drills, which days). This is what
  shows the player and their coach how they are progressing.
- A player photo, ONLY if a parent adds one (see "Parent-added photos" below).

**From a parent**
- A parent email, so we can reach a parent and get consent. For the photo
  feature we store it as described below.
- A one-time 6-digit code we email to a parent to verify consent. The code is
  short-lived and expires.

**About a coach**
- Name, email, and an optional photo.

**On the waitlist (people not yet on a team)**
- Name, association/team, age level, and email, submitted on the waitlist form
  so we can reach out when Thwap opens for that team.

We do not collect a home address, phone number, precise location, or a child's
own contact information. We do not track children with advertising tools, and we
do not show third-party advertising to children.

> **REVIEW:** confirm this "what we collect" list stays exhaustive as features
> ship. If anything new begins collecting data from or about a child (e.g.
> teammate kudos, messaging), this list and the consent flow must be updated
> first.

### Parent-added photos (the most sensitive thing we store)
A player photo is a child's face, so it is handled with the most care:
- A **parent**, not the child, adds or removes the photo, after verifying with
  the one-time email code. The child never uploads.
- The photo is cropped and resized in the browser before it is sent, stored on
  our hosting provider, and shown ONLY on that player's own card, never on the
  leaderboard or in another player's view.
- A parent can remove the photo at any time, which deletes it from our storage.

### How we verify a parent (consent)
For a player under 13, we obtain a parent's consent before that child's
information is used in the ways above, in line with COPPA (US) and PIPEDA
(Canada). We verify a parent by emailing a one-time code to the parent's email
and having them enter it. We keep a record that consent was given and when.

> **REVIEW:** email + one-time-code is the chosen verifiable-consent method.
> A lawyer should confirm it meets COPPA's standard for the data involved
> (COPPA treats a photo of a child as personal information; the FTC's
> email-plus method and its limits should be checked against what we store).

### How we use it
We use this information only to run the app: to show a player their drills and
progress, to let their coach see team progress, to show a parent-added photo on
that player's card, and to contact a parent about consent. We do not sell
personal information.

### Who can see it, and who helps us run the app
A player's training and photo are visible to that player, their parent, and
their team's coaches. They are not shared publicly. To run the app we use a
small number of trusted service providers, and share only what each needs:
- **Hosting and the database** that stores player progress, photos, and consent
  records.
- **Email delivery** to send the one-time parent codes and waitlist replies.

> **REVIEW:** name the actual sub-processors here before launch (today:
> Vercel for hosting, Upstash Redis for the database, and the chosen email
> provider - Resend or AWS SES - per the open decision in
> `parent-photo-consent.md`). COPPA/PIPEDA both expect these to be disclosed,
> and each should be under an agreement that limits them to running the service.

### How long we keep it, and how to remove it
- A player's roster info and training stay while the player is on a team.
- A player photo stays until a parent removes it.
- The one-time email codes expire automatically (they are short-lived).
- A parent or coach can remove a player from a team. A parent can ask us to
  delete their child's information entirely, including the photo and the consent
  record. Email us and we will take care of it.

> **REVIEW:** set concrete retention periods a lawyer is comfortable with (e.g.
> what happens to a player's data at the end of a season, or when a team stops
> using Thwap), and confirm the deletion path actually erases the stored photo
> blob and consent record, not just the roster row.

### Keeping it safe
We serve the app over HTTPS, store a parent's one-time codes only briefly, and
limit how a photo can be reached (its link is not guessable from a player's
name). No system is perfectly secure, but we work to protect children's
information and to limit what we collect in the first place.

### A parent's rights
A parent can, at any time: review what we hold about their child, ask us to
correct it, ask us to delete it, and withdraw consent (which means we remove the
child's photo and stop using their information for anything beyond what a coach
needs to run the team). Email us and we will help.

### Contact
Privacy questions, or to review, correct, or delete a child's information:
privacy@thwaphockey.com.

> **REVIEW:** both hello@ and privacy@thwaphockey.com must be real inboxes
> someone monitors, since the policy promises a parent can reach us to delete a
> child's data. A promise to delete that no one receives is worse than no
> promise.

---

## Punctuation rule
No middle-dot and no em-dash or double-hyphen anywhere in this copy or its
in-app port (per Woody's standing rule). Verify with grep after any edit.
