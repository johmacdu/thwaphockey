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
import { getTeam, getMember, listMembers } from './teams_store.js';

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

// Public player list for a team's name picker (the watch). First name and
// jersey number only: no last names, emails or photos. Returns null for an
// unknown team. The Rangers seed team falls back to ROSTER when its team record
// has not been written to the store yet.
export async function listTeamPlayersPublic(teamCode) {
  const code = codeNorm(teamCode);
  if (!code) return null;
  const team = await getTeam(code);
  if (!team) {
    if (code !== RANGERS_TEAM_CODE) return null;
    return {
      team: { name: RANGERS_TEAM_NAME },
      players: ROSTER.map((p) => ({ id: p.id, firstName: p.name, number: p.number })),
    };
  }
  const ids = await listMembers(code);
  const players = [];
  for (const raw of ids) {
    const id = idNorm(raw);
    const m = await getMember(id);
    if (!m) continue;
    const r = ROSTER.find((p) => p.id === id);
    const firstName = String(m.firstName || '').trim() || (r ? r.name : id);
    const number = numOrNull(m.number) != null ? numOrNull(m.number) : (r ? r.number : null);
    players.push({ id, firstName, number });
  }
  return { team: { name: String(team.name || code) }, players };
}
