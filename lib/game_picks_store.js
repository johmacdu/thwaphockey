// lib/game_picks_store.js
//
// Store seam for a player's GAME DAY GOALS PICKS (the goals they chose on
// hockey_game_goals.html). Lives in lib/ so it does not cost a Vercel function
// slot. Before this, picks lived only in the browser (localStorage
// thwapGameGoals), so another device or the watch could not see them.
//
// Data model (Upstash Redis):
//   gamePicks:<playerId>  { [gameId]: { goalIds:['g1','g7'], savedAt:ISO } }
//                         Capped to the most recent GAME_PICKS_CAP games.
//
// An empty goalIds list is a real save (the player cleared their picks), kept
// so a cleared plan does not come back from an older device.

import { Redis } from '@upstash/redis';

const kv = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

export const GAME_PICKS_CAP = 12;

const idNorm = (id) => String(id || '').trim().toLowerCase();
const picksKey = (pid) => `gamePicks:${idNorm(pid)}`;

function asObject(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); if (p && typeof p === 'object' && !Array.isArray(p)) return p; } catch { /* fall through */ }
  }
  return {};
}

// Every saved pick for a player, keyed by game id.
export async function getGamePicks(playerId) {
  if (!idNorm(playerId)) return {};
  return asObject(await kv.get(picksKey(playerId)));
}

// The pick for one game, or null when the player never saved one.
export async function getGamePick(playerId, gameId) {
  const all = await getGamePicks(playerId);
  const rec = all[String(gameId || '')];
  if (!rec || !Array.isArray(rec.goalIds)) return null;
  return { gameId: String(gameId), goalIds: rec.goalIds.slice(), savedAt: rec.savedAt || null };
}

// Save (replace) the pick for one game. goalIds must already be validated.
export async function setGamePick(playerId, gameId, goalIds, now = new Date()) {
  const gid = String(gameId || '');
  const all = await getGamePicks(playerId);
  all[gid] = { goalIds: goalIds.slice(), savedAt: now.toISOString() };
  // Keep only the newest GAME_PICKS_CAP games.
  const keys = Object.keys(all).sort((a, b) => String(all[b].savedAt || '').localeCompare(String(all[a].savedAt || '')));
  const kept = {};
  for (const k of keys.slice(0, GAME_PICKS_CAP)) kept[k] = all[k];
  await kv.set(picksKey(playerId), kept);
  return { gameId: gid, goalIds: kept[gid].goalIds.slice(), savedAt: kept[gid].savedAt };
}

export const _keys = { picksKey };
