// api/store.js
//
// Data-store abstraction for Thwap Hockey.
//
// SWAP SEAM: This is the ONLY file that talks to the backing store (@vercel/kv).
// Every KV call lives here. To move to Supabase (or any other backend) later,
// reimplement getPlayer / setPlayer / listPlayers / bumpPlayer in this file
// against the new client and delete the `import { kv } ...` line. No other file
// (board.js, done.js, seed.js) references the store directly, so nothing else
// needs to change.
//
// Data model:
//   Key:   player:<id>            (id = lowercase first name, e.g. "lewie")
//   Value: { stick, shoot, dryland, streak, stickers, updatedAt }

import { kv } from '@vercel/kv';

// --- Roster: single source of truth (name + jersey number) -----------------
// id is the lowercase first name; number is used by done.js to derive the PIN.
export const ROSTER = [
  { id: 'alder',    name: 'Alder',    number: 71 },
  { id: 'brooklyn', name: 'Brooklyn', number: 92 },
  { id: 'dawson',   name: 'Dawson',   number: 19 },
  { id: 'dominic',  name: 'Dominic',  number: 98 },
  { id: 'eugene',   name: 'Eugene',   number: 3  },
  { id: 'evan',     name: 'Evan',     number: 13 },
  { id: 'greyson',  name: 'Greyson',  number: 32 },
  { id: 'johnny',   name: 'Johnny',   number: 1  },
  { id: 'joziah',   name: 'Joziah',   number: 59 },
  { id: 'lewie',    name: 'Lewie',    number: 72 },
  { id: 'liam',     name: 'Liam',     number: 29 },
  { id: 'maddux',   name: 'Maddux',   number: 18 },
  { id: 'oliver',   name: 'Oliver',   number: 90 },
  { id: 'teddy',    name: 'Teddy',    number: 11 },
  { id: 'william',  name: 'William',  number: 16 },
  { id: 'issac',    name: 'Issac',    number: 53 },
];

// Valid discipline counts that can be incremented via done.js.
export const DISCIPLINES = ['stick', 'shoot', 'dryland'];

// Shape of a freshly-seeded player (all counts zeroed).
function zeroCounts() {
  return { stick: 0, shoot: 0, dryland: 0, streak: 0, stickers: 0, updatedAt: null };
}

const keyFor = (id) => `player:${String(id).toLowerCase()}`;

// --- Store API --------------------------------------------------------------

// Read one player's counts. Returns null if the player has never been stored.
export async function getPlayer(id) {
  const data = await kv.get(keyFor(id));
  return data || null;
}

// Overwrite one player's counts with the given object.
export async function setPlayer(id, obj) {
  await kv.set(keyFor(id), obj);
  return obj;
}

// Return every player as [{ id, stick, shoot, dryland, streak, stickers, updatedAt }].
// Players missing from the store are returned zeroed so the board is always complete.
export async function listPlayers() {
  const ids = ROSTER.map((p) => p.id);
  const keys = ids.map(keyFor);
  // mget returns values in the same order as the keys; missing keys come back null.
  const values = await kv.mget(...keys);
  return ROSTER.map((p, i) => ({ id: p.id, ...(values[i] || zeroCounts()) }));
}

// Increment one discipline count for a player and stamp updatedAt.
// Creates the player (zeroed) if they don't exist yet. Returns the updated object.
export async function bumpPlayer(id, discipline) {
  const current = (await getPlayer(id)) || zeroCounts();
  const next = {
    ...zeroCounts(),          // guarantee all fields exist
    ...current,               // keep existing values
    updatedAt: new Date().toISOString(),
  };
  next[discipline] = (Number(next[discipline]) || 0) + 1;
  await setPlayer(id, next);
  return { id: String(id).toLowerCase(), ...next };
}
