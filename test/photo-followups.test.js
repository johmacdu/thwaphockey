// test/photo-followups.test.js
//
// Follow-ups to the photo endpoint audit (PR #488):
//   1. Removing a photo withdraws its PHOTO consent, never the sign-in consent.
//   2. The parent photo token lives 1 hour, not 30 days.
// Uploads were retired on 2026-10-29: stored photos are seeded directly here.
//   3. Admin sweep of orphaned blobs under photos/ (dry run by default).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
const blobDel = vi.fn(async () => {});
const blobList = vi.fn(async () => ({ blobs: [], hasMore: false }));
vi.mock('@vercel/blob', () => ({
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
const { default: remove } = await import('../api/photo/remove.js');
const store = await import('../lib/photo_store.js');
const { getKv } = await import('../lib/photo_common.js');

const PARENT = 'parent@family.example';
const seedPhoto = (pid = 'lewie') =>
  getKv().set(`photo:${pid}`, { url: `https://blob.example/photos/${pid}.png`, key: `photos/${pid}.png`, updatedAt: 1 });

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
    await seedPhoto('lewie');
    expect(await store.getPhotoConsent(getKv(), 'lewie')).toBeTruthy();

    const res = makeRes();
    await remove(post({ playerId: 'lewie' }, bearer(t)), res);
    expect(res.statusCode).toBe(200);
    expect(await store.getPhoto(getKv(), 'lewie')).toBeNull();
    expect(await store.getPhotoConsent(getKv(), 'lewie')).toBeNull();
    const signIn = await store.getConsent(getKv(), 'lewie');
    expect(signIn).toBeTruthy();
    expect(signIn.method).toBe('email');
  });

  it('the admin retire sweep deletes photo consent and keeps sign-in consent', async () => {
    await store.recordConsent(getKv(), 'lewie', PARENT);
    await verifiedToken('lewie');
    await seedPhoto('lewie');
    const res = makeRes();
    await remove(post({ all: true, confirm: 'DELETE ALL PLAYER PHOTOS' }, bearer('admin-test-token')), res);
    expect(res.statusCode).toBe(200);
    expect(await store.getPhotoConsent(getKv(), 'lewie')).toBeNull();
    expect(await store.getConsent(getKv(), 'lewie')).toBeTruthy();
  });
});

describe('2. the parent photo token lives 1 hour', () => {
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

  it('remove takes the token at 59 minutes and refuses it after 1 hour', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 9, 1, 12, 0, 0));
    const t = await verifiedToken('lewie');
    vi.setSystemTime(Date.UTC(2026, 9, 1, 13, 0, 1));
    let res = makeRes();
    await remove(post({ playerId: 'lewie' }, bearer(t)), res);
    expect(res.statusCode).toBe(401);
    const t2 = await verifiedToken('lewie');
    await seedPhoto('lewie');
    vi.setSystemTime(Date.UTC(2026, 9, 1, 13, 59, 0));
    res = makeRes();
    await remove(post({ playerId: 'lewie' }, bearer(t2)), res);
    expect(res.statusCode).toBe(200);
    expect(await store.getPhoto(getKv(), 'lewie')).toBeNull();
    res = makeRes();
    await remove(post({ playerId: 'lewie' }, bearer(t)), res);
    expect(res.statusCode).toBe(401);
    vi.useRealTimers();
  });
});

describe('3. admin sweep of orphaned photo files (photos/ prefix)', () => {
  const blob = (pathname) => ({ pathname, url: `https://blob.example/${pathname}`, size: 100, uploadedAt: '2026-09-01T00:00:00.000Z' });
  function seedStorage() {
    // Current records: lewie (on a team) and ghost (left every team, record kept).
    fake.map.set('photo:lewie', { url: 'https://blob.example/photos/live-lewie.jpeg', key: 'photos/live-lewie.jpeg', updatedAt: 1 });
    fake.map.set('photo:ghost', { url: 'https://blob.example/photos/live-ghost.png', key: 'photos/live-ghost.png', updatedAt: 1 });
    // A photo OTP record shares the word "photo" but is not a photo record.
    fake.map.set('otp:photo:lewie:parent@family.example', { codeHash: 'x', expiresAt: 0, attempts: 0 });
    blobList.mockImplementation(async ({ cursor } = {}) => (cursor
      ? { blobs: [blob('photos/old-2.jpeg')], hasMore: false }
      : { blobs: [blob('photos/live-lewie.jpeg'), blob('photos/old-1.jpeg'), blob('photos/live-ghost.png')], hasMore: true, cursor: 'p2' }));
  }
  const ADMIN = bearer('admin-test-token');

  it('dry run by default: lists only unreferenced files and deletes nothing', async () => {
    seedStorage();
    const res = makeRes();
    await remove(post({ orphans: true }, ADMIN), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.deleted).toBe(0);
    expect(res.body.scanned).toBe(4);
    expect(res.body.count).toBe(2);
    expect(res.body.orphans.map((o) => o.pathname).sort()).toEqual(['photos/old-1.jpeg', 'photos/old-2.jpeg']);
    expect(blobDel).not.toHaveBeenCalled();
    expect(blobList.mock.calls[0][0].prefix).toBe('photos/');
  });

  it('a wrong confirm phrase is still a dry run', async () => {
    seedStorage();
    const res = makeRes();
    await remove(post({ orphans: true, confirm: 'yes' }, ADMIN), res);
    expect(res.body.dryRun).toBe(true);
    expect(blobDel).not.toHaveBeenCalled();
  });

  it('the exact confirm phrase deletes only the orphans, never a referenced image', async () => {
    seedStorage();
    const res = makeRes();
    await remove(post({ orphans: true, confirm: 'DELETE ORPHANED PHOTOS' }, ADMIN), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.deleted).toBe(2);
    const deletedUrls = blobDel.mock.calls.flatMap((c) => c[0]);
    expect(deletedUrls.sort()).toEqual(['https://blob.example/photos/old-1.jpeg', 'https://blob.example/photos/old-2.jpeg']);
    expect(deletedUrls.some((u) => u.includes('live-'))).toBe(false);
    expect(await store.getPhoto(getKv(), 'lewie')).toBeTruthy();
    expect(await store.getPhoto(getKv(), 'ghost')).toBeTruthy();
  });

  it('a non-admin is refused before storage is listed (no key, or a parent upload token)', async () => {
    seedStorage();
    const t = await verifiedToken('lewie');
    for (const req of [
      post({ orphans: true, confirm: 'DELETE ORPHANED PHOTOS' }),
      post({ orphans: true, confirm: 'DELETE ORPHANED PHOTOS' }, bearer(t)),
    ]) {
      const res = makeRes();
      await remove(req, res);
      expect(res.statusCode).toBe(401);
    }
    expect(blobList).not.toHaveBeenCalled();
    expect(blobDel).not.toHaveBeenCalled();
  });

  it('if the records cannot be read, it stops with a 500 and deletes nothing', async () => {
    seedStorage();
    const realScan = fake.scan;
    fake.scan = async () => { throw new Error('kv down'); };
    try {
      const res = makeRes();
      await remove(post({ orphans: true, confirm: 'DELETE ORPHANED PHOTOS' }, ADMIN), res);
      expect(res.statusCode).toBe(500);
      expect(blobDel).not.toHaveBeenCalled();
    } finally {
      fake.scan = realScan;
    }
  });
});
