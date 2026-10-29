// test/photo-followups.test.js
//
// Follow-ups to the photo endpoint audit (PR #488):
//   1. Removing a photo withdraws its PHOTO consent, never the sign-in consent.
//   2. The photo upload token lives 1 hour, not 30 days.
//   3. Admin sweep of orphaned blobs under photos/ (dry run by default).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';
import { JPEG_URL } from './fixtures/photo_images.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
const blobPut = vi.fn(async (key) => ({ url: `https://blob.example/${key}` }));
const blobDel = vi.fn(async () => {});
const blobList = vi.fn(async () => ({ blobs: [], hasMore: false }));
vi.mock('@vercel/blob', () => ({
  put: (...a) => blobPut(...a),
  del: (...a) => blobDel(...a),
  list: (...a) => blobList(...a),
}));

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
const store = await import('../lib/photo_store.js');
const { getKv } = await import('../lib/photo_common.js');

const PARENT = 'parent@family.example';

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
let ipSeq = 0;
const freshIp = () => `10.9.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const post = (body, headers = {}) => ({ method: 'POST', body, query: {}, headers: { 'x-real-ip': freshIp(), ...headers } });
const bearer = (t) => ({ authorization: `Bearer ${t}` });

// The full parent path: request a code, read it from the sent email, verify.
async function verifiedToken(pid = 'lewie') {
  await requestCode(post({ email: PARENT, playerId: pid }), makeRes());
  const sent = global.fetch.mock.calls.filter((c) => String(c[0]).includes('resend')).at(-1);
  const code = /code is: (\d{6})/.exec(JSON.parse(sent[1].body).text)[1];
  const res = makeRes();
  await verify(post({ email: PARENT, playerId: pid, code }), res);
  expect(res.statusCode).toBe(200);
  return res.body.uploadToken;
}

beforeEach(() => {
  fake.map.clear();
  if (fake.ttls) fake.ttls.clear();
  setEnv();
  vi.useRealTimers();
  blobPut.mockClear();
  blobDel.mockClear();
  blobList.mockReset();
  blobList.mockImplementation(async () => ({ blobs: [], hasMore: false }));
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  fake.map.set('teamMember:lewie', { parentEmails: [PARENT], parentEmail: PARENT, parentEmail2: '', firstName: 'Lewie', number: 72 });
});

describe('1. removing a photo withdraws its photo consent, not sign-in consent', () => {
  it('verify writes a separate photo consent record and leaves sign-in consent alone', async () => {
    await store.recordConsent(getKv(), 'lewie', PARENT); // what sign-in writes
    const before = await store.getConsent(getKv(), 'lewie');
    await verifiedToken('lewie');
    expect((await store.getPhotoConsent(getKv(), 'lewie')).method).toBe('email');
    expect(await store.getConsent(getKv(), 'lewie')).toEqual(before);
  });

  it('remove deletes the photo consent but keeps the sign-in consent', async () => {
    await store.recordConsent(getKv(), 'lewie', PARENT);
    const t = await verifiedToken('lewie');
    let res = makeRes();
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), res);
    expect(res.statusCode).toBe(200);
    expect(await store.getPhotoConsent(getKv(), 'lewie')).toBeTruthy();

    res = makeRes();
    await remove(post({ playerId: 'lewie' }, bearer(t)), res);
    expect(res.statusCode).toBe(200);
    expect(await store.getPhoto(getKv(), 'lewie')).toBeNull();
    expect(await store.getPhotoConsent(getKv(), 'lewie')).toBeNull();
    const signIn = await store.getConsent(getKv(), 'lewie');
    expect(signIn).toBeTruthy();
    expect(signIn.method).toBe('email');
  });

  it('after a remove, the old token cannot put a photo back (consent was withdrawn)', async () => {
    const t = await verifiedToken('lewie');
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), makeRes());
    await remove(post({ playerId: 'lewie' }, bearer(t)), makeRes());
    blobPut.mockClear();
    const res = makeRes();
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), res);
    expect(res.statusCode).toBe(401);
    expect(blobPut).not.toHaveBeenCalled();
    expect(await store.getPhoto(getKv(), 'lewie')).toBeNull();
  });

  it('the admin retire sweep deletes photo consent and keeps sign-in consent', async () => {
    await store.recordConsent(getKv(), 'lewie', PARENT);
    const t = await verifiedToken('lewie');
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), makeRes());
    const res = makeRes();
    await remove(post({ all: true, confirm: 'DELETE ALL PLAYER PHOTOS' }, bearer('admin-test-token')), res);
    expect(res.statusCode).toBe(200);
    expect(await store.getPhotoConsent(getKv(), 'lewie')).toBeNull();
    expect(await store.getConsent(getKv(), 'lewie')).toBeTruthy();
  });
});

describe('2. the photo upload token lives 1 hour', () => {
  it('TOKEN_TTL_MS is one hour', () => {
    expect(store.TOKEN_TTL_MS).toBe(60 * 60 * 1000);
  });

  it('verifyToken accepts a token before 1 hour and rejects it after', () => {
    const t0 = Date.UTC(2026, 9, 1, 12, 0, 0);
    const t = store.mintToken('lewie', t0);
    expect(store.verifyToken(t, t0 + 59 * 60 * 1000)).toBe('lewie');
    expect(store.verifyToken(t, t0 + 60 * 60 * 1000 + 1)).toBeNull();
    expect(store.verifyToken(t, t0 + 24 * 60 * 60 * 1000)).toBeNull();
  });

  it('upload takes the token at 59 minutes and refuses it after 1 hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 1, 12, 0, 0));
    const t = await verifiedToken('lewie');
    vi.setSystemTime(Date.UTC(2026, 9, 1, 12, 59, 0));
    let res = makeRes();
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), res);
    expect(res.statusCode).toBe(200);
    vi.setSystemTime(Date.UTC(2026, 9, 1, 13, 0, 1));
    res = makeRes();
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), res);
    expect(res.statusCode).toBe(401);
    res = makeRes();
    await remove(post({ playerId: 'lewie' }, bearer(t)), res);
    expect(res.statusCode).toBe(401);
    vi.useRealTimers();
  });
});
