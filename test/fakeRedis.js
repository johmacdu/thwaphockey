// test/fakeRedis.js
//
// Minimal in-memory stand-in for @upstash/redis, used by the store unit tests.
// Implements only the methods store.js uses: get, set, mget. Values are held as
// live JS objects (mirroring Upstash auto-deserialize), so a JSON array set by
// the store comes back as an array, matching the real client's behavior.

export class FakeRedis {
  constructor() {
    this.map = new Map();
  }

  // eslint-disable-next-line require-await
  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  // eslint-disable-next-line require-await
  async set(key, value) {
    this.map.set(key, value);
    return 'OK';
  }

  // Variadic mget: returns values in the same order as the keys, null if missing.
  // eslint-disable-next-line require-await
  async mget(...keys) {
    return keys.map((k) => (this.map.has(k) ? this.map.get(k) : null));
  }

  // eslint-disable-next-line require-await
  async del(...keys) {
    let n = 0;
    for (const k of keys) { if (this.map.delete(k)) n += 1; }
    return n;
  }

  // --- set ops (waitlist emails) ---
  // sadd returns the count of NEW members added (0 if already present).
  // eslint-disable-next-line require-await
  async sadd(key, ...members) {
    let set = this.map.get(key);
    if (!(set instanceof Set)) { set = new Set(); this.map.set(key, set); }
    let added = 0;
    for (const m of members) { if (!set.has(m)) { set.add(m); added += 1; } }
    return added;
  }

  // --- list ops (waitlist entries; lpush prepends so lrange is newest-first) ---
  // eslint-disable-next-line require-await
  async lpush(key, ...values) {
    let list = this.map.get(key);
    if (!Array.isArray(list)) { list = []; this.map.set(key, list); }
    for (const v of values) list.unshift(v);
    return list.length;
  }

  // lrange(key, 0, -1) returns the whole list; supports negative stop like Redis.
  // eslint-disable-next-line require-await
  async lrange(key, start, stop) {
    const list = this.map.get(key);
    if (!Array.isArray(list)) return [];
    const end = stop < 0 ? list.length + stop + 1 : stop + 1;
    return list.slice(start, end);
  }

  // Test helper: seed a key directly.
  _seed(key, value) {
    this.map.set(key, value);
  }
}
