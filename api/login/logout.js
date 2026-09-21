// api/login/logout.js
//
// POST -> clears the HTTP-only session cookie. Idempotent; always 200.

import { clearSessionCookie } from '../session_store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https') || true;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Set-Cookie', clearSessionCookie({ secure }));
  return res.status(200).json({ ok: true });
}
