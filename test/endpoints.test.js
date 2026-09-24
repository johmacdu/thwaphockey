// test/endpoints.test.js
//
// Unit tests for three endpoints that had no direct coverage:
//   api/waitlist.js - public signup (validation, idempotency, 503) + admin GET
//                     (auth gate, JSON + CSV export)
//   api/geo.js      - country from the Vercel header, canada flag
//   api/seed.js     - fail-closed without a key, key gate, idempotent create
//
// Redis is faked; fetch (Resend notify) is stubbed so a signup never makes a
// real network call.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FakeRedis } from './fakeRedis.js';

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.WAITLIST_ADMIN_TOKEN = 'wl-admin';
  delete process.env.WAITLIST_NOTIFY_EMAIL; // notify stays off unless a test sets it
  delete process.env.RESEND_API_KEY;
  process.env.SEED_KEY = 'seed-secret';
}
setEnv();

const { default: waitlist } = await import('../api/waitlist.js');
const { default: geo } = await import('../api/geo.js');
const { default: seed } = await import('../api/seed.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {}, sent: null,
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    send(p) { this.sent = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const post = (body, headers = {}, query = {}) => ({ method: 'POST', body, headers, query });
const get = (query = {}, headers = {}) => ({ method: 'GET', query, headers });

beforeEach(() => {
  fake.map.clear();
  setEnv();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
});

describe('waitlist POST (public signup)', () => {
  const good = { name: 'Woody', association: 'Vancouver Jr Rangers', ageLevels: ['10U'], region: 'US', email: 'p@x.com' };

  it('rejects a bad email', async () => {
    const res = makeRes();
    await waitlist(post({ ...good, email: 'nope' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('requires an association', async () => {
    const res = makeRes();
    await waitlist(post({ ...good, association: '' }), res);
    expect(res.statusCode).toBe(400);
  });

  it('requires at least one age level', async () => {
    const res = makeRes();
    await waitlist(post({ ...good, ageLevels: [] }), res);
    expect(res.statusCode).toBe(400);
  });

  it('records a valid signup', async () => {
    const res = makeRes();
    await waitlist(post(good), res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, added: true });
  });

  it('is idempotent: a repeat email is accepted but not double-stored', async () => {
    await waitlist(post(good), makeRes());
    const res = makeRes();
    await waitlist(post(good), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.added).toBe(false);
    // Only one row in the list
    const listed = makeRes();
    await waitlist(get({}, { authorization: 'Bearer wl-admin' }), listed);
    expect(listed.body.count).toBe(1);
  });

  it('503s when Redis is not configured', async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    const res = makeRes();
    await waitlist(post(good), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('waitlist GET (admin read-back)', () => {
  const good = { association: 'JR', ageLevels: ['10U'], email: 'a@x.com', region: 'CA' };

  it('401s without the admin token', async () => {
    await waitlist(post(good), makeRes());
    const res = makeRes();
    await waitlist(get({}), res);
    expect(res.statusCode).toBe(401);
  });

  it('returns entries as JSON with the token', async () => {
    await waitlist(post(good), makeRes());
    const res = makeRes();
    await waitlist(get({}, { authorization: 'Bearer wl-admin' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.entries[0].email).toBe('a@x.com');
  });

  it('exports CSV with a header row when format=csv', async () => {
    await waitlist(post(good), makeRes());
    const res = makeRes();
    await waitlist(get({ format: 'csv' }, { authorization: 'Bearer wl-admin' }), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toMatch(/text\/csv/);
    expect(res.sent.split('\r\n')[0]).toBe('email,association,ageLevels,region,signedUp');
    expect(res.sent).toMatch(/a@x\.com/);
  });

  it('503s read-back when the admin token is not set', async () => {
    delete process.env.WAITLIST_ADMIN_TOKEN;
    const res = makeRes();
    await waitlist(get({}), res);
    expect(res.statusCode).toBe(503);
  });
});

describe('geo', () => {
  it('reports the country from the Vercel header and flags Canada', async () => {
    const res = makeRes();
    await geo(get({}, { 'x-vercel-ip-country': 'ca' }), res);
    expect(res.body).toEqual({ country: 'CA', canada: true });
  });

  it('reports null country off-platform (no header)', async () => {
    const res = makeRes();
    await geo(get({}, {}), res);
    expect(res.body).toEqual({ country: null, canada: false });
  });

  it('rejects non-GET', async () => {
    const res = makeRes();
    await geo({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});

describe('seed', () => {
  it('fails closed (403) when SEED_KEY is not configured', async () => {
    delete process.env.SEED_KEY;
    const res = makeRes();
    await seed({ method: 'POST', headers: {} }, res);
    expect(res.statusCode).toBe(403);
  });

  it('403s on a wrong key', async () => {
    const res = makeRes();
    await seed({ method: 'POST', headers: { 'x-seed-key': 'wrong' } }, res);
    expect(res.statusCode).toBe(403);
  });

  it('creates missing players with the right key, idempotently', async () => {
    const first = makeRes();
    await seed({ method: 'POST', headers: { 'x-seed-key': 'seed-secret' } }, first);
    expect(first.statusCode).toBe(200);
    expect(first.body.created).toBeGreaterThan(0);
    // Second run creates nothing new.
    const second = makeRes();
    await seed({ method: 'POST', headers: { 'x-seed-key': 'seed-secret' } }, second);
    expect(second.body.created).toBe(0);
    expect(second.body.players.length).toBe(first.body.players.length);
  });

  it('rejects non-POST', async () => {
    const res = makeRes();
    await seed({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(405);
  });
});
