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
import {
  currentSeasonKey,
  isSeasonKey,
  buyableSeasons,
  labelForKey,
  priceCentsForKey,
} from './seasons.js';

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

// Enforcement is OFF until BILLING_ENFORCED=1 in the env, so the paywall is dead
// code until billing is actually live. Everything fails open otherwise.
export function billingEnforced() {
  return process.env.BILLING_ENFORCED === '1';
}

// True only when enforcement is on AND the team is not active. Server guards and
// the client paywall both key off this, so an unconfigured/disabled billing
// system never locks anyone out.
export async function isGated(code, date) {
  if (!billingEnforced()) return false;
  return !(await isTeamActive(code, date));
}

// A compact status object for the paywall / coach billing screen.
export async function billingStatus(code, date) {
  const b = await getTeamBilling(code);
  const season = currentSeasonKey(date);
  const active = b.free || !!b.seasons[season];
  const enforced = billingEnforced();
  return {
    free: b.free,
    currentSeason: season,
    active,
    enforced,
    gated: enforced && !active,
    paidSeasons: Object.keys(b.seasons),
  };
}

// Richer view for the coach billing screen: what the team has already paid for
// (with receipts), and the seasons it can buy now (current + a few ahead). A
// season already paid for is dropped from the buy list. Stripe emails a receipt
// on every payment, so we surface the amount/date here and link out to Stripe
// rather than generating our own receipt files.
export async function billingScreen(code, date) {
  const b = await getTeamBilling(code);
  const season = currentSeasonKey(date);

  const paid = Object.keys(b.seasons)
    .filter(isSeasonKey)
    .sort()
    .map((key) => {
      const rec = b.seasons[key] || {};
      const src = String(rec.stripeSession || '');
      return {
        key,
        label: labelForKey(key),
        paidAt: rec.paidAt || null,
        amountCents: Number(rec.amountCents) || 0,
        comp: /^comp:/.test(src),
        current: key === season,
      };
    });

  const buyable = buyableSeasons(date)
    .filter((key) => !b.seasons[key])
    .map((key) => ({
      key,
      label: labelForKey(key),
      priceCents: priceCentsForKey(key),
      current: key === season,
    }));

  return {
    free: b.free,
    enforced: billingEnforced(),
    currentSeason: season,
    active: b.free || !!b.seasons[season],
    paid,
    buyable,
  };
}
