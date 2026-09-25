/* demo/demo-mode.js
 *
 * Runtime for the DEMO TEAM client-side mode. Loaded AFTER demo-data.js and after
 * the main index.html scripts. Does nothing unless window.THWAP_DEMO.isActive().
 *
 * When active it makes Demo Team a genuinely separate team everywhere the player
 * sees a team:
 *   - seeds window.thwapBoard (keyed by first-name slug) with the tiered stats, so
 *     the card BACK, the stats page, and standings read demo numbers,
 *   - seeds each NHLer photo as their card photo so the card FRONT shows the face
 *     everywhere the card renders (home, teammate view, sticker deck),
 *   - replaces the Team page roster grid with the 15 NHLers,
 *   - replaces the Standings leaderboard rows + team totals with demo data,
 *   - swaps the card front team label to Demo Team and the kickers/next-game,
 *   - exposes thwapDemoInfo so currentPlayer resolves demo num/pos/photo,
 *   - wraps openTeammateCard so tapping any NHLer opens their card with the right
 *     number, position, photo and stats.
 *
 * It NEVER runs its overrides when demo mode is off, so the real Jr Rangers path
 * is unchanged. Sign out clears the demo flag (hooked below).
 */
(function () {
  'use strict';
  var D = window.THWAP_DEMO;
  if (!D) return;

  /* Coach view: the coach home reads roster / schedule / team-coaches from
     /api/coach, which has no DEMO team. Intercept those GETs when demo is active
     and answer from THWAP_DEMO so the coach home shows the NHLers, the USSR next
     game, and Jack Adams in the coaches strip. The real coach path is untouched
     when demo is off. Only demo GET reads are shimmed; writes fall through. */
  (function installCoachFetchShim() {
    if (typeof window.fetch !== 'function') return;
    var realFetch = window.fetch.bind(window);
    function jsonResponse(obj) {
      return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    window.fetch = function (input, init) {
      try {
        if (D.isActive()) {
          var url = (typeof input === 'string') ? input : (input && input.url) || '';
          var method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
          if (method === 'GET' && url.indexOf('/api/coach') !== -1) {
            if (/action=roster/.test(url)) return Promise.resolve(jsonResponse(D.coachRoster()));
            if (/action=schedule/.test(url)) return Promise.resolve(jsonResponse(D.coachSchedule()));
            if (/action=team-coaches/.test(url)) return Promise.resolve(jsonResponse(D.coachCoaches()));
          }
        }
      } catch (e) {}
      return realFetch(input, init);
    };
  })();

  /* Resolve demo card facts for currentPlayer(). Read by index.html's
     currentPlayer via window.thwapDemoInfo (no-op off-demo). */
  window.thwapDemoInfo = function (name) {
    if (!D.isActive()) return null;
    return D.info(name);
  };

  /* Board: seed demo stats (keyed by first-name slug) so every board reader sees
     demo numbers. window.thwapBoard is the shared store the standings, stats page,
     and card back all read. */
  function seedBoard() {
    window.thwapBoard = window.thwapBoard || { week: {}, all: {}, ready: false };
    window.thwapBoard.week = D.boardWeek();
    window.thwapBoard.all = D.boardAll();
    window.thwapBoard.ready = true;
    window.thwapBoard.demo = true;
    if (window.thwapStatsRefresh) { try { window.thwapStatsRefresh(); } catch (e) {} }
    if (window.thwapCardBackRefresh) { try { window.thwapCardBackRefresh(); } catch (e) {} }
  }

  /* Photos: seed each NHLer's photo as their per-slug card photo so buildFront
     shows the face on the home card, teammate cards, and the sticker deck without
     any async fetch. Cleared on sign-out. */
  function seedPhotos() {
    try {
      D.roster.forEach(function (p) {
        localStorage.setItem('thwapCardPhoto:' + D.slugOf(p.first), p.photo);
      });
    } catch (e) {}
  }
  /* Also answer the async resolver buildFaces calls, so a card that renders before
     localStorage is read still upgrades to the right photo. */
  window.thwapPhotoResolve = function (slug, cb) {
    if (!D.isActive()) return;
    var p = D.bySlug(slug);
    if (p && typeof cb === 'function') cb(p.photo);
  };

  /* Team label on the card front + kickers. */
  function applyTeamLabel() {
    window.thwapTeamLabel = D.TEAM_NAME + '<br>All-Time';
  }
  function rewriteKickers() {
    document.querySelectorAll('.kicker').forEach(function (k) {
      var t = (k.textContent || '').trim();
      if (/Rangers/i.test(t)) {
        k.textContent = /,/.test(t) ? (D.TEAM_NAME + ', ' + D.roster.length + ' players') : D.TEAM_NAME;
      }
    });
  }

  /* Next game: rewrite the coach next-game block to vs USSR. */
  function rewriteNextGame() {
    var g = D.nextGame();
    var pretty = fmtDate(g.date) + (g.time ? ', ' + fmt12(g.time) : '');
    var opp = document.querySelector('#chNextGame .o') || document.getElementById('chNextOpp');
    if (opp) opp.textContent = 'vs ' + D.OPPONENT;
    var meta = document.querySelector('#chNextGame .m') || document.getElementById('chNextMeta');
    if (meta) meta.textContent = pretty + ' at Home';
  }

  /* Team page: replace the roster grid with the 15 NHLers. Each card taps to open
     that player's card (openTeammateCard), matching the real roster behavior. */
  function renderRoster() {
    var grid = document.getElementById('roster-grid');
    if (!grid) return;
    grid.innerHTML = D.roster.map(function (p) {
      return "<a href='#' class='pcard' data-name='" + esc(p.name) + "'>" +
        "<img class='pcard-cardart' src='" + esc(p.photo) + "' alt='" + esc(p.first) + "'>" +
        "</a>";
    }).join('');
    grid.querySelectorAll('.pcard[data-name]').forEach(function (card) {
      card.addEventListener('click', function (e) {
        e.preventDefault();
        var nm = card.getAttribute('data-name');
        var isCoach = document.body.classList.contains('is-coach');
        if (isCoach && window.openPlayerPage) { window.openPlayerPage(nm, 'team'); return; }
        if (window.openTeammateCard) window.openTeammateCard(nm);
      });
    });
  }

  /* Standings: render the leaderboard rows + team totals from demo data. The real
     board IIFE is closed, so we render #board directly and re-apply on nav. */
  function renderStandings() {
    var board = document.getElementById('board');
    if (!board) return;
    var me = '';
    try { me = (localStorage.getItem('bfPlayer') || '').trim().split(/\s+/)[0]; } catch (e) {}
    var rows = D.roster.map(function (p) { return { n: p.first, s: p.stick + p.shoot + p.dryland }; });
    rows.sort(function (a, b) { return b.s - a.s || a.n.localeCompare(b.n); });
    var max = rows.length ? Math.max(1, rows[0].s) : 1;
    board.innerHTML = rows.map(function (r, i) {
      var pct = Math.round(r.s / max * 100);
      var meCls = (r.n === me) ? ' me' : '';
      var youTag = (r.n === me) ? "<span class='row-you'>YOU</span>" : "";
      return "<button type='button' class='row" + meCls + "' data-player='" + esc(r.n) + "'><span>" + (i + 1) + "</span><strong>" + esc(r.n) + youTag + "</strong>" +
        "<div class='bar'><div class='fill' style='width:" + pct + "%'></div></div>" +
        "<span class='score'>" + r.s + "</span></button>";
    }).join('');
    board.querySelectorAll('.row[data-player]').forEach(function (rw) {
      rw.addEventListener('click', function () {
        if (window.openPlayerPage) window.openPlayerPage(rw.getAttribute('data-player'));
      });
    });
    // Team totals + the goal header -> Demo Team.
    var t = D.teamTotals();
    var totalMap = { all: t.all, stick: t.stick, shoot: t.shoot, dryland: t.dryland };
    ['all', 'stick', 'shoot', 'dryland'].forEach(function (k) {
      var el = document.querySelector(".metric-num[data-total='" + k + "']");
      if (el) { el.textContent = totalMap[k]; el.setAttribute('data-cv', String(totalMap[k])); }
    });
    var lab = document.getElementById('lbGoalLab');
    var big = document.getElementById('lbGoalBig');
    var row = document.getElementById('lbGoalRow');
    var info = document.getElementById('lbInfo');
    if (lab && lab.childNodes[0]) lab.childNodes[0].nodeValue = D.TEAM_NAME + ' all time ';
    if (big) big.innerHTML = "<span>" + t.all.toLocaleString() + "</span><small> workouts and counting</small>";
    if (row) row.style.display = 'none';
    if (info) info.style.display = 'none';
  }

  /* helpers */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
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

  /* Apply everything for the current page, and re-apply on navigation because the
     roster grid and standings are re-read/re-rendered when their page shows. */
  function applyAll() {
    if (!D.isActive()) return;
    seedBoard();
    applyTeamLabel();
    rewriteKickers();
    rewriteNextGame();
    renderRoster();
    renderStandings();
  }

  function boot() {
    if (!D.isActive()) return;
    document.body.classList.add('is-demo');
    seedPhotos();
    applyTeamLabel();
    applyAll();
    // Re-apply when the Team or Standings page is shown (they own their own DOM).
    window.addEventListener('hashchange', function () {
      if (!D.isActive()) return;
      var h = location.hash;
      seedBoard();
      applyTeamLabel();
      if (h === '#roster') { renderRoster(); rewriteKickers(); }
      if (h === '#progress') { setTimeout(renderStandings, 0); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // Expose for the login handler (called right after activate()).
  D.seedBoard = seedBoard;
  D.applyAll = applyAll;
  D.seedPhotos = seedPhotos;
})();
