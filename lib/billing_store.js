// lib/billing_store.js
//
// Store seam for seasonal billing. Kept OUTSIDE api/ (Vercel's 12-function cap);
// mirrors lib/teams_store.js: one Redis client, codeNorm keys, never throws on a
// missing/malformed key.
//
// Data model (Upstash Redis):
//   teamBilling:<CODE>   { free: <bool>,
//                          seasons: { '<seasonKey>': { paidAt, amountCents,
//                                     currency, stripeSession } , ... } }
//
// A team is ACTIVE when it is marked free (e.g. Lewie's, the player who built
// Thwap) OR the current season key is present in its seasons map. Paid seasons
// are recorded by the Stripe webhook (checkout.session.completed), never trusted
// from the client.

import { Redis } from '@upstash/redis';
import { currentSeasonKey, isSeasonKey } from './seasons.js';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const codeNorm = (code) => String(code || '').trim().toUpperCase();
const billingKey = (code) => `teamBilling:${codeNorm(code)}`;

function empty() {
  return { free: false, seasons: {} };
}

// Normalize whatever is stored into the canonical shape, tolerating old/partial data.
function shape(raw) {
  if (!raw || typeof raw !== 'object') return empty();
  const seasons = raw.seasons && typeof raw.seasons === 'object' ? raw.seasons : {};
  return { free: raw.free === true, seasons };
}

export async function getTeamBilling(code) {
  if (!codeNorm(code)) return empty();
  try {
    return shape(await kv.get(billingKey(code)));
  } catch {
    return empty();
  }
}

// Mark a team free (comp) or paid-gated. Free teams skip the paywall entirely.
export async function setTeamFree(code, free) {
  if (!codeNorm(code)) return null;
  const b = await getTeamBilling(code);
  b.free = free === true;
  await kv.set(billingKey(code), b);
  return b;
}

// Record a paid season. Idempotent: re-recording a season overwrites its receipt.
// Returns the updated billing record, or null if the inputs are invalid.
export async function recordPayment(code, seasonKey, meta = {}) {
  if (!codeNorm(code) || !isSeasonKey(seasonKey)) return null;
  const b = await getTeamBilling(code);
  b.seasons[seasonKey] = {
    paidAt: meta.paidAt || new Date().toISOString(),
    amountCents: Number(meta.amountCents) || 0,
    currency: String(meta.currency || 'usd').toLowerCase(),
    stripeSession: meta.stripeSession ? String(meta.stripeSession).slice(0, 120) : null,
  };
  await kv.set(billingKey(code), b);
  return b;
}

export async function paidSeasons(code) {
  const b = await getTeamBilling(code);
  return Object.keys(b.seasons);
}

export async function hasPaidSeason(code, seasonKey) {
  if (!isSeasonKey(seasonKey)) return false;
  const b = await getTeamBilling(code);
  return !!b.seasons[seasonKey];
}

// The single source of truth for "can this team train right now?".
export async function isTeamActive(code, date) {
  const b = await getTeamBilling(code);
  if (b.free) return true;
  return !!b.seasons[currentSeasonKey(date)];
}

// A compact status object for the paywall / coach billing screen.
export async function billingStatus(code, date) {
  const b = await getTeamBilling(code);
  const season = currentSeasonKey(date);
  const active = b.free || !!b.seasons[season];
  return { free: b.free, currentSeason: season, active, paidSeasons: Object.keys(b.seasons) };
}
