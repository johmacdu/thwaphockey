// lib/signin_players.js
//
// Player lookup for SIGN-IN (api/login.js), across every team. Lives in lib/ so
// it does not cost a Vercel function slot.
//
// Source of truth is the multi-team members store in lib/teams_store.js:
//   teamMember:<playerId>  { teamCode, firstName, number, ... }
//   team:<code>:members    [playerId, ...]
// Player ids are globally unique (addMember never reuses an id that already has
// a teamMember record), so a playerId alone identifies one player. A team code,
// when the caller sends one, must match that player's team.
//
// Jr. Rangers 10U fallback: the 16 original players in ROSTER (lib/store.js)
// always resolve to the seed team, with the jersey number from ROSTER, even when
// their teamMember record is missing or was never seeded. That keeps their
// existing sign-in codes working exactly as before. If the coach has since
// renumbered one of them in the members store, the new number is accepted too.

import { ROSTER } from './store.js';
import { getMember, listMembers } from './teams_store.js';

export const RANGERS_TEAM_CODE = 'RANGERS72';
export const RANGERS_TEAM_NAME = 'Jr Rangers 10U';

const codeNorm = (c) => String(c || '').trim().toUpperCase();
const idNorm = (id) => String(id || '').trim().toLowerCase();
const numOrNull = (n) => (n == null || n === '' || Number.isNaN(Number(n)) ? null : Number(n));

// Resolve a sign-in player. Returns
//   { id, name, number, teamCode, numbers:[accepted jersey numbers] }
// or null when the player is unknown (or not on the requested team).
export async function resolveSigninPlayer(playerId, teamCode) {
  const pid = idNorm(playerId);
  if (!pid) return null;
  const wantTeam = teamCode ? codeNorm(teamCode) : '';

  const member = await getMember(pid);
  const memberTeam = member && member.teamCode ? codeNorm(member.teamCode) : '';
  const rosterEntry = ROSTER.find((p) => p.id === pid) || null;

  let out = null;
  if (rosterEntry && (!memberTeam || memberTeam === RANGERS_TEAM_CODE)) {
    // Original Rangers player: ROSTER number always works, plus any newer number
    // the coach saved on the member record.
    const numbers = [rosterEntry.number];
    const mNum = member ? numOrNull(member.number) : null;
    if (mNum != null && !numbers.includes(mNum)) numbers.push(mNum);
    out = { id: pid, name: rosterEntry.name, number: rosterEntry.number, teamCode: RANGERS_TEAM_CODE, numbers };
  } else if (member && memberTeam) {
    // Any other team: the player must still be listed on that team.
    const ids = await listMembers(memberTeam);
    if (!ids.map(idNorm).includes(pid)) return null;
    const number = numOrNull(member.number);
    out = {
      id: pid,
      name: String(member.firstName || '').trim() || pid,
      number,
      teamCode: memberTeam,
      numbers: number == null ? [] : [number],
    };
  }
  if (!out) return null;
  if (wantTeam && wantTeam !== out.teamCode) return null;
  return out;
}

// The ONE way a sign-in code is checked: the jersey number followed by a
// season year (both the current and prior season are accepted). Shared by
// api/login.js code-signin, watch-request and findPlayerByTeamCode below.
export const CODE_SEASONS = ['2026', '2027'];
export function codeMatches(player, code) {
  const c = String(code == null ? '' : code).trim();
  if (!player || !c) return false;
  return (player.numbers || []).some((n) => CODE_SEASONS.some((y) => c === `${n}${y}`));
}

// Find the ONE player on a team whose sign-in code matches (the watch sign-in:
// team code + jersey code, no player id). Returns the resolved player, or null
// when the team is unknown, nobody matches, or MORE THAN ONE player matches
// (two kids wearing the same number on one team). Ambiguity is never resolved by
// picking one: the caller answers 401 exactly as for a wrong code.
// The Rangers seed team is the 16 ROSTER players plus any newer members.
export async function findPlayerByTeamCode(teamCode, code) {
  const team = codeNorm(teamCode);
  const c = String(code == null ? '' : code).trim();
  if (!team || !/^\d{5,8}$/.test(c)) return null;
  let ids = [];
  try {
    ids = (await listMembers(team)).map(idNorm).filter(Boolean);
  } catch {
    ids = [];
  }
  if (team === RANGERS_TEAM_CODE) ids = [...ROSTER.map((p) => p.id), ...ids];
  const seen = new Set();
  let hit = null;
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = await resolveSigninPlayer(id, team);
    if (!codeMatches(p, c)) continue;
    if (hit) return null; // ambiguous
    hit = p;
  }
  return hit;
}
