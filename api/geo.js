// api/geo.js
//
// GET /api/geo -> { country, canada }
//
// Reads the request's country from the header Vercel injects on every request
// (x-vercel-ip-country). Used by the waitlist form to show the Canadian age-
// division labels (U7/U9/U11/U13) to visitors in Canada, and the US labels
// (6U/8U/10U/12U) to everyone else. Returns null country off-platform (e.g.
// local dev), so the client falls back to the US labels.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method not allowed' });
  }
  const raw = req.headers && req.headers['x-vercel-ip-country'];
  const country = raw ? String(raw).toUpperCase() : null;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ country, canada: country === 'CA' });
}
