/* demo/demo-data.js
 *
 * Self-contained DEMO TEAM data + client-side mode for Thwap Hockey.
 *
 * WHY THIS IS ISOLATED: the real Jr Rangers app (index.html + lib/store.js) keys
 * player identity by first name in ONE global roster, with global stats and PINs.
 * A second real team of 15 NHLers would collide (three wear #9; PIN = number+year).
 * So the demo is a CLIENT-SIDE mode gated by the login team dropdown: when the
 * demo team is chosen with the demo codes, window.THWAP_DEMO.active becomes true
 * and the app reads its roster / stats / next-game / card fields from THIS file
 * instead of the backend. When demo mode is OFF, nothing here runs and the real
 * team path is byte-for-byte unchanged.
 *
 * Auth (demo only, no OTP): email hi@woodymacduffie.com
 *   code 'player' -> pick any NHLer to view
 *   code 'coach'  -> demo coach view
 *
 * Player id space is namespaced 'demo-<lastname>' so it can never collide with a
 * real player:<id>. Stats are fixed training totals (stick/shoot/dryland + streak)
 * that drive standings, tiered exactly as specified:
 *   Mario 1st, Wayne 2nd, then 5 tied 3rd, 2 4th, 3 5th, 2 6th, 1 7th.
 */
(function () {
  'use strict';

  var DEMO_EMAIL = 'hi@woodymacduffie.com';
  var DEMO_TEAM_VALUE = 'demo-team';           // <option value> in the login select
  var DEMO_TEAM_NAME = 'Demo Team';
  var DEMO_NEXT_OPPONENT = 'USSR All-Time Team';

  // Tier totals, descending by rank. tier is for grouping only; stats drive standings.
  var TIER = {
    1: { stick: 52, shoot: 48, dryland: 44, streak: 21 },
    2: { stick: 47, shoot: 44, dryland: 40, streak: 18 },
    3: { stick: 38, shoot: 35, dryland: 32, streak: 12 },
    4: { stick: 30, shoot: 28, dryland: 25, streak: 9 },
    5: { stick: 23, shoot: 21, dryland: 19, streak: 6 },
    6: { stick: 15, shoot: 13, dryland: 12, streak: 3 },
    7: { stick: 8, shoot: 7, dryland: 6, streak: 1 },
  };

  // Roster in the order the user listed. position: F (forward incl. C/LW/RW) | D | G.
  // The card face shows a granular label (Center / Right Wing / ...) via posLabel.
  var ROSTER = [
    { id: 'demo-gretzky',  first: 'Wayne',   last: 'Gretzky',   num: 99, pos: 'F', role: 'Center',      tier: 2, photo: 'demo/players/01_gretzky.png' },
    { id: 'demo-lemieux',  first: 'Mario',   last: 'Lemieux',   num: 66, pos: 'F', role: 'Center',      tier: 1, photo: 'demo/players/02_lemieux.png' },
    { id: 'demo-crosby',   first: 'Sidney',  last: 'Crosby',    num: 87, pos: 'F', role: 'Center',      tier: 3, photo: 'demo/players/03_crosby.png' },
    { id: 'demo-howe',     first: 'Gordie',  last: 'Howe',      num: 9,  pos: 'F', role: 'Right Wing',  tier: 3, photo: 'demo/players/04_howe.png' },
    { id: 'demo-richard',  first: 'Maurice', last: 'Richard',   num: 9,  pos: 'F', role: 'Right Wing',  tier: 6, photo: 'demo/players/05_richard.png' },
    { id: 'demo-bossy',    first: 'Mike',    last: 'Bossy',     num: 22, pos: 'F', role: 'Right Wing',  tier: 5, photo: 'demo/players/06_bossy.png' },
    { id: 'demo-hull',     first: 'Bobby',   last: 'Hull',      num: 9,  pos: 'F', role: 'Left Wing',   tier: 5, photo: 'demo/players/07_hull.png' },
    { id: 'demo-ovechkin', first: 'Alex',    last: 'Ovechkin',  num: 8,  pos: 'F', role: 'Left Wing',   tier: 3, photo: 'demo/players/08_ovechkin.png' },
    { id: 'demo-lindsay',  first: 'Ted',     last: 'Lindsay',   num: 7,  pos: 'F', role: 'Left Wing',   tier: 6, photo: 'demo/players/09_lindsay.png' },
    { id: 'demo-orr',      first: 'Bobby',   last: 'Orr',       num: 4,  pos: 'D', role: 'Defense',     tier: 3, photo: 'demo/players/10_orr.png' },
    { id: 'demo-lidstrom', first: 'Nicklas', last: 'Lidstrom',  num: 5,  pos: 'D', role: 'Defense',     tier: 4, photo: 'demo/players/11_lidstrom.png' },
    { id: 'demo-bourque',  first: 'Ray',     last: 'Bourque',   num: 77, pos: 'D', role: 'Defense',     tier: 3, photo: 'demo/players/12_bourque.png' },
    { id: 'demo-harvey',   first: 'Doug',    last: 'Harvey',    num: 2,  pos: 'D', role: 'Defense',     tier: 7, photo: 'demo/players/13_harvey.png' },
    { id: 'demo-hasek',    first: 'Dominik', last: 'Hasek',     num: 39, pos: 'G', role: 'Goalie',      tier: 4, photo: 'demo/players/14_hasek.png' },
    { id: 'demo-roy',      first: 'Patrick', last: 'Roy',       num: 33, pos: 'G', role: 'Goalie',      tier: 5, photo: 'demo/players/15_roy.png' },
  ];

  // Attach the tier totals to each player.
  ROSTER.forEach(function (p) {
    var t = TIER[p.tier] || TIER[7];
    p.stick = t.stick; p.shoot = t.shoot; p.dryland = t.dryland; p.streak = t.streak;
    p.total = p.stick + p.shoot + p.dryland;
    p.name = p.first + ' ' + p.last;
  });

  function byId(id) {
    id = String(id || '').toLowerCase();
    for (var i = 0; i < ROSTER.length; i++) if (ROSTER[i].id === id) return ROSTER[i];
    return null;
  }

  // Board maps keyed by demo player id, matching window.thwapBoard shape:
  //   week: { <id>: {stick,shoot,dryland} }   all: { <id>: {stick,shoot,dryland,streak} }
  function boardWeek() {
    var m = {};
    ROSTER.forEach(function (p) { m[p.id] = { stick: p.stick, shoot: p.shoot, dryland: p.dryland }; });
    return m;
  }
  function boardAll() {
    var m = {};
    ROSTER.forEach(function (p) { m[p.id] = { stick: p.stick, shoot: p.shoot, dryland: p.dryland, streak: p.streak }; });
    return m;
  }

  // Next game vs the USSR All-Time Team (a couple of days out from "now").
  function nextGame() {
    var d = new Date(); d.setDate(d.getDate() + 2);
    var iso = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    return { kind: 'game', date: iso, time: '13:00', home: true, opponent: DEMO_NEXT_OPPONENT, place: 'Home' };
  }

  function posLabel(pos, role) {
    if (role) return role;
    return pos === 'G' ? 'Goalie' : pos === 'D' ? 'Defense' : 'Forward';
  }

  // Is the demo team currently selected + authed? Stored in localStorage so it
  // survives the reload the app does after sign-in, exactly like bfPlayer.
  function isActive() {
    try { return localStorage.getItem('thwapDemo') === '1'; } catch (e) { return false; }
  }
  function activate() { try { localStorage.setItem('thwapDemo', '1'); } catch (e) {} }
  function deactivate() { try { localStorage.removeItem('thwapDemo'); } catch (e) {} }

  // Login result for the demo team, or null if the inputs are not the demo combo.
  // email must match, team must be the demo option, code is 'player' or 'coach'.
  function login(team, email, code) {
    if (String(team || '') !== DEMO_TEAM_VALUE) return null;
    if (String(email || '').trim().toLowerCase() !== DEMO_EMAIL) return { error: 'For the demo, sign in with ' + DEMO_EMAIL + '.' };
    var c = String(code || '').trim().toLowerCase();
    if (c === 'player') return { role: 'player' };
    if (c === 'coach') return { role: 'coach' };
    return { error: "Demo code is 'player' or 'coach'." };
  }

  window.THWAP_DEMO = {
    EMAIL: DEMO_EMAIL,
    TEAM_VALUE: DEMO_TEAM_VALUE,
    TEAM_NAME: DEMO_TEAM_NAME,
    OPPONENT: DEMO_NEXT_OPPONENT,
    roster: ROSTER,
    byId: byId,
    boardWeek: boardWeek,
    boardAll: boardAll,
    nextGame: nextGame,
    posLabel: posLabel,
    isActive: isActive,
    activate: activate,
    deactivate: deactivate,
    login: login,
    get active() { return isActive(); },
  };
})();
