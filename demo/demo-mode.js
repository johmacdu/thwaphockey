/* demo/demo-mode.js
 *
 * Runtime for the DEMO TEAM client-side mode. Loaded AFTER demo-data.js and after
 * the main index.html scripts. Does nothing unless window.THWAP_DEMO.isActive().
 *
 * When active it:
 *   - pre-populates window.thwapBoard with the demo tiered stats (so standings,
 *     the stats page, and the card back read demo numbers instead of /api/board),
 *   - rewrites the player home greeting, next-game card (vs USSR All-Time Team),
 *     and the "Rangers 10U" kickers to the Demo Team,
 *   - signs the 'player' code straight in as Mario Lemieux (no picker),
 *   - shows the demo roster on the Team page.
 *
 * It NEVER runs its overrides when demo mode is off, so the real Jr Rangers path
 * is unchanged. Sign out clears the demo flag (hooked below).
 */
(function () {
  'use strict';
  var D = window.THWAP_DEMO;
  if (!D) return;

  // --- Board: seed demo stats so every board reader sees demo numbers ---------
  // window.thwapBoard is the shared store the standings, stats page, and card
  // back all read. Seeding it (and marking ready) short-circuits the /api/board
  // fetch's effect for the demo, because the demo values are already present.
  function seedBoard() {
    window.thwapBoard = window.thwapBoard || { week: {}, all: {}, ready: false };
    window.thwapBoard.week = D.boardWeek();
    window.thwapBoard.all = D.boardAll();
    window.thwapBoard.ready = true;
    window.thwapBoard.demo = true;
    if (window.thwapStatsRefresh) { try { window.thwapStatsRefresh(); } catch (e) {} }
  }

  // --- Next game: rewrite the player home + coach next-game to vs USSR ---------
  function rewriteNextGame() {
    var g = D.nextGame();
    var pretty = fmtDate(g.date) + (g.time ? ', ' + fmt12(g.time) : '');
    // Player home card (#pNextGame is Game Day Goals; the opponent line lives in
    // the coach next-game). The player home shows the opponent via #pngOpp only on
    // the game-goals card, so we also set a lightweight next-game line if present.
    setText('pngFocusGoal', '');
    // Coach next-game block.
    var opp = document.querySelector('#chNextGame .o') || document.getElementById('chNextOpp');
    if (opp) opp.textContent = 'vs ' + D.OPPONENT;
    var meta = document.querySelector('#chNextGame .m') || document.getElementById('chNextMeta');
    if (meta) meta.textContent = pretty + ' at Home';
  }

  // --- Kickers: "Rangers 10U" -> "Demo Team" ----------------------------------
  function rewriteKickers() {
    document.querySelectorAll('.kicker').forEach(function (k) {
      var t = (k.textContent || '').trim();
      if (/Rangers/i.test(t)) {
        k.textContent = /,/.test(t) ? (D.TEAM_NAME + ', ' + D.roster.length + ' players') : D.TEAM_NAME;
      }
    });
  }

  // --- Player: 'player' sign-in goes straight to Mario Lemieux ----------------
  // The login handler sets bfPlayer to 'Mario Lemieux' directly, so there is no
  // picker. Kept minimal on purpose: a demo shows one strong player, not a chooser.

  // --- helpers ----------------------------------------------------------------
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function setText(id, t) { var el = document.getElementById(id); if (el) el.textContent = t; }
  function fmtDate(iso) {
    try {
      var p = iso.split('-'); var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
      return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
    } catch (e) { return iso; }
  }
  function fmt12(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || ''); if (!m) return hhmm;
    var h = +m[1], ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12; return h + ':' + m[2] + ap;
  }

  // --- boot -------------------------------------------------------------------
  function boot() {
    if (!D.isActive()) return;
    document.body.classList.add('is-demo');
    seedBoard();
    rewriteKickers();
    rewriteNextGame();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Expose seedBoard for the login handler.
  D.seedBoard = seedBoard;
})();
