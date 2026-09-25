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
 *   - renders a demo player picker so 'player' code sign-in can choose any NHLer,
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

  // --- Player picker: choose any NHLer after 'player' sign-in -----------------
  // Reuses bfPlayer as the active player (stored full name), exactly like the real
  // app. We store the DEMO id -> name so the app's first-name id resolves to it.
  function showPicker() {
    if (document.getElementById('demoPicker')) return;
    var wrap = document.createElement('div');
    wrap.id = 'demoPicker';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'Choose a demo player');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--bg,#0e1712);color:var(--text,#f4f7f5);overflow:auto;padding:24px 16px 40px';
    var grid = D.roster.map(function (p) {
      var pos = D.posLabel(p.pos, p.role);
      return "<button type='button' class='demopick' data-name='" + esc(p.name) + "' " +
        "style='display:flex;flex-direction:column;align-items:center;gap:8px;background:var(--card2,#182420);color:var(--text,#f4f7f5);border:1px solid var(--line,#2b3a34);border-radius:16px;padding:14px 10px;cursor:pointer;font:inherit'>" +
        "<img src='" + p.photo + "' alt='' style='width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:12px;background:var(--soft,#22302b)'>" +
        "<span style='font-weight:800'>" + esc(p.first) + " " + esc(p.last) + "</span>" +
        "<span style='font-size:13px;color:var(--muted,#9fb0a8)'>#" + p.num + " " + esc(pos) + "</span>" +
        "</button>";
    }).join('');
    wrap.innerHTML =
      "<div style='max-width:1100px;margin:0 auto'>" +
      "<h1 style='font-size:26px;margin:6px 0 4px'>Demo Team</h1>" +
      "<p style='color:var(--muted,#9fb0a8);margin:0 0 20px'>Pick a player to explore.</p>" +
      "<div style='display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px'>" + grid + "</div>" +
      "</div>";
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('.demopick');
      if (!b) return;
      var name = b.getAttribute('data-name') || '';
      try { localStorage.setItem('bfPlayer', name); } catch (err) {}
      wrap.parentNode && wrap.parentNode.removeChild(wrap);
      location.hash = '#home';
      location.reload();
    });
  }

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
    // If a demo login just asked for the picker, show it.
    if (sessionStorage.getItem('thwapDemoPick') === '1') {
      sessionStorage.removeItem('thwapDemoPick');
      showPicker();
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Expose the picker so the login handler can trigger it directly.
  D.showPicker = showPicker;
  D.seedBoard = seedBoard;
})();
