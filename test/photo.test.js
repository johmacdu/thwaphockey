// test/photo.test.js
//
// Tests for the parent-gated photo endpoints. Redis is faked, Vercel Blob is
// mocked, and fetch (Resend) is stubbed. Env vars are set so the "configured"
// gate passes; a separate test clears them to prove the 503 fail-closed path.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';
import { JPEG_URL } from './fixtures/photo_images.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

// Mock Vercel Blob put/del.
const blobPut = vi.fn(async (key) => ({ url: `https://blob.example/${key}` }));
const blobDel = vi.fn(async () => {});
vi.mock('@vercel/blob', () => ({ put: (...a) => blobPut(...a), del: (...a) => blobDel(...a) }));

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
const { default: upload } = await import('../api/photo/upload.js');
const { default: remove } = await import('../api/photo/remove.js');
const { default: getPhoto } = await import('../api/photo/get.js');
const { default: adminPut } = await import('../api/photo/admin-put.js');
const { getConsent } = await import('../lib/photo_store.js');
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
  blobPut.mockClear();
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

const IMG = JPEG_URL;

describe('upload', () => {
  it('stores a photo with a valid token', async () => {
    const { token } = await getVerifiedToken();
    const res = makeRes();
    await upload(post({ playerId: 'lewie', imageData: IMG }, { authorization: `Bearer ${token}` }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toContain('blob.example');
    expect(blobPut).toHaveBeenCalledOnce();
  });
  it('401 without a token', async () => {
    const res = makeRes();
    await upload(post({ playerId: 'lewie', imageData: IMG }), res);
    expect(res.statusCode).toBe(401);
  });
  it('401 with a token for a different player', async () => {
    const { token } = await getVerifiedToken('p@x.com', 'lewie');
    const res = makeRes();
    await upload(post({ playerId: 'teddy', imageData: IMG }, { authorization: `Bearer ${token}` }), res);
    expect(res.statusCode).toBe(401);
  });
  it('rejects a non-image payload', async () => {
    const { token } = await getVerifiedToken();
    const res = makeRes();
    await upload(post({ playerId: 'lewie', imageData: 'data:text/plain;base64,aGk=' }, { authorization: `Bearer ${token}` }), res);
    expect(res.statusCode).toBe(400);
  });
  it('rejects an oversize image', async () => {
    const { token } = await getVerifiedToken();
    const big = 'data:image/jpeg;base64,' + 'A'.repeat(600 * 1024);
    const res = makeRes();
    await upload(post({ playerId: 'lewie', imageData: big }, { authorization: `Bearer ${token}` }), res);
    expect(res.statusCode).toBe(400);
  });
});

describe('get and remove', () => {
  it('404 when no photo', async () => {
    const res = makeRes();
    await getPhoto(get({ playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(404);
  });
  it('returns the url after upload, and remove deletes it', async () => {
    const { token } = await getVerifiedToken();
    await upload(post({ playerId: 'lewie', imageData: IMG }, { authorization: `Bearer ${token}` }), makeRes());

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
});

describe('admin-put (admin-recorded consent)', () => {
  const adminHdr = { authorization: 'Bearer admin-test-token' };
  const goodConsent = { method: 'text', grantedBy: 'Josh Delatoree' };

  it('rejects without the admin key', async () => {
    const res = makeRes();
    await adminPut(post({ playerId: 'lewie', imageData: IMG, consent: goodConsent }), res);
    expect(res.statusCode).toBe(401);
  });

  it('rejects an unknown player', async () => {
    const res = makeRes();
    await adminPut(post({ playerId: 'nobody', imageData: IMG, consent: goodConsent }, adminHdr), res);
    expect(res.statusCode).toBe(400);
  });

  it('requires a consent method', async () => {
    const res = makeRes();
    await adminPut(post({ playerId: 'lewie', imageData: IMG, consent: { grantedBy: 'Josh' } }, adminHdr), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/consent method/);
  });

  it('requires who granted consent', async () => {
    const res = makeRes();
    await adminPut(post({ playerId: 'lewie', imageData: IMG, consent: { method: 'text' } }, adminHdr), res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/grantedBy/);
  });

  it('rejects a bad consent method', async () => {
    const res = makeRes();
    await adminPut(post({ playerId: 'lewie', imageData: IMG, consent: { method: 'because-i-said-so', grantedBy: 'Josh' } }, adminHdr), res);
    expect(res.statusCode).toBe(400);
  });

  it('stores the photo AND a truthful recorded-consent record (not a fake email)', async () => {
    const res = makeRes();
    await adminPut(post({ playerId: 'lewie', imageData: IMG, consent: goodConsent }, adminHdr), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toContain('blob.example');

    // photo is retrievable
    const g = makeRes();
    await getPhoto(get({ playerId: 'lewie' }), g);
    expect(g.statusCode).toBe(200);

    // consent record is honest: method text, names the parent, flags admin-recorded,
    // and does NOT masquerade as a verified email (no emailHash).
    const consent = await getConsent(getKv(), 'lewie');
    expect(consent.method).toBe('text');
    expect(consent.grantedBy).toBe('Josh Delatoree');
    expect(consent.adminRecorded).toBe(true);
    expect(consent.recordedBy).toBe('admin');
    expect(consent.emailHash).toBeUndefined();
  });
});

describe('admin photo retirement (POST /api/photo/remove { all })', () => {
  const adminHdr = { authorization: 'Bearer admin-test-token' };
  const goodConsent = { method: 'text', grantedBy: 'A parent' };
  async function seed() {
    for (const id of ['lewie', 'teddy']) {
      await adminPut(post({ playerId: id, imageData: IMG, consent: goodConsent }, adminHdr), makeRes());
    }
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
