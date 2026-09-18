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

  // Test helper: seed a key directly.
  _seed(key, value) {
    this.map.set(key, value);
  }
}
