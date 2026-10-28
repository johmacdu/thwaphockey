// lib/team_players.js
//
// Player and team lookup for the PLAYER endpoints (api/done.js, api/board.js,
// api/push.js, api/photo/*, lib/look_api.js), across every team. Lives in lib/
// so it does not cost a Vercel function slot.
//
// It reuses the sign-in resolver (lib/signin_players.js) so every endpoint
// agrees with sign-in on who a player is and which team they are on:
//   - the 16 original Jr. Rangers 10U players in ROSTER always resolve to the
//     Rangers team, even with no teamMember record in the store;
//   - any other player must have a teamMember record AND be listed on that
//     team's members list.
//
// Rangers fallback: if the members store cannot be read (a Redis error), a
// ROSTER id still resolves to the Rangers team, so the original 16 keep working
// exactly as they did when every endpoint checked ROSTER directly.

import { ROSTER } from './store.js';
import { listMembers } from './teams_store.js';
import { resolveSigninPlayer, RANGERS_TEAM_CODE } from './signin_players.js';
import { verifySession, readSessionCookie } from './session_store.js';

export { RANGERS_TEAM_CODE };

const idNorm = (id) => String(id || '').trim().toLowerCase();
const codeNorm = (c) => String(c || '').trim().toUpperCase();
const ROSTER_IDS = ROSTER.map((p) => p.id);

function rosterFallback(pid) {
  const r = ROSTER.find((p) => p.id === pid);
  return r ? { id: r.id, name: r.name, number: r.number, teamCode: RANGERS_TEAM_CODE, numbers: [r.number] } : null;
}

// Resolve a player id on ANY team. Returns { id, name, number, teamCode } or
// null for an unknown player.
export async function resolvePlayer(playerId) {
  const pid = idNorm(playerId);
  if (!pid) return null;
  try {
    // A ROSTER id the sign-in resolver cannot place (for example a member
    // record pointing at a team whose members list does not include them)
    // still resolves to Rangers, exactly as the old ROSTER-only check accepted it.
    return (await resolveSigninPlayer(pid)) || rosterFallback(pid);
  } catch {
    return rosterFallback(pid);
  }
}

// True when the id is a known player on any team.
export async function isKnownPlayer(playerId) {
  return !!(await resolvePlayer(playerId));
}

// The player ids on one team, in board order. The Rangers team is the 16 ROSTER
// players first (same order as before), then any newer players the coach added
// to the Rangers members list. Any other team is its members list. Unknown team
// -> [].
export async function teamPlayerIds(teamCode) {
  const code = codeNorm(teamCode);
  if (!code) return [];
  let members = [];
  try {
    members = (await listMembers(code)).map(idNorm).filter(Boolean);
  } catch {
    members = [];
  }
  if (code === RANGERS_TEAM_CODE) {
    const extras = members.filter((id) => !ROSTER_IDS.includes(id));
    return Array.from(new Set([...ROSTER_IDS, ...extras]));
  }
  return Array.from(new Set(members));
}

// The team code a player is on, or '' when unknown.
export async function teamCodeFor(playerId) {
  const p = await resolvePlayer(playerId);
  return p ? p.teamCode : '';
}

// True when both ids are known players on the SAME team. Used to keep cheers
// and fires inside a team (no cross-team reactions).
export async function sameTeam(a, b) {
  const [pa, pb] = await Promise.all([resolvePlayer(a), resolvePlayer(b)]);
  return !!(pa && pb && pa.teamCode === pb.teamCode);
}

// Which team a team-wide read (leaderboard, teammate looks, recent givers) is
// scoped to. A signed-in player sees ONLY their own team. No session, or a
// session for a player no longer on any team, keeps the original public
// Jr. Rangers 10U view. Never mixes two teams. Returns { teamCode, ids }.
export async function teamForRequest(req) {
  const claims = verifySession(readSessionCookie(req));
  const me = claims && claims.playerId ? await resolvePlayer(claims.playerId) : null;
  const teamCode = me ? me.teamCode : RANGERS_TEAM_CODE;
  return { teamCode, ids: await teamPlayerIds(teamCode) };
}
