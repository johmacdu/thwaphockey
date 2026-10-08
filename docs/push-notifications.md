# Thwap Hockey - Push Notifications: System Design

Status: DRAFT for Woody's review. The server-side PLUMBING is built on branch
`feat/push-plumbing` (PR #368); everything else here is design, not built.
Nothing delivers a real notification yet. Business and content decisions
(what we notify about, when, who approves it) are marked **[WOODY DECISION]**
and are not invented.

Governing principle still applies: make every detail perfect, limit the number
of details. This doc favors the smallest system that lets a parent-approved
device receive a notification, not the most powerful one.

## 0. What exists today, and what this doc is for

Built already (branch `feat/push-plumbing`, three files):

- `lib/push_store.js` - the token store and the fan-out machinery. Import-only
  (no default export), so Vercel does not count it against the Hobby 12-function
  cap. Stores tokens under `pushtokens:<playerId>`, dedups and caps them, and
  fans a payload out through an INJECTABLE sender. The default sender is a MOCK
  that touches no network; the real FCM path is a clearly-marked
  `credentials-pending` stub. `pushConfigured()` returns `false` until real
  credentials are wired.
- `api/push.js` - the ONE serverless function this feature adds. Dispatches on
  `?action=`: `register` / `unregister` (player session-gated, the playerId comes
  from the session claim, never the request body) and `send` (admin-only manual
  test trigger, same admin contract as `api/coach.js`).
- A native-only Notifications toggle in the Profile tab of `index.html`
  (hidden on web via `body:not(.is-native) .prof-row-native`), which feature-
  detects the Capacitor push plugin and calls the register/unregister endpoints.

What is NOT built: real delivery (no FCM/APNs credentials), notification copy,
automatic triggers, and the native-shell token plumbing in the Capacitor repo.
This doc pins the full shape so the remaining work is reviewable slices, not
piecemeal guessing.

## 1. The three delivery channels, and the single-sender recommendation

A notification reaches a device over one of three transports, and they do not
share a token format:

- **Web Push** (browser, including an installed PWA): the browser's own Push API
  plus a service worker, authenticated with a VAPID key pair. The token is a
  PushSubscription (an endpoint URL plus keys), not an FCM token.
- **FCM** (Firebase Cloud Messaging, Android native): Google's service. The token
  is an FCM registration token. FCM can ALSO relay to Apple and to web push, which
  is the key fact below.
- **APNs** (Apple Push Notification service, iOS native): Apple's service. The
  token is an APNs device token, and sending to it needs an Apple auth key.

**Recommendation: one sender, FCM, for all three.** Firebase Cloud Messaging
can deliver to Android (natively), to iOS (FCM holds your APNs auth key and
relays to Apple for you), and to web push (FCM wraps VAPID). That means ONE
server-side credential to manage, ONE send path in `lib/push_store.js`
(`fcmSender`), and ONE token shape to store, instead of three parallel senders.
The Capacitor `@capacitor/push-notifications` plugin already hands back an
FCM-style token on Android and an APNs token on iOS that FCM accepts once the
APNs key is uploaded to Firebase, so the native side needs no extra SDK.

The cost of the single-sender choice: you take a hard dependency on Google's
Firebase, and iOS delivery routes through Firebase rather than straight to
Apple. For a kids' hockey app sending a handful of low-volume reminders, that
tradeoff is clearly worth the one-credential simplicity. The alternative (talk
to APNs and web push directly, skip Firebase) buys independence from Google at
the cost of two more credentials and two more code paths, and is not
recommended at this scale.

**[WOODY DECISION]** Confirm FCM-as-single-sender. The only reason to revisit it
is a hard "no Google services" constraint, which we do not have today.

## 2. Token store model (built)

Mirrors the player/days/events JSON-array idiom in `lib/store.js`:

```
Key:   pushtokens:<playerId>     (playerId = lowercase first name, e.g. "lewie")
Value: JSON array of { token, platform:'web'|'ios'|'android', ua, at }
       newest LAST, deduped by token, capped to the 10 newest.
```

- A device registers its token when the player turns Notifications on in the
  native app; it unregisters on toggle-off or sign-out.
- Keyed by PLAYER, not by device or account, because a notification targets a
  player ("your drills are ready"). A kid with a few devices has a few tokens
  under one key; the cap keeps a stale device from growing the list without
  bound.
- A send resolves a target (one `playerId`, or every member of a `team` code via
  `listMembers`), gathers that player's tokens, and fans the payload out through
  the sender. Today the sender is the mock, so `send` returns an honest
  `{ sent, failed, pushConfigured:false }` tally and delivers nothing.

The store never throws on malformed data (an `asArray` normalizer handles a
parsed array, a raw JSON string, or a missing key), matching the resilience
pattern already used across `lib/`.

## 3. Children's data and parental consent

This is the highest-weight concern, and it ties directly into the model already
documented in `docs/parent-photo-consent.md`: **the adult is the account holder;
the child never self-registers anything sensitive.**

How that principle lands on push:

- **A push token is tied to a player, and a player is reached only through the
  parent/player session.** `register` and `unregister` are session-gated and
  take the playerId from the verified session claim, not the request body, so a
  device can only register a token for the signed-in player. There is no path for
  one kid to register against another kid.
- **The OS permission prompt is the consent moment on the device.** On a native
  install the parent is the one who sets up the device and taps "Allow" on the
  iOS/Android notification permission dialog. That is the same adult-is-the-
  account-holder posture as the photo flow: the responsible adult performs the
  consenting action.
- **No child PII travels in a notification payload.** Copy should address the
  player by first name at most (already public within the team), never carry
  anything a leak of the payload would expose. Treat the payload as readable by
  the OS and by Firebase in transit.
- **Deletion must work.** Turning the toggle off unregisters the device's token;
  signing out should too. A parent asking to remove a child's data (the same
  privacy-contact path the photo doc commits to) must also drop every token under
  that player's key. Tokens are not consent records, so they can be deleted
  freely with no retention obligation.
- **Minimize what is stored.** The token record holds the token, a platform tag,
  a truncated user-agent string, and a timestamp. No device name, no location, no
  analytics. This matches the "store the minimum" rule the photo doc sets.

**[WOODY DECISION]** Do we want an explicit in-app consent line for notifications
(a short "a parent turns this on; we send training reminders only, no child data"
note next to the toggle), paralleling the photo privacy line? Recommend yes, for
the same reason the photo flow has one.

**[WOODY DECISION]** Is the OS permission prompt a sufficient consent signal for
notifications, or do we want the toggle gated behind the same parent email-OTP
verification the photo upload uses? Recommend: OS prompt is sufficient here
(a notification is far lower-risk than storing a child's face), but call it
explicitly so it is a decision, not a default.

## 4. Credentials needed to go live, and where each is set

Push is `credentials-pending` today. Going live needs the following, and NONE of
them can be created by the agent - they require a human with the relevant
developer accounts. The agent can wire the env vars and the send code once the
secret values exist, but cannot register a Firebase project or an Apple
Developer account.

### Firebase / FCM (needed for all three channels under the single-sender plan)

- **A Firebase project** (console.firebase.google.com). A human creates it under
  a Google account Thwap controls.
- **A service-account credential for server-to-FCM auth.** The modern path is the
  FCM HTTP v1 API, which authenticates with a Google service-account JSON key
  (the legacy "FCM server key" is deprecated; prefer the service-account). The
  human downloads this JSON from the Firebase console.
- **A Web Push VAPID key pair** (Firebase console, Cloud Messaging settings) if
  we deliver to browsers/PWA via FCM.

Where set (Vercel project env vars, same pattern as the photo and admin secrets):

- `FCM_SERVICE_ACCOUNT_JSON` - the service-account JSON, as a single-line env
  value (never committed; `lib/push_store.js` reads it from `process.env`).
- `FCM_PROJECT_ID` - the Firebase project id.
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` - only if web push is in scope.

### Apple / APNs (needed for iOS, even under the FCM single-sender plan)

FCM relays to iOS, but Apple still has to trust the relay, so Firebase needs an
Apple auth key uploaded to it:

- **An Apple Developer Program account** (paid, ~$99/yr). A human enrolls Thwap.
- **An APNs auth key** (a `.p8` file plus its Key ID and the Team ID), created in
  the Apple Developer portal. The `.p8` is UPLOADED INTO Firebase (Project
  settings -> Cloud Messaging -> Apple app configuration), not set as a Vercel
  env var - because FCM, not Thwap's server, is the thing talking to APNs. This
  is the one credential that lives in Firebase rather than in Vercel.
- The iOS app's bundle id (`com.thwaphockey.app`) must be registered in both the
  Apple Developer portal and the Firebase iOS app config, and the app needs the
  Push Notifications capability enabled.

### Android

- Covered by the same Firebase project. The Android app registers a Firebase
  Android app for `com.thwaphockey.app` and ships the `google-services.json` the
  Firebase console generates (committed into the Android project, it is not a
  secret). No extra Vercel env var.

**The agent cannot create any of these accounts or keys.** Enrolling in the
Apple Developer Program, creating the Firebase project, and generating the APNs
`.p8` and the service-account JSON are all human steps on accounts Thwap owns.
Once the secret values exist, wiring `FCM_SERVICE_ACCOUNT_JSON` et al. into
Vercel env and implementing `fcmSender` is the agent's part.

## 5. Native-shell wiring the Capacitor app repo must do

The web page's job is already built: the Profile toggle feature-detects
`window.Capacitor.Plugins.PushNotifications`, and on enable it attaches a
`registration` listener and calls the plugin's `requestPermissions()` then
`register()`; the listener POSTs `{ token, platform }` to
`/api/push?action=register`. On the web/preview build the plugin is absent, so
the toggle flips and persists but no registration happens (it never fakes
success). The config is in place too: `capacitor.config.json` already declares
the `PushNotifications` plugin and `@capacitor/push-notifications` is already a
dependency.

What the NATIVE app project (the Capacitor iOS/Android build) still has to do:

1. **Platform setup.** Add the Firebase config to each platform:
   `google-services.json` in the Android project, `GoogleService-Info.plist` in
   the iOS project, and enable the Push Notifications capability + background
   modes on iOS. These come from the Firebase console (section 4).
2. **Request permission and register at the OS level.** This is what
   `@capacitor/push-notifications` does; the web toggle already calls it. The
   native build must ensure the plugin is actually installed in the native
   project (`npx cap sync`) so `requestPermissions()` and `register()` reach the
   real OS APIs.
3. **Stash the token for unregister.** This is the one gap the web code calls
   out explicitly: `disableNotif()` reads `localStorage.getItem('thwapNotifToken')`
   to know which token to unregister, but nothing writes that key yet. The native
   shell's own `registration` handler must save the device token to
   `localStorage['thwapNotifToken']` when it arrives, so toggle-off and sign-out
   can POST the right token to `?action=unregister`. Without this, disabling
   notifications cannot tell the server which token to drop.
4. **POST the token to the backend.** `fetch('/api/push?action=register', ...)`
   with the session cookie. Because the Capacitor shell loads the LIVE site
   (`server.url = https://thwaphockey.com`), these are same-origin requests and
   the session cookie rides along - no CORS, no cross-origin token handling. (A
   loopback preview cannot reproduce this; verify native-origin behavior against
   the live site, not a local harness.)
5. **Handle an inbound notification tap.** Decide what tapping a notification
   opens (the drills screen, a specific discipline). The plugin exposes a
   `pushNotificationActionPerformed` listener for this; the behavior is a
   **[WOODY DECISION]** once we know what we notify about.

Note: branch `feat/push-plumbing` also carries an earlier `native-bridge.js`
sketch that posts to `/api/coach?action=push-register`. The CURRENT, correct
contract is `/api/push?action=register` (the dedicated push function). The native
shell should target that, not the coach endpoint.

## 6. What is NOT built yet (honest list)

- **Real delivery.** `pushConfigured()` is `false`, `fcmSender` is a stub, and
  every send runs through the mock. No notification has ever been delivered.
- **Credentials.** No Firebase project, no FCM service account, no APNs key, no
  Apple Developer enrollment. All are human steps (section 4).
- **The `fcmSender` implementation.** Reading the service account from env and
  POSTing to the FCM HTTP v1 API, with a real per-token `{ sent, failed }` tally
  and dead-token cleanup, is unwritten.
- **Notification copy and triggers.** The system invents no messages and no
  automatic triggers. "Your drills are ready," a streak-at-risk nudge, a game-day
  reminder - none exist. Content comes from Woody, not fabricated.
  **[WOODY DECISION]** what we notify about, and how often.
- **The native token-stash (`thwapNotifToken`).** The unregister path depends on
  it; nothing writes it yet (section 5, item 3).
- **Web push.** The toggle is native-only today. Browser/PWA push (VAPID + a
  service worker) is designed here but not wired.
- **Scheduling / rate control.** Nothing throttles or schedules sends. Even once
  live, a quiet-hours rule and a per-player frequency cap are unbuilt and should
  precede any automatic trigger, so a kids' app never nags.
- **Delivery analytics.** No record of what was sent, opened, or failed beyond
  the per-call tally. Fine for now; worth noting before any real campaign.
