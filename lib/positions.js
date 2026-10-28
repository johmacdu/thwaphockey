// lib/positions.js
//
// Is this player a goalie? Goalies train Net play where skaters train Shooting
// (disciplinesFor), on every team.
//
// Source of truth is the coach's roster position on the member record
// (teamMember:<id>.position, set by add-player / edit-player; the coach UI
// writes 'G' or 'goalie'). gamePosition is the player's own game-day pick and
// only takes 'F' | 'D' | 'B', so it never says goalie and is not read here.
//
// Fallback: when the record has no position (the 16 seeded Jr. Rangers have
// position ''), or the store cannot be read, the hand-kept GOALIE_IDS list in
// lib/store.js decides, so Johnny stays a goalie exactly as before.

import { getMember } from './teams_store.js';
import { GOALIE_IDS } from './store.js';
import { isGoaliePosition } from './drills.js';

const idNorm = (id) => String(id || '').trim().toLowerCase();

export async function isGoalie(playerId) {
  const pid = idNorm(playerId);
  if (!pid) return false;
  try {
    const m = await getMember(pid);
    const pos = m && typeof m.position === 'string' ? m.position.trim() : '';
    if (pos) return isGoaliePosition(pos);
  } catch {
    // store unreadable: fall through to the fixed list
  }
  return GOALIE_IDS.includes(pid);
}

// The three disciplines that count for this player: stick + dryland, plus
// netplay for a goalie or shoot for everyone else. Async twin of
// disciplinesFor() in lib/store.js that also reads the member store.
export async function disciplinesForPlayer(playerId) {
  return (await isGoalie(playerId)) ? ['stick', 'netplay', 'dryland'] : ['stick', 'shoot', 'dryland'];
}
