// test/admin-key-header.test.js
//
// The admin key is accepted ONLY in a request header (Authorization: Bearer),
// never as ?key= (or ?token= / ?adminToken=) in the URL, where it lands in
// browser history and request logs. Covers every admin action: api/coach.js,
// api/push.js, api/waitlist.js and api/photo/*. Admin session tokens keep
// working from the header and the JSON body.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';
import { JPEG_URL } from './fixtures/photo_images.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (key) => ({ url: `https://blob.example/${key}` })),
  del: vi.fn(async () => {}),
  list: vi.fn(async () => ({ blobs: [], hasMore: false })),
}));

const KEY = 'admin-test-token';
function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
  process.env.SESSION_TOKEN_SECRET = 'session-secret-please-change';
  process.env.RESEND_API_KEY = 'rk_test';
  process.env.PHOTO_FROM_EMAIL = 'thwap@example.com';
  process.env.BLOB_READ_WRITE_TOKEN = 'blob_test';
  process.env.THWAP_ADMIN_TOKEN = KEY;
  process.env.WAITLIST_ADMIN_TOKEN = KEY;
}
setEnv();

const { default: coach, _handlers: coachH, _seed } = await import('../api/coach.js');
const { _handlers: pushH } = await import('../api/push.js');
const { default: waitlist } = await import('../api/waitlist.js');
const { default: photoGet } = await import('../api/photo/get.js');
const { default: photoAdminPut } = await import('../api/photo/admin-put.js');
const { default: photoRemove } = await import('../api/photo/remove.js');
const { putPhoto } = await import('../lib/photo_store.js');
const { getKv } = await import('../lib/photo_common.js');
const { sharedKeyOk, bearerFrom } = await import('../lib/admin_auth.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    send(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const hdr = (t) => ({ authorization: `Bearer ${t}`, 'x-real-ip': '10.1.1.1' });

// Each admin action: method, the handler call, and the body/query it needs.
const ACTIONS = [
  { name: 'coach admin-roster', method: 'GET', run: (r, s) => coach(r, s), query: { action: 'admin-roster' } },
  { name: 'coach admin-update-player', method: 'POST', run: (r, s) => coach(r, s), query: { action: 'admin-update-player' }, body: { playerId: 'lewie', number: '72' } },
  { name: 'coach review-suggestions', method: 'GET', run: (r, s) => coach(r, s), query: { action: 'review-suggestions' } },
  { name: 'coach resolve-suggestion', method: 'POST', run: (r, s) => coach(r, s), query: { action: 'resolve-suggestion' }, body: { code: 'X', id: 'nope', status: 'accepted' } },
  { name: 'coach adjust-counts', method: 'POST', run: (r, s) => coach(r, s), query: { action: 'adjust-counts' }, body: { playerId: 'lewie', stick: 0 } },
  { name: 'push send', method: 'POST', run: (r, s) => pushH.send(r, s), body: { playerId: 'lewie', payload: { title: 'x' } } },
  { name: 'push status', method: 'GET', run: (r, s) => pushH.status(r, s) },
  { name: 'waitlist read-back', method: 'GET', run: (r, s) => waitlist(r, s) },
  { name: 'photo get (admin read)', method: 'GET', run: (r, s) => photoGet(r, s), query: { playerId: 'lewie' } },
  { name: 'photo admin-put', method: 'POST', run: (r, s) => photoAdminPut(r, s), body: { playerId: 'lewie', imageData: JPEG_URL, consent: { method: 'text', grantedBy: 'A parent' } } },
  { name: 'photo retire-all (dry run)', method: 'POST', run: (r, s) => photoRemove(r, s), body: { all: true } },
  { name: 'photo orphan sweep (dry run)', method: 'POST', run: (r, s) => photoRemove(r, s), body: { orphans: true } },
];
const req = (a, { query = {}, headers = {}, body } = {}) => ({
  method: a.method,
  query: { ...(a.query || {}), ...query },
  headers: { 'x-real-ip': '10.1.1.1', ...headers },
  body: body !== undefined ? body : (a.method === 'POST' ? { ...(a.body || {}) } : {}),
});

async function adminSessionToken() {
  await coachH.adminSetPassword({ method: 'POST', query: {}, headers: {}, body: { email: 'hi@woodymacduffie.com', password: 'header-only-1' } }, makeRes());
  const res = makeRes();
  await coachH.adminLogin({ method: 'POST', query: {}, headers: {}, body: { email: 'hi@woodymacduffie.com', password: 'header-only-1' } }, res);
  expect(res.statusCode).toBe(200);
  return res.body.token;
}

beforeEach(async () => {
  fake.map.clear();
  if (fake.ttls) fake.ttls.clear();
  setEnv();
  await _seed.ensureSeed();
  await putPhoto(getKv(), 'lewie', 'https://blob.example/photos/a.jpeg', 'photos/a.jpeg');
});

describe('lib/admin_auth: the shared key only counts from the Authorization header', () => {
  it('ignores ?key= and ?token=, accepts Bearer', () => {
    expect(sharedKeyOk({ query: { key: KEY }, headers: {} })).toBe(false);
    expect(sharedKeyOk({ query: { token: KEY }, headers: {} })).toBe(false);
    expect(sharedKeyOk({ query: {}, headers: { authorization: `Bearer ${KEY}` } })).toBe(true);
    expect(sharedKeyOk({ query: {}, headers: { authorization: 'Bearer wrong' } })).toBe(false);
    expect(bearerFrom({ headers: { authorization: KEY } })).toBe(''); // no "Bearer " prefix
  });
  it('fails closed with no secret configured', () => {
    expect(sharedKeyOk({ headers: { authorization: 'Bearer ' } }, '')).toBe(false);
  });
});

describe('every admin action refuses the key in the URL and accepts it in the header', () => {
  for (const a of ACTIONS) {
    it(`${a.name}: ?key= / ?token= / ?adminToken= refused`, async () => {
      const session = await adminSessionToken();
      for (const query of [{ key: KEY }, { token: KEY }, { adminToken: session }]) {
        const res = makeRes();
        await a.run(req(a, { query }), res);
        expect(res.statusCode, JSON.stringify(query)).toBe(401);
      }
    });
    it(`${a.name}: Authorization: Bearer <key> accepted`, async () => {
      const res = makeRes();
      await a.run(req(a, { headers: hdr(KEY) }), res);
      expect(res.statusCode).not.toBe(401);
      expect(res.statusCode).toBeLessThan(500);
    });
  }
});

describe('admin session tokens keep working (header or body, not URL)', () => {
  for (const a of ACTIONS.filter((x) => x.name !== 'waitlist read-back')) {
    it(`${a.name}: session token in the Bearer header works`, async () => {
      const t = await adminSessionToken();
      const res = makeRes();
      await a.run(req(a, { headers: hdr(t) }), res);
      expect(res.statusCode).not.toBe(401);
    });
  }
  it('a session token in the POST body still works (coach adjust-counts)', async () => {
    const t = await adminSessionToken();
    const a = ACTIONS.find((x) => x.name === 'coach adjust-counts');
    const res = makeRes();
    await a.run(req(a, { body: { ...a.body, adminToken: t } }), res);
    expect(res.statusCode).toBe(200);
  });
});

describe('admin-only data on shared endpoints needs the header too', () => {
  it('roster shows parent emails to the header key only, not ?key=', async () => {
    const viaQuery = makeRes();
    await coach({ method: 'GET', query: { action: 'roster', code: _seed.SEED_TEAM_CODE, key: KEY }, headers: {} }, viaQuery);
    expect(viaQuery.statusCode).toBe(200);
    expect(viaQuery.body.members.every((m) => m.parentEmails.length === 0)).toBe(true);
    const viaHeader = makeRes();
    await coach({ method: 'GET', query: { action: 'roster', code: _seed.SEED_TEAM_CODE }, headers: hdr(KEY) }, viaHeader);
    expect(viaHeader.body.members.some((m) => m.parentEmails.length > 0)).toBe(true);
  });
  it('team-coaches shows coach emails to the header key only, not ?key=', async () => {
    const viaQuery = makeRes();
    await coach({ method: 'GET', query: { action: 'team-coaches', code: _seed.SEED_TEAM_CODE, key: KEY }, headers: {} }, viaQuery);
    expect(viaQuery.body.coaches.every((c) => !c.email)).toBe(true);
    const viaHeader = makeRes();
    await coach({ method: 'GET', query: { action: 'team-coaches', code: _seed.SEED_TEAM_CODE }, headers: hdr(KEY) }, viaHeader);
    expect(viaHeader.body.coaches.some((c) => !!c.email)).toBe(true);
  });
});

describe('callers send the admin credential in a header', () => {
  it('admin.html never puts the admin token in a URL', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
    expect(html).not.toMatch(/tokenQS|adminToken=|[?&]key=/);
    expect(html).toContain("'Authorization':'Bearer '+token");
    // every admin fetch passes the auth headers
    for (const path of ['review-suggestions', 'resolve-suggestion', 'admin-roster', 'admin-update-player', '/api/photo/admin-put', '/api/photo/remove']) {
      const i = html.indexOf(path);
      expect(i, path).toBeGreaterThan(-1);
      expect(html.slice(i, i + 160), path).toMatch(/authH\(/);
    }
  });
});
