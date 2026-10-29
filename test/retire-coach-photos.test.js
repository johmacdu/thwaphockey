// test/retire-coach-photos.test.js
//
// The legacy coach-added player photo field (`photo` on the teamMember record)
// is retired. Player photos live in the photo store (api/photo/*), which is
// consented and GPS-stripped.
//   - Server: add-player and update-player ignore a `photo` in the body (no
//     error), and no member response returns the field. A record written
//     before the change keeps its stored value untouched (no migration).
//   - admin.html: the roster avatar comes from /api/photo/get, sent with the
//     admin session token in the Authorization header only. With no photo (or
//     a photo that will not load) it shows the initial, never a broken image.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

process.env.KV_REST_API_URL = 'https://fake';
process.env.KV_REST_API_TOKEN = 'fake';
process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
process.env.THWAP_ADMIN_TOKEN = 'admin-test-token';

const { _handlers, _seed } = await import('../api/coach.js');
const { getMember } = await import('../lib/teams_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body, query = {}, headers = {}) => ({ method: 'POST', body, query, headers });
const get = (query = {}, headers = {}) => ({ method: 'GET', query, headers });
const ADMIN = { authorization: 'Bearer admin-test-token' };
const DATA_URL = 'data:image/jpeg;base64,abc';

async function coachToken() {
  const res = makeRes();
  await _handlers.coachLogin(post({ email: _seed.SEED_COACH_EMAIL, password: _seed.SEED_COACH_PASSWORD }), res);
  return res.body.token;
}
async function addKid(token, firstName, extra = {}) {
  const res = makeRes();
  await _handlers.addPlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, firstName, parentEmail: 'p@x.com', ...extra }), res);
  return res;
}
// Simulate a record written by the old code: the photo field is on file.
async function plantLegacyPhoto(pid) {
  const key = `teamMember:${pid}`;
  fake.map.set(key, { ...fake.map.get(key), photo: DATA_URL });
}

beforeEach(() => { fake.map.clear(); });

describe('server: the legacy member photo field is retired', () => {
  it('add-player ignores a photo in the body, without an error', async () => {
    const token = await coachToken();
    const res = await addKid(token, 'Photokid', { photo: DATA_URL });
    expect(res.statusCode).toBe(200);
    expect(res.body.member).not.toHaveProperty('photo');
    const stored = await getMember('photokid');
    expect(stored).toBeTruthy();
    expect(stored).not.toHaveProperty('photo');
  });

  it('update-player ignores a photo in the body and leaves stored data alone', async () => {
    const token = await coachToken();
    await addKid(token, 'Edkid');
    await plantLegacyPhoto('edkid');
    const res = makeRes();
    await _handlers.updatePlayer(post({ code: _seed.SEED_TEAM_CODE, coachToken: token, playerId: 'edkid', number: '9', photo: 'data:image/png;base64,NEW' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.member.number).toBe(9);
    expect(res.body.member).not.toHaveProperty('photo');
    // Not overwritten by the new value, and not deleted (no migration).
    expect((await getMember('edkid')).photo).toBe(DATA_URL);
  });

  it('admin-roster does not return the field', async () => {
    const token = await coachToken();
    await addKid(token, 'Rosterkid');
    await plantLegacyPhoto('rosterkid');
    const res = makeRes();
    await _handlers.adminRoster(get({}, ADMIN), res);
    expect(res.statusCode).toBe(200);
    const kid = res.body.players.find((p) => p.id === 'rosterkid');
    expect(kid).toBeTruthy();
    for (const p of res.body.players) expect(p).not.toHaveProperty('photo');
  });

  it('admin-update-player, player-rollup and join do not return the field', async () => {
    const token = await coachToken();
    await addKid(token, 'Readkid');
    await plantLegacyPhoto('readkid');

    const up = makeRes();
    await _handlers.adminUpdatePlayer(post({ playerId: 'readkid', number: '11' }, {}, ADMIN), up);
    expect(up.statusCode).toBe(200);
    expect(up.body.member).not.toHaveProperty('photo');

    const roll = makeRes();
    await _handlers.playerRollup(get({ playerId: 'readkid' }), roll);
    expect(roll.statusCode).toBe(200);
    expect(roll.body.member).toBeTruthy();
    expect(roll.body.member).not.toHaveProperty('photo');

    const j = makeRes();
    await _handlers.join(post({ code: _seed.SEED_TEAM_CODE, playerId: 'readkid' }), j);
    expect(j.statusCode).toBe(200);
    expect(j.body.player).not.toHaveProperty('photo');
  });
});

// --- admin.html roster avatar -------------------------------------------------

const ADMIN_HTML = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

// Load admin.html in jsdom with a stubbed API, sign in, open the roster.
// `photos` maps playerId -> url (missing = 404 from /api/photo/get).
async function bootAdmin({ players, photos = {} }) {
  // Drop the module script (CDN import for background removal); keep the app script.
  const html = ADMIN_HTML.replace(/<script type="module">[\s\S]*?<\/script>/, '');
  const calls = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://thwap.test/admin.html',
    beforeParse(win) {
      win.alert = () => {};
      win.fetch = (url, opts = {}) => {
        calls.push({ url: String(url), headers: (opts && opts.headers) || {} });
        const ok = (j) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(j) });
        const u = String(url);
        if (u.includes('admin-status')) return ok({ ok: true, exists: true, hasPassword: true });
        if (u.includes('admin-login')) return ok({ ok: true, token: 'sess-tok' });
        if (u.includes('review-suggestions')) return ok({ ok: true, suggestions: [] });
        if (u.includes('admin-roster')) return ok({ ok: true, players });
        if (u.startsWith('/api/photo/get')) {
          const id = new URL(u, 'https://thwap.test').searchParams.get('playerId');
          if (photos[id]) return ok({ url: photos[id] });
          return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: 'no photo' }) });
        }
        return ok({ ok: true });
      };
    },
  });
  const d = dom.window.document;
  d.getElementById('pw').value = 'pw';
  d.getElementById('load').click();
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  return { dom, d, calls };
}
const card = (d, id) => d.querySelector(`.pcard[data-id="${id}"]`);

describe('admin.html roster avatar uses the photo store', () => {
  const players = [
    // A stale legacy field on the record must not be drawn.
    { id: 'lewie', firstName: 'Lewie', name: 'Lewie', photo: 'data:image/png;base64,LEGACY', teamName: 'Jr Rangers' },
    { id: 'mia', firstName: 'Mia', name: 'Mia', teamName: 'Jr Rangers' },
  ];

  it('draws the photo-store url, looked up with the admin token in a header only', async () => {
    const { d, calls } = await bootAdmin({ players, photos: { lewie: 'https://blob.example/photos/lewie.png' } });
    const img = card(d, 'lewie').querySelector('img.pavatar');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe('https://blob.example/photos/lewie.png');
    expect(d.body.innerHTML).not.toContain('LEGACY');
    const look = calls.filter((c) => c.url.startsWith('/api/photo/get'));
    expect(look.map((c) => c.url).sort()).toEqual(['/api/photo/get?playerId=lewie', '/api/photo/get?playerId=mia']);
    for (const c of look) {
      expect(c.headers.Authorization).toBe('Bearer sess-tok');
      expect(c.url).not.toMatch(/key=|token=|sess-tok/i);
    }
  });

  it('shows the initial when there is no photo, never an image', async () => {
    const { d } = await bootAdmin({ players });
    const mia = card(d, 'mia');
    expect(mia.querySelector('img')).toBeNull();
    expect(mia.querySelector('.pavatar.empty').textContent).toBe('M');
    // Lewie has only the legacy field: still the initial, not the old photo.
    const lewie = card(d, 'lewie');
    expect(lewie.querySelector('img')).toBeNull();
    expect(lewie.querySelector('.pavatar.empty').textContent).toBe('L');
  });

  it('falls back to the initial when the stored photo will not load', async () => {
    const { dom, d } = await bootAdmin({ players, photos: { lewie: 'https://blob.example/photos/gone.png' } });
    const img = card(d, 'lewie').querySelector('img.pavatar');
    expect(img).toBeTruthy();
    img.dispatchEvent(new dom.window.Event('error'));
    const lewie = card(d, 'lewie');
    expect(lewie.querySelector('img')).toBeNull();
    expect(lewie.querySelector('.pavatar.empty').textContent).toBe('L');
  });
});
