/* policy.js -- the ONE source of Thwap Hockey's Terms of Use and Privacy Policy.
 * Read by the in-app policy sheet (index.html) AND the public /terms and /privacy
 * pages (terms.html, privacy.html), so the app and the public links can never say
 * different things. Edit the text here only. HTML strings; author-controlled. */
(function () {
  var EFFECTIVE = 'Effective November 2026';
  var CONTACT_MAIL = "Thwap Hockey, 7610 3rd Ave, Seattle, WA 98117, Attn: John MacDuffie Woodburn";

  var TERMS =
    "<p>Thwap Hockey is a home-training app for youth hockey players. It gives a player short daily stickhandling, shooting, passing, dryland and hockey IQ drills, tracks the training they mark done, and shows that progress to the player and their team coach. It runs on the web, as an iPhone and Android app, and on Apple Watch.</p>" +
    "<h2>Who uses it</h2>" +
    "<p>Thwap Hockey is used by youth players, their parents, and their team coaches. A player under 13 may use the app only with a parent's involvement and consent. A coach uses the app to set the team plan and see how players are progressing.</p>" +
    "<h2>What you agree to</h2>" +
    "<ul>" +
    "<li>Use the app for its purpose: youth hockey training and coaching.</li>" +
    "<li>Keep your sign-in details private. A coach signs in with their own account; do not share it with players.</li>" +
    "<li>Do not post content that is not yours to share, and do not misuse another person's account.</li>" +
    "</ul>" +
    "<h2>Training and safety</h2>" +
    "<p>The drills are general training suggestions, not medical or professional coaching advice. A player should train within their ability and stop if something hurts. A parent or coach should judge whether a drill is right for a given player.</p>" +
    "<h2>Deleting a coach account</h2>" +
    "<p>A coach can delete their own account at any time from Profile in the app. Deleting it signs the coach out everywhere and removes their login. The team and its players stay, because other families use them.</p>" +
    "<h2>The app as-is</h2>" +
    "<p>Thwap is offered as-is for youth hockey teams. We work to keep it running and accurate, but we do not promise it will be uninterrupted or error-free.</p>" +
    "<h2>Changes</h2>" +
    "<p>We may update these terms as the app grows. When the terms change in a way that matters, we will ask you to agree again at sign-in. Continuing to use the app after a change means you accept the updated terms.</p>" +
    "<h2>Contact</h2>" +
    "<p>Questions about these terms: <a href='mailto:hello@thwaphockey.com'>hello@thwaphockey.com</a>, or by mail to " + CONTACT_MAIL + ".</p>";

  var PRIVACY =
    "<p>Thwap Hockey is built for children, so we collect as little as we can and we are plain about what we keep and why. This explains what we collect, why, who can see it, how long we keep it, and how a parent removes it.</p>" +
    "<h2>What we collect</h2>" +
    "<ul>" +
    "<li><b>About a player:</b> first name, jersey number, position, the training the player marks done, and the game goals they pick. This is what shows the player and their coach how they are progressing.</li>" +
    "<li><b>From a parent:</b> an email, so we can reach a parent and get consent, and a one-time 6-digit code we email to verify consent. The code is short-lived and expires.</li>" +
    "<li><b>A coach:</b> name, email, a password (stored only as a secure hash), and an optional photo of the coach.</li>" +
    "<li><b>Notifications:</b> if a family turns notifications on in the iPhone or Android app, a device token that lets us send a reminder to that device. Turning notifications off removes it.</li>" +
    "</ul>" +
    "<p>We do not store photos of children. We do not collect a home address, phone number, location, health or fitness data, or a child's own contact information. We do not track children with advertising tools, we do not show advertising, and there are no analytics tools inside the iPhone, Android or Apple Watch apps.</p>" +
    "<h2>Apple Watch</h2>" +
    "<p>A player can sign in on an Apple Watch after a parent approves it by email. The watch keeps only what it needs to show today's drills: the player's first name, jersey number, today's drill list, ring progress, and a sign-in token stored in the watch's secure Keychain. The token holds no email address. The watch does not read heart rate, workouts or any other health data. Signing out wipes everything from the watch.</p>" +
    "<h2>How we verify a parent</h2>" +
    "<p>For a player under 13, we obtain a parent's consent before that child's information is used in the ways above, in line with COPPA (US) and PIPEDA (Canada). We verify a parent by emailing a one-time code to the parent's email and having them enter it, and we keep a record that consent was given and when.</p>" +
    "<h2>How we use it</h2>" +
    "<p>We use this information only to run the app: to show a player their drills and progress, to let their coach see team progress, to send reminders a family turned on, and to contact a parent about consent. We do not sell personal information.</p>" +
    "<h2>Who can see it, and who helps us run the app</h2>" +
    "<p>A player's training is visible to that player, their parent, their teammates (as team progress), and their team's coaches. It is not shared publicly. To run the app we use a small number of named service providers, and share only what each needs. Each is bound by its terms to process the information only to provide its service to us, not for its own purposes:</p>" +
    "<ul>" +
    "<li><b>Vercel</b> hosts the app and runs the server code (United States). On the thwaphockey.com website only, Vercel Web Analytics counts page visits without cookies or personal profiles.</li>" +
    "<li><b>Upstash</b> provides the Redis database that stores player progress, parent and coach email, and consent records (United States).</li>" +
    "<li><b>Resend</b> delivers the one-time parent codes and waitlist replies by email (United States).</li>" +
    "<li><b>Apple Push Notification service</b> and <b>Google Firebase Cloud Messaging</b> deliver reminders to iPhone and Android devices that turned notifications on. They receive only the device token and the reminder text.</li>" +
    "</ul>" +
    "<h2>How long we keep it, and how to remove it</h2>" +
    "<p>A player's roster info and training history stay while the player is on an active team. If a player leaves a team, or a team stops using Thwap, we remove that player's information within 90 days, unless a parent asks us to delete it sooner. The one-time email codes are short-lived and expire automatically. A parent or coach can remove a player from a team at any time, and a parent can ask us to delete their child's information entirely at any time, including the consent record; we action a deletion within 30 days and confirm when it is done. A coach can delete their own account at any time from Profile in the app.</p>" +
    "<h2>Keeping it safe</h2>" +
    "<p>We serve the app over HTTPS, store a parent's one-time codes only briefly, store passwords only as secure hashes, and keep sign-in tokens free of email addresses. No system is perfectly secure, but we work to protect children's information and to limit what we collect in the first place.</p>" +
    "<h2>Our accountability, and what we do if something goes wrong</h2>" +
    "<p>One person is accountable for how Thwap Hockey handles personal information: John MacDuffie Woodburn, our privacy contact. You can reach him using the Contact details below with any question, concern, or complaint about privacy. If a breach of security safeguards creates a real risk of significant harm to a child or parent, we will notify the affected parents and the appropriate authorities as the law requires, and tell you what happened, what information was involved, and what you can do. In Canada this follows PIPEDA's breach-notification duty; in the US we follow applicable state breach-notice laws.</p>" +
    "<h2>A parent's rights</h2>" +
    "<p>A parent can at any time review what we hold about their child, ask us to correct it, ask us to delete it, and withdraw consent. Email us and we will help.</p>" +
    "<h2>Contact</h2>" +
    "<p>Our privacy contact is John MacDuffie Woodburn. For privacy questions, or to review, correct, or delete a child's information, reach us at <a href='mailto:privacy@thwaphockey.com'>privacy@thwaphockey.com</a>, or by mail at " + CONTACT_MAIL + ".</p>";

  window.THWAP_POLICY = { EFFECTIVE: EFFECTIVE, TERMS: TERMS, PRIVACY: PRIVACY };
})();
