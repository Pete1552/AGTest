/* Tranquil — shared high-score leaderboard.
   Works on-device by default. Fill in CFG (Supabase url + anon key) to go global.
   Supports an optional per-"round" scope (e.g. a daily puzzle id) so a day's
   scores can be ranked against only that day's puzzle. */
(function () {
  "use strict";

  // ==== Collection version (date code). Single source of truth — shown at the
  // bottom of every settings popup so you can tell at a glance whether a
  // device has picked up the latest deploy. Bump alongside the ?v= query on
  // the <script> tags so caches refetch this file. ====
  var VERSION = "2026-07-15.0";

  // ==== Daily Set mode ====
  // daily.html launches games as game.html?daily=YYYY-MM-DD&seed=N. Because
  // this script runs before every game's own code, swapping Math.random for a
  // seeded PRNG here makes every game's board/deal/scramble deterministic —
  // the same puzzle for every player — with no changes to the games.
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  var DAILY = (function () {
    try {
      var q = new URLSearchParams(window.location.search);
      var d = q.get("daily");
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
      var seed = (Number(q.get("seed")) || 1) >>> 0;
      Math.random = mulberry32(seed);
      return { date: d, seed: seed };
    } catch (e) { return null; }
  })();

  // ==== CONFIG: set these to enable the GLOBAL leaderboard (empty = on-device) ====
  var CFG = {
    url: "https://qgmfmalbcnqhyrshopgc.supabase.co",
    anonKey: "sb_publishable_jo_wttINAE90GQJVS7zovA_Yt958HKi"
  };
  function isGlobal() { return !!(CFG.url && CFG.anonKey); }

  // Shared formatter for games scored as "moves/swaps/pours over par" (0 =
  // matched the puzzle's own computed minimum) rather than a raw count, so
  // puzzle instances of different difficulty are comparable on one board.
  function fmtOverPar(v) { return v === 0 ? "Perfect" : "+" + v; }

  // Per-game rules: dir 'desc' = higher is better, 'asc' = lower is better.
  var GAMES = {
    blocks: { name: "Blocks", dir: "desc", fmt: function (v) { return String(v); } },
    bloom:  { name: "Bloom",  dir: "asc",  fmt: fmtOverPar },
    ripple: { name: "Ripple", dir: "asc",  fmt: function (v) { return v + " moves"; } },
    trace:  { name: "Trace",  dir: "asc",  fmt: function (v) { return v + "s"; } },
    fuse:   { name: "Fuse",   dir: "desc", fmt: function (v) { return String(v); } },
    blend:  { name: "Blend",  dir: "asc",  fmt: fmtOverPar },
    mix:    { name: "Mix",    dir: "desc", fmt: function (v) { return String(v); } },
    sort:   { name: "Sort",   dir: "asc",  fmt: fmtOverPar },
    tower:  { name: "Tower",  dir: "desc", fmt: function (v) { return String(v); } },
    defense:{ name: "Defense", dir: "desc", fmt: function (v) { return "Wave " + v; } },
    lantern:{ name: "Lantern", dir: "asc", fmt: function (v) { return v + "s"; } },
    breaker:{ name: "Breaker", dir: "desc", fmt: function (v) { return String(v); } },
    aegis:  { name: "Aegis",   dir: "desc", fmt: function (v) { return String(v); } },
    sweep:  { name: "Sweep",   dir: "asc",  fmt: function (v) { return v + "s"; } },
    nibble: { name: "Nibble",  dir: "desc", fmt: function (v) { return String(v); } },
    runway: { name: "Runway",  dir: "asc",  fmt: fmtOverPar },
    jigsaw: { name: "Jigsaw",  dir: "asc",  fmt: function (v) { return v + "s"; } },
    dodge:  { name: "Dodge",   dir: "desc", fmt: function (v) { return v + "s"; } },
    sudoku: { name: "Sudoku",  dir: "asc",  fmt: function (v) { return v + "s"; } },
    silt:   { name: "Silt",    dir: "desc", fmt: function (v) { return String(v); } },
    glean:  { name: "Glean",   dir: "desc", fmt: function (v) { return v + "%"; } },
    orbit:  { name: "Orbit",   dir: "desc", fmt: function (v) { return String(v); } },
    hamlet: { name: "Hamlet",  dir: "desc", fmt: function (v) { return v + " pts"; } },
    wardenii: { name: "Warden II", dir: "desc", fmt: function (v) { return Math.floor(v / 60) + ":" + String(v % 60).padStart(2, "0"); } },
    keystone: { name: "Keystone", dir: "desc", fmt: function (v) { return (v / 10).toFixed(1) + " m"; } },
    daily:  { name: "Daily Set", dir: "desc", fmt: function (v) { return v + " pts"; } }
  };
  var MAX = 10;

  function meta(id) { return GAMES[id] || { name: id, dir: "desc", fmt: String }; }
  function sortBest(id, arr) {
    var d = meta(id).dir;
    return arr.slice().sort(function (a, b) { return d === "asc" ? a.score - b.score : b.score - a.score; });
  }

  // ---- on-device backend ----
  function lkey(id, round) { return "tranquil_lb_" + id + (round ? "_" + round : ""); }
  function localTop(id, round) {
    try { return sortBest(id, JSON.parse(localStorage.getItem(lkey(id, round)) || "[]")).slice(0, MAX); }
    catch (e) { return []; }
  }
  function localSubmit(id, name, score, round) {
    var a = localTop(id, round); a.push({ name: name, score: score });
    a = sortBest(id, a).slice(0, MAX);
    localStorage.setItem(lkey(id, round), JSON.stringify(a));
    return Promise.resolve(a);
  }

  // ---- Supabase backend ----
  function headers() {
    return { apikey: CFG.anonKey, Authorization: "Bearer " + CFG.anonKey, "Content-Type": "application/json" };
  }
  function sbTop(id, round) {
    var order = meta(id).dir === "asc" ? "score.asc" : "score.desc";
    var url = CFG.url + "/rest/v1/scores?game=eq." + encodeURIComponent(id) +
      "&select=name,score&order=" + order + "&limit=" + MAX;
    if (round) url += "&round=eq." + encodeURIComponent(round);
    return fetch(url, { headers: headers() }).then(function (r) {
      if (!r.ok) throw new Error("read failed"); return r.json();
    });
  }
  function sbSubmit(id, name, score, round) {
    var row = { game: id, name: name, score: score };
    if (round) row.round = round;
    return fetch(CFG.url + "/rest/v1/scores", {
      method: "POST",
      headers: Object.assign({ Prefer: "return=minimal" }, headers()),
      body: JSON.stringify([row])
    }).then(function (r) { if (!r.ok) throw new Error("write failed"); });
  }

  // ---- Analytics: log every completed round (not just top-10 qualifiers) to a
  // separate, admin-only table. Best-effort — never blocks or breaks gameplay.
  //
  // Each device gets one random, anonymous id (a UUID, no personal info)
  // stored in localStorage, so the admin dashboard can tell "one person
  // played 50 times" apart from "50 different people played once" and
  // measure whether people come back on a later day. It carries nothing
  // identifying and is never used for anything besides that aggregate count.
  var DEVICE_KEY = "tranquil_device";
  function deviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (id) return id;
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
        : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
            var r = Math.random() * 16 | 0, v = c === "x" ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
      localStorage.setItem(DEVICE_KEY, id);
      return id;
    } catch (e) { return "unknown"; }
  }
  function logPlay(id, value, round) {
    if (!isGlobal()) return;
    try {
      var row = { game: id, value: value, device: deviceId() };
      if (round) row.round = round;
      fetch(CFG.url + "/rest/v1/plays", {
        method: "POST",
        headers: Object.assign({ Prefer: "return=minimal" }, headers()),
        body: JSON.stringify([row])
      }).catch(function () {});
    } catch (e) {}
  }

  function top(id, round) { return isGlobal() ? sbTop(id, round) : Promise.resolve(localTop(id, round)); }
  function submit(id, name, score, round) {
    return isGlobal() ? sbSubmit(id, name, score, round).then(function () { return top(id, round); })
                      : localSubmit(id, name, score, round);
  }
  function qualifies(id, score, list) {
    if (list.length < MAX) return true;
    var worst = list[list.length - 1].score;
    return meta(id).dir === "asc" ? score < worst : score > worst;
  }
  function indexOf(rows, name, score) {
    for (var i = 0; i < rows.length; i++) if (rows[i].name === name && rows[i].score === score) return i;
    return -1;
  }

  // ---- UI (self-injecting modal, styled by shared.css) ----
  var overlay, box;
  function ensureUI() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "modal-overlay"; overlay.id = "lb-overlay";
    box = document.createElement("div"); box.className = "modal";
    overlay.appendChild(box); document.body.appendChild(overlay);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) hide(); });
  }
  function show() { ensureUI(); overlay.classList.add("show"); }
  function hide() { if (overlay) overlay.classList.remove("show"); }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function boardHtml(id, rows, hi, resultHtml, roundLabel) {
    var m = meta(id), scope = isGlobal() ? "🌍 Global" : "On this device";
    if (roundLabel) scope += " · " + roundLabel;
    var h = resultHtml || "";
    h += '<h2>' + esc(m.name) + ' · High Scores</h2>';
    h += '<div class="lb-scope">' + esc(scope) + '</div><div class="lb-list">';
    if (!rows.length) h += '<div class="lb-empty">No scores yet — be the first!</div>';
    else rows.forEach(function (r, i) {
      h += '<div class="lb-row' + (i === hi ? ' me' : '') + '">' +
        '<span class="lb-rank">' + (i + 1) + '</span>' +
        '<span class="lb-name">' + esc(r.name || "—") + '</span>' +
        '<span class="lb-score">' + esc(m.fmt(r.score)) + '</span></div>';
    });
    h += '</div>';
    return h;
  }
  function buttonsHtml(hasAgain) {
    return (hasAgain ? '<button id="lb-again">Play again</button>' : '') +
      '<button id="lb-home" class="share">' + (DAILY ? "Back to Daily Set" : "Home") + '</button>' +
      '<button id="lb-close" class="ghost-btn">Close</button>';
  }
  function wire(onAgain) {
    var a = document.getElementById("lb-again");
    if (a) a.onclick = function () { hide(); if (onAgain) onAgain(); };
    // in Daily Set mode "Home" returns to the day's set, not the hub.
    // Leaving mid-run (e.g. peeking at the board mid-game) asks first.
    document.getElementById("lb-home").onclick = function () {
      var dest = DAILY ? "daily.html" : "index.html";
      if (interacted) confirmLeave(dest); else location.href = dest;
    };
    document.getElementById("lb-close").onclick = hide;
  }

  // ---- Leave-confirmation: a mis-tap on the back button shouldn't torch a
  // run in progress. Central and zero-per-game: any gameplay interaction
  // (a pointer/key event outside the topbar and modals) marks the run as
  // "in progress"; finishing a game clears it, so leaving a fresh board or
  // a finished game never nags. Games are recognised by their #restart
  // button — hub/daily/admin pages don't have one and are left alone. ----
  var interacted = false;
  function isGamePage() { return !!document.getElementById("restart"); }
  function outsideChrome(t) {
    return !(t && t.closest && t.closest(".topbar, .modal-overlay"));
  }
  document.addEventListener("pointerdown", function (e) { if (outsideChrome(e.target)) interacted = true; }, true);
  document.addEventListener("keydown", function (e) { if (outsideChrome(e.target)) interacted = true; }, true);

  function confirmLeave(dest) {
    show();
    box.innerHTML = '<h2>Leave the game?</h2><p>Your current run won’t be saved.</p>' +
      '<button id="lb-stay">Keep playing</button>' +
      '<button id="lb-leave" class="ghost-btn">Leave</button>';
    document.getElementById("lb-stay").onclick = hide;
    document.getElementById("lb-leave").onclick = function () { location.href = dest; };
  }
  (function wireBackLink() {
    if (!isGamePage()) return;
    var back = document.querySelector('.topbar .brand a[href="index.html"]');
    if (!back) return;
    if (DAILY) back.setAttribute("href", "daily.html"); // daily runs return to the set
    back.addEventListener("click", function (e) {
      if (!interacted) return; // nothing in progress — leave straight away
      e.preventDefault();
      confirmLeave(back.getAttribute("href"));
    });
  })();

  // Public: open the leaderboard for a game (from a 🏆 button). round/roundLabel optional.
  function open(id, round, roundLabel) {
    show();
    box.innerHTML = '<h2>' + esc(meta(id).name) + ' · High Scores</h2><div class="lb-loading">Loading…</div>';
    top(id, round).then(function (rows) {
      box.innerHTML = boardHtml(id, rows, -1, "", roundLabel) + buttonsHtml(false); wire(null);
    }).catch(function () {
      box.innerHTML = '<h2>High Scores</h2><p>Couldn’t load the leaderboard.</p>' + buttonsHtml(false); wire(null);
    });
  }

  // In Daily Set mode, keep the player's best result per game for the day so
  // daily.html can total it into points.
  function recordDailyResult(id, val) {
    try {
      var key = "tranquil_dailyset_" + DAILY.date;
      var rec = JSON.parse(localStorage.getItem(key) || "{}");
      var prev = rec[id];
      var better = prev == null || (meta(id).dir === "asc" ? val < prev : val > prev);
      if (better) { rec[id] = val; localStorage.setItem(key, JSON.stringify(rec)); }
    } catch (e) {}
  }

  // Public: end-of-game screen with result + name entry (if a high score) + board.
  function finish(opts) {
    interacted = false; // run is over — leaving no longer needs a confirmation
    var id = opts.game, val = opts.value, round = opts.round, roundLabel = opts.roundLabel;
    if (DAILY) {
      // rank daily-set runs against the day's per-game board, not the all-time one
      round = "d" + DAILY.date;
      roundLabel = "Daily Set";
      recordDailyResult(id, val);
    }
    logPlay(id, val, round);
    show();
    var result = '<h2>' + esc(opts.resultTitle || "Game over") + '</h2>' +
      '<div class="final">' + esc(meta(id).fmt(val)) + '</div>' +
      (opts.subtitle ? '<div class="final-sub">' + esc(opts.subtitle) + '</div>' : '');
    box.innerHTML = result + '<div class="lb-loading">Loading…</div>';

    top(id, round).then(function (rows) {
      if (qualifies(id, val, rows)) {
        var last = localStorage.getItem("tranquil_name") || "";
        box.innerHTML = result +
          '<div class="lb-new">🏆 New high score!</div>' +
          '<input id="lb-name" class="lb-input" maxlength="16" placeholder="Your name" value="' + esc(last) + '" />' +
          '<button id="lb-save">Save score</button>' +
          '<button id="lb-skip" class="ghost-btn">Skip</button>';
        var inp = document.getElementById("lb-name");
        try { inp.focus(); } catch (e) {}
        function save() {
          var name = ((inp.value || "").trim().slice(0, 16)) || "Anon";
          localStorage.setItem("tranquil_name", name);
          box.innerHTML = result + '<div class="lb-loading">Saving…</div>';
          submit(id, name, val, round).then(function (rows2) {
            box.innerHTML = boardHtml(id, rows2, indexOf(rows2, name, val), result, roundLabel) + buttonsHtml(!!opts.onPlayAgain);
            wire(opts.onPlayAgain);
          }).catch(function () {
            box.innerHTML = result + '<p>Couldn’t reach the global board.</p>' + buttonsHtml(!!opts.onPlayAgain);
            wire(opts.onPlayAgain);
          });
        }
        document.getElementById("lb-save").onclick = save;
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") save(); });
        document.getElementById("lb-skip").onclick = function () {
          box.innerHTML = boardHtml(id, rows, -1, result, roundLabel) + buttonsHtml(!!opts.onPlayAgain);
          wire(opts.onPlayAgain);
        };
      } else {
        box.innerHTML = boardHtml(id, rows, -1, result, roundLabel) + buttonsHtml(!!opts.onPlayAgain);
        wire(opts.onPlayAgain);
      }
    }).catch(function () {
      box.innerHTML = result + '<p>Leaderboard unavailable.</p>' + buttonsHtml(!!opts.onPlayAgain);
      wire(opts.onPlayAgain);
    });
  }

  // Stamp the version into any page that carries the placeholder (the
  // settings popups); this script is included after the modal markup.
  try {
    var vEl = document.getElementById("app-version");
    if (vEl) vEl.textContent = "v" + VERSION;
  } catch (e) {}

  window.LB = {
    version: VERSION,
    daily: DAILY,
    open: open,
    finish: finish,
    logPlay: logPlay,
    configure: function (c) { CFG.url = c.url || ""; CFG.anonKey = c.anonKey || ""; },
    isGlobal: isGlobal,
    getConfig: function () { return { url: CFG.url, anonKey: CFG.anonKey }; },
    gameList: function () {
      return Object.keys(GAMES).map(function (id) { return { id: id, name: GAMES[id].name, dir: GAMES[id].dir, fmt: GAMES[id].fmt }; });
    }
  };
})();
