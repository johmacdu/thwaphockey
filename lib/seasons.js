// lib/seasons.js
//
// Seasonal billing: three one-time passes per team, per year. Pure logic, no
// store and no Stripe, so it can be unit-tested on its own and shared by the
// billing store, the checkout endpoint, and the client paywall.
//
// Windows (inclusive), by month, in the app timezone (America/Vancouver):
//   Fall/Winter   Sep 1 - Mar 31   $350   id 'fw'   key fw-<startYear>
//   Spring        Apr 1 - Jun 30   $90    id 'sp'   key sp-<year>
//   Off-season    Jul 1 - Aug 31   $60    id 'os'   key os-<year>
//
// Fall/Winter spans two calendar years; its key year is the SEPTEMBER it began,
// so Jan-Mar maps back to the prior year (Jan 2026 -> fw-2025).

const TZ = 'America/Vancouver';

export const SEASONS = {
  fw: { id: 'fw', label: 'Fall/Winter', priceCents: 35000, env: 'STRIPE_PRICE_FW' },
  sp: { id: 'sp', label: 'Spring', priceCents: 9000, env: 'STRIPE_PRICE_SP' },
  os: { id: 'os', label: 'Off-season', priceCents: 6000, env: 'STRIPE_PRICE_OS' },
};

const KEY_RE = /^(fw|sp|os)-(\d{4})$/;

// Year + month (1-12) for a date, read in the app timezone so season boundaries
// line up with the rest of the app's Vancouver-local date logic.
function ymInTZ(date) {
  const d = date instanceof Date ? date : (date ? new Date(date) : new Date());
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(d);
  const y = Number(parts.find((p) => p.type === 'year').value);
  const m = Number(parts.find((p) => p.type === 'month').value);
  return { y, m };
}

// The season id ('fw' | 'sp' | 'os') for a calendar month (1-12).
export function seasonIdForMonth(m) {
  if (m >= 9 || m <= 3) return 'fw'; // Sep-Dec + Jan-Mar
  if (m >= 4 && m <= 6) return 'sp'; // Apr-Jun
  return 'os'; // Jul-Aug
}

// The active season KEY for a date, e.g. 'fw-2025', 'sp-2026', 'os-2026'.
export function currentSeasonKey(date) {
  const { y, m } = ymInTZ(date);
  const id = seasonIdForMonth(m);
  const year = id === 'fw' && m <= 3 ? y - 1 : y; // Jan-Mar belongs to the prior Sept
  return `${id}-${year}`;
}

// Parse a season key into { id, year, key, label, priceCents, env }, or null.
export function parseSeasonKey(key) {
  const m = KEY_RE.exec(String(key || ''));
  if (!m) return null;
  const id = m[1];
  const year = Number(m[2]);
  return { ...SEASONS[id], id, year, key: `${id}-${year}` };
}

export function isSeasonKey(key) {
  return KEY_RE.test(String(key || ''));
}

// Price in cents for a season key (0 for an unknown key).
export function priceCentsForKey(key) {
  const p = parseSeasonKey(key);
  return p ? p.priceCents : 0;
}

// Human label for a season key, e.g. 'Fall/Winter 2025-26', 'Spring 2026'.
export function labelForKey(key) {
  const p = parseSeasonKey(key);
  if (!p) return '';
  if (p.id === 'fw') return `Fall/Winter ${p.year}-${String((p.year + 1) % 100).padStart(2, '0')}`;
  return `${p.label} ${p.year}`;
}

// The season that follows a given one, in calendar order:
//   fw-Y -> sp-(Y+1) -> os-(Y+1) -> fw-(Y+1) ...
export function nextSeasonKey(key) {
  const p = parseSeasonKey(key);
  if (!p) return null;
  if (p.id === 'fw') return `sp-${p.year + 1}`;
  if (p.id === 'sp') return `os-${p.year}`;
  return `fw-${p.year}`; // os -> fw of the same calendar year (that September)
}

// The seasons a team can buy right now: the current one plus the next few, so a
// coach can pay ahead. Returns an ordered list of season keys.
export function buyableSeasons(date, count = 3) {
  let key = currentSeasonKey(date);
  const out = [key];
  for (let i = 1; i < count && key; i += 1) {
    key = nextSeasonKey(key);
    if (key) out.push(key);
  }
  return out;
}
