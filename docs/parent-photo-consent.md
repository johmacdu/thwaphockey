# Thwap Hockey - Parent-Gated Player Photo (design)

Status: approved to build (Woody, 2026-09-18). Email OTP chosen over SMS.

## Goal
A parent can add or edit their player's card photo, and it syncs across that
player's devices (laptop, tablet, phone). The player (a kid under 13) never
uploads; a parent does, after a one-time email verification. At 13+ the rules
relax, but 13+ is out of scope for now.

## Why a parent gate at all
The photo is a child's face. Storing it on a server is lawful when a parent
consents and is the one who uploads it (this is how SportsEngine / TeamSnap /
Sprocket / Playmetrics work: the account holder is an adult). Email OTP is the
consent signal: cheaper than SMS, no phone-number PII, gives a real address for
a deletion/privacy notice.

## Flow
1. On the player card, the photo button reads "Add your photo" (no photo) or
   "Edit photo" (photo exists).
2. Tapping it opens a parent gate: "A parent adds the photo. Enter a parent's
   email to get a code."
3. Parent enters email. Server emails a 6-digit code (10-minute expiry).
4. Parent enters the code. On success the server issues a short-lived,
   player-scoped upload token (parent stays "verified" on this device for a
   bounded window, e.g. 30 days, so they are not re-coding every edit).
5. Parent picks a photo (native file input; on phone/tablet the OS offers
   camera or library). Browser crops to the card ratio and downscales BEFORE
   upload (same as today's local path).
6. Client uploads the cropped image with the token. Server stores it and returns
   a URL. The card shows it, and every device the player signs in on now loads
   the same photo.
7. Edit = same as add for a verified parent (no re-code within the window).
   Remove = an explicit "Remove photo" choice, parent-gated the same way.

## What is stored (minimize, per the governing principle)
Server (Upstash Redis + object storage for the image blob):
- `photo:<playerId>` -> { url, updatedAt } (the stored, cropped JPEG; ~560x760).
- `parentEmail:<playerId>` -> hashed email (store a HASH for matching + a
  deletion contact; do not store raw email if a hash suffices for re-verify).
  DECISION NEEDED: store raw email (to send deletion confirmations) vs hash only.
- `otp:<email>` -> { codeHash, expiresAt, attempts } (transient, 10-min TTL).
- `consent:<playerId>` -> { emailHash, grantedAt } (the consent record COPPA
  wants: who consented, when).
Client (unchanged from today, as a cache): the last-seen photo in localStorage
so the card renders instantly offline.

NOT stored: no phone number, no parent name, no child name beyond the existing
roster first name, no analytics on the photo.

## Deletion (required, not optional)
- A parent (verified) can remove the photo: deletes `photo:<playerId>` and the
  blob, keeps nothing.
- A privacy contact (email) can request full deletion of the child's photo +
  consent record. Honor it. This is why we keep a way to reach the parent.
- Document retention: photo persists until removed; OTPs auto-expire.

## Security / safety
- Upload token is player-scoped and short-lived; it cannot touch another player.
- Rate-limit OTP requests per email and per player (block brute force).
- Image is validated server-side (real image, size cap) before storage.
- Serve the photo over HTTPS; the blob URL is unguessable (random key), not
  enumerable by player name.
- Photo shows ONLY on that player's own card, never on the leaderboard or
  another kid's view (same rule as today).
- A short privacy line in the app: what is stored, that it is parent-added, and
  how to remove it.

## Backend surface (new endpoints, mirrors the existing api/ style)
- `POST /api/photo/request-code` { email, playerId } -> emails code. Rate-limited.
- `POST /api/photo/verify` { email, playerId, code } -> { uploadToken } or 401.
- `POST /api/photo/upload` (Bearer uploadToken) { playerId, imageData } -> { url }.
- `POST /api/photo/remove` (Bearer uploadToken) { playerId } -> ok.
- `GET  /api/photo/<playerId>` -> { url } or 404 (public read of the stored URL;
  the image itself is the unguessable blob).
Email send: SES or Resend (a from-address + API key as a Vercel env var).

## Open decisions for Woody before/while building
1. Email storage: raw (to send deletion confirmations) or hash-only? (I lean:
   store raw, encrypted at rest, because you will want to email the parent.)
2. Verified-parent window length: 30 days per device feels right for a family.
3. Email provider: Resend (simplest) vs AWS SES (already in AWS). Pick one.
4. Where does the image blob live: Vercel Blob, S3, or base64 in Redis (Redis is
   simplest but bloats the store; a blob store is the right home).

## Phasing (build in safe order)
- Phase A (no new risk): ship the "Edit photo" label. DONE-ready.
- Phase B: parent email-OTP gate + server photo store + sync + delete.
- Phase C: privacy line in-app + a simple parent "remove my child's photo" path.
