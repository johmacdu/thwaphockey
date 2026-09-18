// test/photo.test.js
//
// Tests for the parent-gated photo endpoints. Redis is faked, Vercel Blob is
// mocked, and fetch (Resend) is stubbed. Env vars are set so the "configured"
// gate passes; a separate test clears them to prove the 503 fail-closed path.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

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
}
setEnv();

const { default: requestCode } = await import('../api/photo/request-code.js');
const { default: verify } = await import('../api/photo/verify.js');
const { default: upload } = await import('../api/photo/upload.js');
const { default: remove } = await import('../api/photo/remove.js');
const { default: getPhoto } = await import('../api/photo/get.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body, headers = {}) => ({ method: 'POST', body, headers });
const get = (query) => ({ method: 'GET', query });

beforeEach(() => {
  fake.map.clear();
  setEnv();
  blobPut.mockClear();
  blobDel.mockClear();
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
  it('rejects unknown player', async () => {
    const res = makeRes();
    await requestCode(post({ email: 'p@x.com', playerId: 'nobody' }), res);
    expect(res.statusCode).toBe(400);
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
  it('rate-limits after 5 requests in the hour', async () => {
    for (let i = 0; i < 5; i++) {
      const r = makeRes();
      await requestCode(post({ email: 'p@x.com', playerId: 'lewie' }), r);
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
    const res = makeRes();
    await verify(post({ email: 'p@x.com', playerId: 'lewie', code: '111111' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.reason).toBe('locked');
  });
  it('rejects bad input', async () => {
    const res = makeRes();
    await verify(post({ email: 'p@x.com', playerId: 'lewie', code: 'abc' }), res);
    expect(res.statusCode).toBe(400);
  });
});

const IMG = 'data:image/jpeg;base64,' + Buffer.from('hello-jpeg-bytes').toString('base64');

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
