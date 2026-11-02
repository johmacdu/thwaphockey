// lib/coach_auth.js
//
// Coach session checks shared by api/coach.js and api/board.js. A coach token is
// an ordinary signed session whose playerId is `coach:<hex email>` (see
// mintCoachToken in api/coach.js). Lives in lib/ so it costs no function slot.

import { verifySession } from './session_store.js';
import { getTeam, listTeamCoaches } from './teams_store.js';

function hexDecode(s) { return Buffer.from(String(s), 'hex').toString('utf8'); }

// { email } for a valid coach token, else null.
export function coachFromToken(token) {
  const claims = verifySession(token);
  if (!claims || !String(claims.playerId || '').startsWith('coach:')) return null;
  try { return { email: hexDecode(String(claims.playerId).slice('coach:'.length)) }; }
  catch { return null; }
}

// Does this coach run this team? Head or assistant on the team's coach list, the
// team's own coachEmail, or the team in the coach's own record. Being *a* coach
// is not enough: anyone can register as one.
export async function coachRunsTeam(coach, code) {
  const c = String(code || '').trim().toUpperCase();
  const email = String(coach && coach.email || '').toLowerCase();
  if (!c || !email) return false;
  const team = await getTeam(c);
  if (!team) return false;
  if (String(team.coachEmail || '').toLowerCase() === email) return true;
  if ((coach.teams || []).map((t) => String(t).toUpperCase()).includes(c)) return true;
  const coaches = await listTeamCoaches(c);
  return coaches.some((x) => String(x.email || '').toLowerCase() === email);
}
