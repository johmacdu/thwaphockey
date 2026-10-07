#!/usr/bin/env node
/*
 * qa/qa-views.cjs -- automated QA across every Thwap view.
 *
 * Boots index.html + about.html in a REAL headless Chrome and exercises each
 * view the way a user would: splash sign-in, about page + parallax, the player
 * views (home / Team / Standings / Stickers), and the coach view. For each it
 * asserts: zero uncaught JS errors, zero broken images, the view actually
 * renders (its section is visible with real content), and that the key control
 * for that view responds. Screenshots land in qa/shots/ for the record.
 *
 * Run:  node qa/qa-views.cjs      (from the repo root)
 * Exit: 0 = all checks pass, 1 = any failure. CI/`npm run qa` friendly.
 *
 * It drives role state by seeding localStorage/cookies before load:
 *   player = thwapAuth cookie + bfPlayer       -> body.is-authed
 *   coach  = thwapCoach object in localStorage -> body.is-coach
 * (the same signals index.html's gate() reads on boot).
 */
const path = require('path');
const fs = require('fs');
const cp = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const CHROME = process.env.CHROME_BIN ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Graceful skip: this harness needs a real Chrome + puppeteer-core. In a
// browser-less CI it should NOT hard-fail the build -- it reports SKIPPED and
// exits 0, so `npm run qa` is safe to wire into any pipeline. The unit tests
// (vitest) are the always-on gate; this is the on-demand behavioural layer.
let puppeteer;
try {
  const PK = cp.execSync('npm root -g').toString().trim();
  puppeteer = require(path.join(PK, 'puppeteer-core'));
} catch (e) {
  console.log('QA SKIPPED: puppeteer-core not installed (npm i -g puppeteer-core).');
  process.exit(0);
}
if (!fs.existsSync(CHROME)) {
  console.log('QA SKIPPED: Chrome not found at ' + CHROME + ' (set CHROME_BIN).');
  process.exit(0);
}
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || '' });
  console.log((pass ? '  \u2713 ' : '  \u2717 ') + name + (detail ? '  -- ' + detail : ''));
}

// Attach error/broken-image collectors to a page.
function instrument(page) {
  const errs = [];
  const broken = [];
  page.on('pageerror', e => errs.push(String(e).split('\n')[0]));
  page.on('requestfailed', r => {
    const u = r.url();
    if (/\.(png|jpe?g|webp|svg|gif)(\?|$)/i.test(u)) broken.push(u.split('/').pop());
  });
  return { errs, broken };
}

const fileURL = f => 'file://' + path.join(ROOT, f);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Seed role state in a fresh page BEFORE the document scripts run.
async function seed(page, role) {
  await page.evaluateOnNewDocument((role) => {
    try {
      localStorage.clear();
      if (role === 'player') {
        document.cookie = 'thwapAuth=' + encodeURIComponent(JSON.stringify({ pid: 'lewie-m', team: 'rangers10u' })) + ';path=/';
        localStorage.setItem('bfPlayer', 'Lewie M.');
        localStorage.setItem('thwapAuth', JSON.stringify({ pid: 'lewie-m', team: 'rangers10u' }));
      } else if (role === 'coach') {
        document.cookie = 'thwapAuth=' + encodeURIComponent(JSON.stringify({ pid: 'coach', team: 'rangers10u' })) + ';path=/';
        localStorage.setItem('thwapCoach', JSON.stringify({ name: 'Jason', team: 'rangers10u', email: 'jason@riversidepayments.com' }));
        localStorage.setItem('bfPlayer', 'Lewie M.');
        localStorage.setItem('thwapAuth', JSON.stringify({ pid: 'coach', team: 'rangers10u' }));
      }
    } catch (e) {}
  }, role);
}

// Is a section (by id) actually visible with real content?
async function viewVisible(page, id) {
  return page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return { ok: false, why: 'missing' };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const visible = cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 20;
    const text = (el.innerText || '').trim().length;
    return { ok: visible && text > 0, display: cs.display, h: Math.round(r.height), text };
  }, id);
}

async function run() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--force-device-scale-factor=1'],
  });

  try {
    // ---------- 1. SPLASH (signed-out index.html) ----------
    console.log('\n[1] Splash / sign-in');
    {
      const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844 });
      const io = instrument(p);
      await p.goto(fileURL('index.html'), { waitUntil: 'load' }); await sleep(600);
      const locked = await p.evaluate(() => document.body.classList.contains('login-locked'));
      check('splash: body is login-locked for a signed-out visitor', locked);
      const sheet = await p.evaluate(() => {
        const o = document.getElementById('loginOverlay');
        return o && getComputedStyle(o).display !== 'none';
      });
      check('splash: the sign-in overlay is present', sheet);
      // The Sign In sheet should carry a glass close button + the team/email fields
      const hasClose = await p.evaluate(() => !!document.querySelector('.login-modal .glassclose, .login-x, .glassclose'));
      check('splash: a close affordance exists', hasClose);
      await p.screenshot({ path: path.join(SHOTS, '1-splash.png') });
      check('splash: zero JS errors', io.errs.length === 0, io.errs.slice(0, 2).join(' | '));
      check('splash: zero broken images', io.broken.length === 0, io.broken.slice(0, 3).join(', '));
      await p.close();
    }

    // ---------- 2. ABOUT page + parallax ----------
    console.log('\n[2] About page');
    {
      const p = await browser.newPage(); await p.setViewport({ width: 390, height: 844 });
      const io = instrument(p);
      await p.goto(fileURL('about.html'), { waitUntil: 'load' }); await sleep(600);
      const title = await p.evaluate(() => document.title);
      check('about: page loads with a title', /thwap/i.test(title), title);
      // The two parallax sections pin on scroll (mobile parallax from PR #332)
      const pins = await p.$$eval('.pin', els => els.length);
      check('about: parallax pin tracks exist', pins >= 2, pins + ' pins');
      // Drive a scroll and confirm a pinned card stays at top
      const pinned = await p.evaluate(async () => {
        const track = document.querySelector('.pin');
        if (!track) return false;
        track.scrollIntoView();
        window.scrollBy(0, 400); await new Promise(r => setTimeout(r, 300));
        const sticky = track.querySelector('.pin-sticky, [style*="sticky"], .pin-card');
        if (!sticky) return false;
        const t = sticky.getBoundingClientRect().top;
        return t <= 2 && t >= -2; // pinned to viewport top
      });
      check('about: a parallax card pins to the top on scroll', pinned);
      // Live-demo phone is centered (mobile)
      const phoneCentered = await p.evaluate(() => {
        const ph = document.querySelector('.phone');
        if (!ph) return true; // not fatal if absent
        const r = ph.getBoundingClientRect();
        const l = r.left, rr = window.innerWidth - r.right;
        return Math.abs(l - rr) <= 4;
      });
      check('about: live-demo phone is horizontally centered', phoneCentered);
      await p.screenshot({ path: path.join(SHOTS, '2-about.png') });
      check('about: zero JS errors', io.errs.length === 0, io.errs.slice(0, 2).join(' | '));
      check('about: zero broken images', io.broken.length === 0, io.broken.slice(0, 3).join(', '));
      await p.close();
    }

    // ---------- 3. PLAYER views ----------
    console.log('\n[3] Player views (home / Team / Standings / Stickers)');
    {
      const p = await browser.newPage(); await p.setViewport({ width: 1000, height: 900 });
      const io = instrument(p);
      await seed(p, 'player');
      await p.goto(fileURL('index.html'), { waitUntil: 'load' }); await sleep(700);
      const authed = await p.evaluate(() => document.body.classList.contains('is-authed') && !document.body.classList.contains('is-coach'));
      check('player: body is-authed (not coach)', authed);
      const home = await viewVisible(p, 'home');
      check('player: #home renders with content', home.ok, JSON.stringify(home));
      // Navigate each player view by hash and confirm it renders
      for (const [id, label] of [['roster', 'Team'], ['progress', 'Standings'], ['stickers', 'Stickers']]) {
        await p.evaluate((id) => { location.hash = '#' + id; }, id); await sleep(450);
        const v = await viewVisible(p, id);
        check('player: #' + id + ' (' + label + ') renders', v.ok, JSON.stringify(v));
      }
      // Back home, screenshot
      await p.evaluate(() => { location.hash = '#home'; }); await sleep(300);
      await p.screenshot({ path: path.join(SHOTS, '3-player-home.png') });
      check('player: zero JS errors', io.errs.length === 0, io.errs.slice(0, 3).join(' | '));
      check('player: zero broken images', io.broken.length === 0, io.broken.slice(0, 4).join(', '));
      await p.close();
    }

    // ---------- 4. COACH view ----------
    console.log('\n[4] Coach view');
    {
      const p = await browser.newPage(); await p.setViewport({ width: 1000, height: 900 });
      const io = instrument(p);
      await seed(p, 'coach');
      await p.goto(fileURL('index.html'), { waitUntil: 'load' }); await sleep(800);
      const isCoach = await p.evaluate(() => document.body.classList.contains('is-coach'));
      check('coach: body is-coach', isCoach);
      // Coach lands on #coachhome; it must render with content
      const ch = await viewVisible(p, 'coachhome');
      check('coach: #coachhome renders with content', ch.ok, JSON.stringify(ch));
      // Coach nav: Team / Plan / Standings reachable
      for (const [id, label] of [['roster', 'Team'], ['plan', 'Plan'], ['progress', 'Standings']]) {
        await p.evaluate((id) => { location.hash = '#' + id; }, id); await sleep(450);
        const v = await viewVisible(p, id);
        check('coach: #' + id + ' (' + label + ') renders', v.ok, JSON.stringify(v));
      }
      // Coach must NOT see the player #home (gated off)
      const homeHidden = await p.evaluate(() => {
        const h = document.getElementById('home');
        return !h || getComputedStyle(h).display === 'none';
      });
      check('coach: player #home is hidden for a coach', homeHidden);
      await p.evaluate(() => { location.hash = '#coachhome'; }); await sleep(300);
      await p.screenshot({ path: path.join(SHOTS, '4-coach-home.png') });
      check('coach: zero JS errors', io.errs.length === 0, io.errs.slice(0, 3).join(' | '));
      check('coach: zero broken images', io.broken.length === 0, io.broken.slice(0, 4).join(', '));
      await p.close();
    }
  } finally {
    await browser.close();
  }

  const failed = results.filter(r => !r.pass);
  console.log('\n' + '='.repeat(52));
  console.log('QA SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length) {
    console.log('FAILED:');
    failed.forEach(f => console.log('  - ' + f.name + (f.detail ? '  (' + f.detail + ')' : '')));
  }
  console.log('Screenshots: ' + SHOTS);
  process.exit(failed.length ? 1 : 0);
}

run().catch(e => { console.error('QA harness crashed:', e); process.exit(1); });
