/* Tranquil — shared high-score leaderboard.
   Works on-device by default. Fill in CFG (Supabase url + anon key) to go global.
   Supports an optional per-"round" scope (e.g. a daily puzzle id) so a day's
   scores can be ranked against only that day's puzzle. */
(function () {
  "use strict";

  // ==== CONFIG: set these to enable the GLOBAL leaderboard (empty = on-device) ====
  var CFG = {
    url: "https://qgmfmalbcnqhyrshopgc.supabase.co",
    anonKey: "sb_publishable_jo_wttINAE90GQJVS7zovA_Yt958HKi"
  };
  function isGlobal() { return !!(CFG.url && CFG.anonKey); }

  // Per-game rules: dir 'desc' = higher is better, 'asc' = lower is better.
  var GAMES = {
    blocks: { name: "Blocks", dir: "desc", fmt: function (v) { return String(v); } },
    bloom:  { name: "Bloom",  dir: "asc",  fmt: function (v) { return v + " moves"; } },
    ripple: { name: "Ripple", dir: "asc",  fmt: function (v) { return v + " moves"; } },
    trace:  { name: "Trace",  dir: "asc",  fmt: function (v) { return v + "s"; } },
    fuse:   { name: "Fuse",   dir: "desc", fmt: function (v) { return String(v); } },
    blend:  { name: "Blend",  dir: "asc",  fmt: function (v) { return v + " swaps"; } },
    mix:    { name: "Mix",    dir: "desc", fmt: function (v) { return String(v); } },
    sort:   { name: "Sort",   dir: "asc",  fmt: function (v) { return v + " pours"; } },
    tower:  { name: "Tower",  dir: "desc", fmt: function (v) { return String(v); } },
    defense:{ name: "Defense", dir: "desc", fmt: function (v) { return "Wave " + v; } }
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
      '<button id="lb-home" class="share">Home</button>' +
      '<button id="lb-close" class="ghost-btn">Close</button>';
  }
  function wire(onAgain) {
    var a = document.getElementById("lb-again");
    if (a) a.onclick = function () { hide(); if (onAgain) onAgain(); };
    document.getElementById("lb-home").onclick = function () { location.href = "index.html"; };
    document.getElementById("lb-close").onclick = hide;
  }

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

  // Public: end-of-game screen with result + name entry (if a high score) + board.
  function finish(opts) {
    var id = opts.game, val = opts.value, round = opts.round, roundLabel = opts.roundLabel;
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
          '<input id="lb-name" class="lb-input" maxlength="12" placeholder="Your name" value="' + esc(last) + '" />' +
          '<button id="lb-save">Save score</button>' +
          '<button id="lb-skip" class="ghost-btn">Skip</button>';
        var inp = document.getElementById("lb-name");
        try { inp.focus(); } catch (e) {}
        function save() {
          var name = ((inp.value || "").trim().slice(0, 12)) || "Anon";
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

  window.LB = {
    open: open,
    finish: finish,
    configure: function (c) { CFG.url = c.url || ""; CFG.anonKey = c.anonKey || ""; },
    isGlobal: isGlobal
  };
})();
