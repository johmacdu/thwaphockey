// lib/season_book.js
//
// One player's Season Book: the path (journeyFor) and the badges (badgesFor),
// read from the store with the same inputs everywhere. /api/board?action=journey
// (journey.html) and /api/done?view=season (the watch) both call this, so the
// two can never count badges differently.

import { getTrainingDays, getDrillEvents, getCheersSent, localDateStr } from './store.js';
import { journeyFor, badgesFor } from './journey.js';
import { isGoalie } from './positions.js';

export async function seasonBookFor(playerId, today = localDateStr()) {
  const id = String(playerId || '').toLowerCase();
  const [days, events, cheersSent, goalie] = await Promise.all([
    getTrainingDays(id), getDrillEvents(id), getCheersSent(id), isGoalie(id),
  ]);
  return {
    book: journeyFor(days, today),
    // Goalie by roster position (member store), GOALIE_IDS only as fallback.
    badges: badgesFor({ events, days, cheersSent, goalie }, today),
  };
}
