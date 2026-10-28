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

  // Key expiry (TTL), emulated against Date.now() so tests can move the clock
  // with vi.setSystemTime. Only keys given a TTL (set {ex|px} or expire) expire.
  _live(key) {
    const exp = this.ttls && this.ttls.get(key);
    if (exp != null && Date.now() >= exp) {
      this.map.delete(key);
      this.ttls.delete(key);
    }
    return this.map.has(key);
  }

  // eslint-disable-next-line require-await
  async get(key) {
    return this._live(key) ? this.map.get(key) : null;
  }

  // Supports the Upstash { ex } / { px } / { nx } options; any other set clears the TTL.
  // With nx, returns null (and writes nothing) when the key already exists.
  // eslint-disable-next-line require-await
  async set(key, value, opts) {
    if (opts && opts.nx && this._live(key)) return null;
    this.map.set(key, value);
    if (!this.ttls) this.ttls = new Map();
    if (opts && (opts.ex || opts.px)) {
      this.ttls.set(key, Date.now() + (opts.px ? opts.px : opts.ex * 1000));
    } else {
      this.ttls.delete(key);
    }
    return 'OK';
  }

  // eslint-disable-next-line require-await
  async incr(key) {
    const live = this._live(key);
    if (!live && this.ttls) this.ttls.delete(key); // a fresh key starts with no TTL, like Redis
    const cur = live ? Number(this.map.get(key)) || 0 : 0;
    this.map.set(key, cur + 1);
    return cur + 1;
  }

  // eslint-disable-next-line require-await
  async expire(key, seconds) {
    if (!this._live(key)) return 0;
    if (!this.ttls) this.ttls = new Map();
    this.ttls.set(key, Date.now() + seconds * 1000);
    return 1;
  }

  // -2 when the key is missing, -1 when it has no TTL, else whole seconds left.
  // eslint-disable-next-line require-await
  async ttl(key) {
    if (!this._live(key)) return -2;
    const exp = this.ttls && this.ttls.get(key);
    return exp == null ? -1 : Math.ceil((exp - Date.now()) / 1000);
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
