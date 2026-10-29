// test/photo-audit.test.js
//
// Security audit of the photo endpoints (children's photos). Each describe is
// one finding; every test here failed on origin/main before the fix.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';
import { JPEG_URL, PNG_URL, GPS_MARK, dataUrl } from './fixtures/photo_images.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
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
const { mintToken, getPhoto: readPhoto, getPhotoConsent: getConsent, recordPhotoConsent } = await import('../lib/photo_store.js');
const { getKv } = await import('../lib/photo_common.js');
const { mintSession } = await import('../lib/session_store.js');
const { mintWatchToken } = await import('../lib/watch_store.js');
const { setTeam, addMember } = await import('../lib/teams_store.js');

const PARENT = 'parent@family.example';
const STRANGER = 'stranger@evil.example';

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
let ipSeq = 0;
const freshIp = () => `10.0.${Math.floor(ipSeq / 250)}.${(ipSeq++ % 250) + 1}`;
const post = (body, headers = {}) => ({ method: 'POST', body, headers: { 'x-real-ip': freshIp(), ...headers } });
const getReq = (query, headers = {}) => ({ method: 'GET', query, headers });
const bearer = (t) => ({ authorization: `Bearer ${t}` });
const cookieFor = (pid) => ({ cookie: `thwapSession=${mintSession(pid, PARENT)}` });
const emailsSent = () => global.fetch.mock.calls.filter((c) => String(c[0]).includes('resend'));
function lastCode() {
  const c = emailsSent().at(-1);
  const m = c && /code is: (\d{6})/.exec(JSON.parse(c[1].body).text);
  return m ? m[1] : null;
}
// A verified parent: the photo consent a code verify writes, plus its token.
async function parentToken(pid) {
  await recordPhotoConsent(getKv(), pid, PARENT);
  return mintToken(pid);
}
async function photoKeys() {
  return [...fake.map.keys()].filter((k) => k.startsWith('photo:') && fake.map.get(k));
}

beforeEach(async () => {
  fake.map.clear();
  if (fake.ttls) fake.ttls.clear();
  setEnv();
  blobPut.mockClear();
  blobDel.mockClear();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  fake.map.set('teamMember:lewie', { parentEmails: [PARENT], parentEmail: PARENT, parentEmail2: '', firstName: 'Lewie', number: 72 });
  await setTeam('FLYERS10', { name: 'Flyers 9U', createdAt: new Date().toISOString() });
  await addMember('FLYERS10', { playerId: 'zara', firstName: 'Zara', number: 44, parentEmails: ['zara.parent@family.example'] });
});

describe('request-code only emails a parent ON FILE (any email used to unlock any child)', () => {
  it('a stranger email gets the same answer and NO code is sent or stored', async () => {
    const res = makeRes();
    await requestCode(post({ email: STRANGER, playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(emailsSent()).toHaveLength(0);
    expect([...fake.map.keys()].some((k) => k.startsWith('otp:'))).toBe(false);
  });
  it('the on-file parent still gets a code (legit path)', async () => {
    const res = makeRes();
    await requestCode(post({ email: PARENT, playerId: 'lewie' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(emailsSent()).toHaveLength(1);
    expect(JSON.parse(emailsSent()[0][1].body).to).toEqual([PARENT]);
  });
  it('unknown player and known player answer identically (no roster probe)', async () => {
    const a = makeRes();
    const b = makeRes();
    await requestCode(post({ email: STRANGER, playerId: 'nobody' }), a);
    await requestCode(post({ email: STRANGER, playerId: 'lewie' }), b);
    expect([a.statusCode, a.body]).toEqual([b.statusCode, b.body]);
    expect(a.statusCode).toBe(200);
  });
  it('a stranger cannot get an upload token for someone else\'s child', async () => {
    await requestCode(post({ email: STRANGER, playerId: 'lewie' }), makeRes());
    // Whatever reached the stranger's inbox (nothing, after the fix) is useless.
    const res = makeRes();
    await verify(post({ email: STRANGER, playerId: 'lewie', code: lastCode() || '123456' }), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.uploadToken).toBeUndefined();
    expect(await getConsent(getKv(), 'lewie')).toBeNull();
  });
});

describe('request-code rate limits are counted before the lookup', () => {
  it('per player: the 4th request in 15 minutes is a 429, for unknown ids too', async () => {
    for (const pid of ['lewie', 'nobody']) {
      for (let i = 0; i < 3; i++) {
        const r = makeRes();
        await requestCode(post({ email: `s${pid}${i}@evil.example`, playerId: pid }), r);
        expect(r.statusCode).toBe(200);
      }
      const r4 = makeRes();
      await requestCode(post({ email: `s${pid}4@evil.example`, playerId: pid }), r4);
      expect(r4.statusCode).toBe(429);
      expect(r4.body).toEqual({ error: 'too many requests, try again later' });
    }
  });
  it('per IP: 11th request from one address is a 429', async () => {
    const ip = { 'x-real-ip': '203.0.113.9' };
    for (let i = 0; i < 10; i++) {
      const r = makeRes();
      await requestCode(post({ email: `s${i}@evil.example`, playerId: `kid${i}` }, ip), r);
      expect(r.statusCode).toBe(200);
    }
    const r = makeRes();
    await requestCode(post({ email: 'sx@evil.example', playerId: 'kidx' }, ip), r);
    expect(r.statusCode).toBe(429);
  });
});

describe('verify: code bound to player, no state leak, rate limited', () => {
  it('a code sent for one player cannot unlock a different player', async () => {
    fake.map.set('teamMember:teddy', { parentEmails: [PARENT], parentEmail: PARENT, firstName: 'Teddy', number: 9 });
    await requestCode(post({ email: PARENT, playerId: 'lewie' }), makeRes());
    const code = lastCode();
    const res = makeRes();
    await verify(post({ email: PARENT, playerId: 'teddy', code }), res);
    expect(res.statusCode).toBe(401);
    expect(await getConsent(getKv(), 'teddy')).toBeNull();
  });
  it('the right code still mints a token and records consent (legit path)', async () => {
    await requestCode(post({ email: PARENT, playerId: 'lewie' }), makeRes());
    const res = makeRes();
    await verify(post({ email: PARENT, playerId: 'lewie', code: lastCode() }), res);
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.uploadToken).toBe('string');
    expect((await getConsent(getKv(), 'lewie')).method).toBe('email');
  });
  it('unknown player, no code, wrong code all answer the same 401 with no reason', async () => {
    await requestCode(post({ email: PARENT, playerId: 'lewie' }), makeRes());
    const cases = [
      { email: PARENT, playerId: 'nobody', code: '111111' },
      { email: STRANGER, playerId: 'lewie', code: '111111' },
      { email: PARENT, playerId: 'lewie', code: '111111' },
    ];
    const out = [];
    for (const c of cases) { const r = makeRes(); await verify(post(c), r); out.push([r.statusCode, r.body]); }
    expect(out.every((o) => o[0] === 401 && JSON.stringify(o[1]) === JSON.stringify({ error: 'bad code' }))).toBe(true);
  });
  it('cannot be pointed at the sign-in code (otp:pid:<id>)', async () => {
    const res = makeRes();
    await verify(post({ email: 'pid:lewie', playerId: 'lewie', code: '111111' }), res);
    expect(res.statusCode).toBe(400);
  });
  it('per IP: 11th verify from one address is a 429', async () => {
    const ip = { 'x-real-ip': '203.0.113.10' };
    for (let i = 0; i < 10; i++) await verify(post({ email: PARENT, playerId: 'lewie', code: '000000' }, ip), makeRes());
    const r = makeRes();
    await verify(post({ email: PARENT, playerId: 'lewie', code: '000000' }, ip), r);
    expect(r.statusCode).toBe(429);
  });
});

describe('get: team members and admin only (was public to anyone who guessed a first name)', () => {
  beforeEach(async () => {
    await adminPut(post({ playerId: 'lewie', imageData: JPEG_URL, consent: { method: 'text', grantedBy: 'A parent' } }, bearer('admin-test-token')), makeRes());
  });
  it('no session -> 401 for known and unknown players alike', async () => {
    for (const playerId of ['lewie', 'nobody']) {
      const r = makeRes();
      await getPhoto(getReq({ playerId }), r);
      expect(r.statusCode).toBe(401);
      expect(r.body.url).toBeUndefined();
    }
  });
  it('a teammate (same team session) sees the photo', async () => {
    const r = makeRes();
    await getPhoto(getReq({ playerId: 'lewie' }, cookieFor('teddy')), r);
    expect(r.statusCode).toBe(200);
    expect(r.body.url).toContain('blob.example');
  });
  it('admin sees the photo', async () => {
    const r = makeRes();
    await getPhoto(getReq({ playerId: 'lewie' }, bearer('admin-test-token')), r);
    expect(r.statusCode).toBe(200);
  });
  it('another team: same 404 as unknown player and no photo', async () => {
    const out = [];
    for (const playerId of ['lewie', 'nobody', 'teddy']) {
      const r = makeRes();
      await getPhoto(getReq({ playerId }, cookieFor(playerId === 'lewie' ? 'zara' : 'lewie')), r);
      out.push([r.statusCode, r.body]);
    }
    expect(out).toEqual([[404, { error: 'no photo' }], [404, { error: 'no photo' }], [404, { error: 'no photo' }]]);
  });
  it('a watch token is refused (cookie or bearer)', async () => {
    const w = mintWatchToken('teddy', 'a'.repeat(32), Date.now() + 60000);
    for (const headers of [{ cookie: `thwapSession=${w}` }, bearer(w)]) {
      const r = makeRes();
      await getPhoto(getReq({ playerId: 'lewie' }, headers), r);
      expect(r.statusCode).toBe(401);
    }
  });
});

describe('upload / remove: token checked first, watch and session tokens refused', () => {
  it('without a token, unknown and known players answer the same 401', async () => {
    const a = makeRes();
    const b = makeRes();
    await upload(post({ playerId: 'nobody', imageData: JPEG_URL }), a);
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }), b);
    expect([a.statusCode, a.body]).toEqual([401, { error: 'not verified' }]);
    expect([b.statusCode, b.body]).toEqual([401, { error: 'not verified' }]);
    const c = makeRes();
    const d = makeRes();
    await remove(post({ playerId: 'nobody' }), c);
    await remove(post({ playerId: 'lewie' }), d);
    expect([c.statusCode, c.body]).toEqual([401, { error: 'not verified' }]);
    expect([d.statusCode, d.body]).toEqual([401, { error: 'not verified' }]);
    expect(blobPut).not.toHaveBeenCalled();
  });
  it('watch, web session and coach tokens are all refused and write nothing', async () => {
    const tokens = [
      mintWatchToken('lewie', 'b'.repeat(32), Date.now() + 60000),
      mintSession('lewie', PARENT),
      mintSession('coach:6162', 'coach@x.example'),
    ];
    for (const t of tokens) {
      const u = makeRes();
      await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), u);
      expect(u.statusCode).toBe(401);
      const r = makeRes();
      await remove(post({ playerId: 'lewie' }, bearer(t)), r);
      expect(r.statusCode).toBe(401);
    }
    expect(blobPut).not.toHaveBeenCalled();
    expect(blobDel).not.toHaveBeenCalled();
    expect(await photoKeys()).toEqual([]);
  });
  it('upload is rate limited per player (11th in an hour is a 429)', async () => {
    const t = await parentToken('lewie');
    for (let i = 0; i < 10; i++) {
      const r = makeRes();
      await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), r);
      expect(r.statusCode).toBe(200);
    }
    const r = makeRes();
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(t)), r);
    expect(r.statusCode).toBe(429);
    expect(blobPut).toHaveBeenCalledTimes(10);
  });
});

describe('upload: image validation, EXIF stripped, random key, old blob deleted', () => {
  const t = () => parentToken('lewie');
  it('strips EXIF/GPS and comments from a JPEG', async () => {
    const r = makeRes();
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(await t())), r);
    expect(r.statusCode).toBe(200);
    const stored = blobPut.mock.calls[0][1];
    expect(stored.includes(Buffer.from(GPS_MARK))).toBe(false);
    expect(stored.includes(Buffer.from('Main St'))).toBe(false);
    expect(stored.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(stored.includes(Buffer.from('JFIF'))).toBe(true);
  });
  it('strips text/eXIf chunks from a PNG', async () => {
    const r = makeRes();
    await upload(post({ playerId: 'lewie', imageData: PNG_URL }, bearer(await t())), r);
    expect(r.statusCode).toBe(200);
    const stored = blobPut.mock.calls[0][1];
    expect(stored.includes(Buffer.from(GPS_MARK))).toBe(false);
    expect(stored.includes(Buffer.from('IDAT'))).toBe(true);
  });
  it('refuses bytes that are not the declared image type, and webp', async () => {
    for (const imageData of [
      dataUrl('jpeg', Buffer.from('<html><script>alert(1)</script>')),
      dataUrl('png', Buffer.from([0xff, 0xd8, 0xff, 0xd9])),
      dataUrl('webp', Buffer.from('RIFF0000WEBPVP8 ')),
    ]) {
      const r = makeRes();
      await upload(post({ playerId: 'lewie', imageData }, bearer(await t())), r);
      expect(r.statusCode).toBe(400);
    }
    expect(blobPut).not.toHaveBeenCalled();
  });
  it('the storage key carries no player name', async () => {
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(await t())), makeRes());
    const key = blobPut.mock.calls[0][0];
    expect(key).toMatch(/^photos\/[0-9a-f]{32}\.jpeg$/);
    expect(key).not.toContain('lewie');
  });
  it('replacing a photo deletes the old blob (parent and admin paths)', async () => {
    await upload(post({ playerId: 'lewie', imageData: JPEG_URL }, bearer(await t())), makeRes());
    const first = (await readPhoto(getKv(), 'lewie')).url;
    await upload(post({ playerId: 'lewie', imageData: PNG_URL }, bearer(await t())), makeRes());
    expect(blobDel).toHaveBeenCalledWith(first, expect.anything());
    const second = (await readPhoto(getKv(), 'lewie')).url;
    await adminPut(post({ playerId: 'lewie', imageData: JPEG_URL, consent: { method: 'text', grantedBy: 'A parent' } }, bearer('admin-test-token')), makeRes());
    expect(blobDel).toHaveBeenCalledWith(second, expect.anything());
  });
  it('admin-put strips metadata too', async () => {
    await adminPut(post({ playerId: 'lewie', imageData: JPEG_URL, consent: { method: 'text', grantedBy: 'A parent' } }, bearer('admin-test-token')), makeRes());
    expect(blobPut.mock.calls[0][1].includes(Buffer.from(GPS_MARK))).toBe(false);
  });
});
