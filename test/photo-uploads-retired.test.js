// test/photo-uploads-retired.test.js
//
// Player photos were retired on 2026-10-29 (the drawn character is the card).
// Nothing may be able to SAVE a photo to the public Blob store any more, while
// the paths that DELETE what is already stored keep working.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { FakeRedis } from './fakeRedis.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const fake = new FakeRedis();
vi.mock('@upstash/redis', () => ({ Redis: class { constructor() { return fake; } } }));
const blobDel = vi.fn(async () => {});
const blobList = vi.fn(async () => ({ blobs: [], hasMore: false }));
vi.mock('@vercel/blob', () => ({ del: (...a) => blobDel(...a), list: (...a) => blobList(...a) }));

function setEnv() {
  process.env.KV_REST_API_URL = 'https://fake';
  process.env.KV_REST_API_TOKEN = 'fake';
  process.env.PHOTO_TOKEN_SECRET = 'test-secret-please-change';
  process.env.BLOB_READ_WRITE_TOKEN = 'blob_test';
  process.env.THWAP_ADMIN_TOKEN = 'admin-test-token';
}
setEnv();

const { default: remove } = await import('../api/photo/remove.js');
const store = await import('../lib/photo_store.js');

function makeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(p) { this.body = p; return this; },
    setHeader(k, v) { this.headers[k] = v; },
  };
}
const admin = (body) => ({ method: 'POST', query: {}, body, headers: { authorization: 'Bearer admin-test-token', 'x-real-ip': '10.3.0.1' } });

describe('no upload path is left', () => {
  it('the parent and admin upload endpoints are deleted', () => {
    expect(existsSync(join(ROOT, 'api/photo/upload.js'))).toBe(false);
    expect(existsSync(join(ROOT, 'api/photo/admin-put.js'))).toBe(false);
  });

  for (const page of ['admin.html', 'index.html']) {
    it(`${page} never calls an upload endpoint or offers Add photo for a player`, () => {
      const html = read(page);
      expect(html).not.toContain('/api/photo/upload');
      expect(html).not.toContain('/api/photo/admin-put');
      expect(html).not.toContain('@imgly/background-removal');
      expect(html).not.toMatch(/<button[^>]*class='addphoto'/);
    });
  }

  it('admin.html has no Add photo button or upload panel', () => {
    const html = read('admin.html');
    expect(html).not.toContain('Add photo');
    expect(html).not.toContain('Upload photo');
    expect(html).not.toMatch(/function (uploadPhoto|processImage|encodeUnderCap)\(/);
  });

  it('index.html has no photo pick, cutout or upload code', () => {
    const html = read('index.html');
    for (const fn of ['processFile', 'pickFile', 'uploadToServer', 'loadBgRemover', 'showPhotoBusy', 'saveLocal', 'wirePhotoButton']) {
      expect(html, fn).not.toMatch(new RegExp(`function ${fn}\\(`));
    }
    expect(html).not.toContain('window.thwapPhotoEdit');
  });

  it('the photo store has no write helper for a photo record', () => {
    expect(store.putPhoto).toBeUndefined();
    expect(store.recordAdminConsent).toBeUndefined();
  });

  it('no remaining api file can put to Blob storage', () => {
    for (const f of ['api/photo/get.js', 'api/photo/remove.js', 'api/photo/request-code.js', 'api/photo/verify.js']) {
      expect(read(f), f).not.toMatch(/\bput\b[^\n]*from '@vercel\/blob'|import \{[^}]*\bput\b[^}]*\} from '@vercel\/blob'/);
    }
  });
});

describe('deleting what is stored still works', () => {
  beforeEach(async () => {
    fake.map.clear();
    setEnv();
    blobDel.mockClear();
    blobList.mockReset();
    blobList.mockImplementation(async () => ({ blobs: [], hasMore: false }));
    fake.map.set('photo:lewie', { url: 'https://blob.example/photos/a.png', key: 'photos/a.png', updatedAt: 1 });
    fake.map.set('photoConsent:lewie', { method: 'text', grantedAt: 1 });
  });

  it('admin.html still has the retire and orphan cleanup controls', () => {
    const html = read('admin.html');
    expect(html).toContain("var PHRASE='DELETE ALL PLAYER PHOTOS';");
    expect(html).toContain("var OPHRASE='DELETE ORPHANED PHOTOS';");
    expect(html).toContain("fetch('/api/photo/remove'");
  });

  it('retire dry run lists the stored photo and deletes nothing', async () => {
    const res = makeRes();
    await remove(admin({ all: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.players).toEqual([{ id: 'lewie', hasPhoto: true, hasConsent: true }]);
    expect(blobDel).not.toHaveBeenCalled();
    expect(fake.map.get('photo:lewie')).toBeTruthy();
  });

  it('orphan dry run lists only unreferenced files and deletes nothing', async () => {
    const blob = (pathname) => ({ pathname, url: `https://blob.example/${pathname}`, size: 1, uploadedAt: '2026-09-01T00:00:00.000Z' });
    blobList.mockImplementation(async () => ({ blobs: [blob('photos/a.png'), blob('photos/old.png')], hasMore: false }));
    const res = makeRes();
    await remove(admin({ orphans: true }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.count).toBe(1);
    expect(res.body.orphans.map((o) => o.pathname)).toEqual(['photos/old.png']);
    expect(blobDel).not.toHaveBeenCalled();
  });

  it('retire with the exact phrase deletes the blob, record and photo consent', async () => {
    const res = makeRes();
    await remove(admin({ all: true, confirm: 'DELETE ALL PLAYER PHOTOS' }), res);
    expect(res.body.dryRun).toBe(false);
    expect(blobDel).toHaveBeenCalledWith('https://blob.example/photos/a.png', expect.anything());
    expect(fake.map.get('photo:lewie')).toBeFalsy();
    expect(fake.map.get('photoConsent:lewie')).toBeFalsy();
  });
});
