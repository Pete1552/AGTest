# Tranquil

A small collection of clean, **ad-free** games. No ads, no pop-ups, no nags — ever.
Built as zero-dependency, single-file web pages; no build step, no backend.

## Play it

Open `index.html` in any browser — desktop or phone. It's the home screen (hub); tap a
game to play. Add it to your Home Screen for a full-screen, app-like experience.

Live: https://pete1552.github.io/AGTest/

## Games

- **Blocks** (`blocks.html`) — drop pieces onto an 8×8 grid and clear full rows/columns.
  Endless + a daily challenge with streaks.
- **Bloom** (`bloom.html`) — flood the board to a single colour in as few moves as possible.
- **Ripple** (`ripple.html`) — a calm "lights out" style puzzle: tap to toggle a tile and
  its neighbours until every tile is calm.
- **Trace** (`trace.html`) — draw one continuous line through every cell exactly once.

All games share one design system (`shared.css`) and a collection-wide sound setting.

## Also in the repo: Container

`container.html` is a separate, more complex game — *Container*, a virtual shipping
economy (produce goods, resell rivals' production, win sealed-bid auctions; 2–5 players,
hotseat and/or AI). It's kept in the repo but **not yet linked from the hub** — it can be
folded into the collection later.

## Status

Early prototype — self-contained HTML files, built to validate the ideas quickly.

## Where this could go (money model)

"Free + no ads" earns nothing on its own, so the plan is one of the proven calm-friendly
models:

- **Sell the calm:** free to play, optional one-time "remove all nags" unlock.
- **One *optional* reward ad** (watch one only if you want a continue) — never forced.
- **Free web version for discovery → paid native app** (iOS/Android) later.
