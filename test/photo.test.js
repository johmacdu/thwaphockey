// test/photo.test.js
//
// Tests for the parent-gated photo endpoints (uploads retired 2026-10-29, so
// stored photos are seeded straight into the fake store). Redis is faked, Vercel Blob is
// mocked, and fetch (Resend) is stubbed. Env vars are set so the "configured"
// gate passes; a separate test clears them to prove the 503 fail-closed path.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

// Mock Vercel Blob del (nothing in the app can put a photo any more).
const blobDel = vi.fn(async () => {});
vi.mock('@vercel/blob', () => ({ del: (...a) => blobDel(...a) }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.RESEND_API_KEY = 'rk_test';
  process.env.PHOTO_FROM_EMAIL = 'thwap@example.com';
  process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
  process.env.BLOB_READ_WRITE_TOKEN = 'blob_test';
  process.env.THWAP_ADMIN_TOKEN = 'admin-test-token';
}
setEnv();

const { default: requestCode } = await import('../api/photo/request-code.js');
const { default: verify } = await import('../api/photo/verify.js');
const { default: remove } = await import('../api/photo/remove.js');
const { default: getPhoto } = await import('../api/photo/get.js');
const { getPhotoConsent: getConsent } = await import('../lib/photo_store.js');
const { getKv } = await import('../lib/photo_common.js');
const { mintSession } = await import('../lib/session_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
let ipSeq = 0;
const post = (body, headers = {}) => ({ method: 'POST', body, headers: { 'x-real-ip': `10.1.0.${(ipSeq++ % 250) + 1}`, ...headers } });
// Photo reads need a signed-in teammate (teddy is on lewie's team).
const get = (query) => ({ method: 'GET', query, headers: { cookie: `thwapSession=${mintSession('teddy', 'p@x.com')}` } });

beforeEach(() => {
  fake.map.clear();
  setEnv();
  blobDel.mockClear();
  // lewie's parent email on file: the photo code only goes there.
  fake.map.set('teamMember:lewie', { parentEmails: ['p@x.com'], parentEmail: 'p@x.com', firstName: 'Lewie', number: 72 });
  // Resend send -> ok
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

// Grab the code the handler stored (its sha256), by brute-forcing is not needed:
// we intercept by reading otp record and re-deriving via a known code path. So
// instead we make randomCode deterministic by seeding fetch to capture the text.
// Simpler: capture the code from the email body fetch call.
function codeFromLastEmail() {
  const call = global.fetch.mock.calls.at(-1);
  const sent = JSON.parse(call[1].body);
  const m = /code is: (\d{6})/.exec(sent.text);
  return m ? m[1] : null;
}

describe('request-code', () => {
  it('rejects wrong method', async () => {
    const res = makeRes();
    await requestCode({ method: 'GET' }, res);
    expect(res.statusCode).toBe(405);
  });
  it('unknown player: same ok answer, no email sent', async () => {
    const res = makeRes();
    await requestCode(post({ email: 'p@x.com', playerId: 'nobody' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('rejects bad email', async () => {
    const res = makeRes();
    await requestCode(post({ email: 'nope', playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(400);
  });
  it('sends a code for a roster player', async () => {
    const res = makeRes();
    await requestCode(post({ email: 'p@x.com', playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(codeFromLastEmail()).toMatch(/^\d{6}$/);
  });
  it('rate-limits one email after 5 requests in the hour (any player ids)', async () => {
    for (let i = 0; i < 5; i++) {
      const r = makeRes();
      await requestCode(post({ email: 'p@x.com', playerId: `kid${i}` }), r);
      expect(r.statusCode).toBe(200);
    }
    const r6 = makeRes();
    await requestCode(post({ email: 'p@x.com', playerId: 'lewie' }), r6);
    expect(r6.statusCode).toBe(429);
  });
  it('503 when not configured', async () => {
    delete process.env.RESEND_API_KEY;
    const res = makeRes();
    await requestCode(post({ email: 'p@x.com', playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(503);
  });
});

async function getVerifiedToken(email = 'p@x.com', playerId = 'lewie') {
  await requestCode(post({ email, playerId }), makeRes());
  const code = codeFromLastEmail();
  const res = makeRes();
  await verify(post({ email, playerId, code }), res);
  return { res, token: res.body && res.body.uploadToken, code };
}

describe('verify', () => {
  it('mints a token on the right code', async () => {
    const { res, token } = await getVerifiedToken();
    expect(res.statusCode).toBe(200);
    expect(typeof token).toBe('string');
  });
  it('401 on a wrong code', async () => {
    await requestCode(post({ email: 'p@x.com', playerId: 'lewie' }), makeRes());
    const res = makeRes();
    await verify(post({ email: 'p@x.com', playerId: 'lewie', code: '000000' }), res);
    expect(res.statusCode).toBe(401);
  });
  it('locks after too many wrong attempts', async () => {
    await requestCode(post({ email: 'p@x.com', playerId: 'lewie' }), makeRes());
    for (let i = 0; i < 5; i++) {
      await verify(post({ email: 'p@x.com', playerId: 'lewie', code: '111111' }), makeRes());
    }
    // Locked: even the right code no longer works, and the answer says nothing more.
    const res = makeRes();
    await verify(post({ email: 'p@x.com', playerId: 'lewie', code: codeFromLastEmail() }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'bad code' });
  });
  it('rejects bad input', async () => {
    const res = makeRes();
    await verify(post({ email: 'p@x.com', playerId: 'lewie', code: 'abc' }), res);
    expect(res.statusCode).toBe(400);
  });
});

// A stored photo (and optionally its photo consent) as an earlier upload left it.
async function seedPhoto(id, { consent = false } = {}) {
  await getKv().set(`photo:${id}`, { url: `https://blob.example/photos/${id}.png`, key: `photos/${id}.png`, updatedAt: 1 });
  if (consent) await getKv().set(`photoConsent:${id}`, { method: 'text', grantedBy: 'A parent', adminRecorded: true, grantedAt: 1 });
}

describe('get and remove', () => {
  it('404 when no photo', async () => {
    const res = makeRes();
    await getPhoto(get({ playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(404);
  });
  it('returns the stored url, and a verified parent remove deletes it', async () => {
    const { token } = await getVerifiedToken();
    await seedPhoto('lewie');

    const g1 = makeRes();
    await getPhoto(get({ playerId: 'lewie' }), g1);
    expect(g1.statusCode).toBe(200);
    expect(g1.body.url).toContain('blob.example');

    const r = makeRes();
    await remove(post({ playerId: 'lewie' }, { authorization: `Bearer ${token}` }), r);
    expect(r.statusCode).toBe(200);
    expect(blobDel).toHaveBeenCalledOnce();

    const g2 = makeRes();
    await getPhoto(get({ playerId: 'lewie' }), g2);
    expect(g2.statusCode).toBe(404);
  });
  it('remove refuses no token and a token for a different player, and deletes nothing', async () => {
    await seedPhoto('teddy');
    const { token } = await getVerifiedToken('p@x.com', 'lewie');
    for (const headers of [{}, { authorization: `Bearer ${token}` }]) {
      const r = makeRes();
      await remove(post({ playerId: 'teddy' }, headers), r);
      expect(r.statusCode).toBe(401);
    }
    expect(blobDel).not.toHaveBeenCalled();
  });
});

describe('admin photo retirement (POST /api/photo/remove { all })', () => {
  const adminHdr = { authorization: 'Bearer admin-test-token' };
  async function seed() {
    for (const id of ['lewie', 'teddy']) await seedPhoto(id, { consent: true });
  }
  it('refuses without the admin login', async () => {
    await seed();
    const res = makeRes();
    await remove(post({ all: true, confirm: 'DELETE ALL PLAYER PHOTOS' }), res);
    expect(res.statusCode).toBe(401);
    expect(blobDel).not.toHaveBeenCalled();
  });
  it('dry run by default: lists what would be deleted and deletes nothing', async () => {
    await seed();
    const res = makeRes();
    await remove(post({ all: true }, adminHdr), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.deleted).toBe(0);
    expect(res.body.players.map((p) => p.id).sort()).toEqual(['lewie', 'teddy']);
    expect(blobDel).not.toHaveBeenCalled();
    expect(await getConsent(getKv(), 'lewie')).toBeTruthy();
  });
  it('a near-miss confirm phrase is still only a dry run', async () => {
    await seed();
    const res = makeRes();
    await remove(post({ all: true, confirm: 'delete all player photos' }, adminHdr), res);
    expect(res.body.dryRun).toBe(true);
    expect(blobDel).not.toHaveBeenCalled();
  });
  it('the exact phrase deletes every photo blob, photo record and consent record', async () => {
    await seed();
    const res = makeRes();
    await remove(post({ all: true, confirm: 'DELETE ALL PLAYER PHOTOS' }, adminHdr), res);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.deleted).toBe(2);
    expect(blobDel).toHaveBeenCalledTimes(2);
    expect(await getConsent(getKv(), 'lewie')).toBeNull();
    const g = makeRes();
    await getPhoto(get({ playerId: 'lewie' }), g);
    expect(g.body && g.body.url).toBeFalsy();
  });
});
