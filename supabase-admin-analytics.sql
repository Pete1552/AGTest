-- Tranquil — admin analytics setup.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query -> Run).
-- Reference copy only; not executed automatically by the app. This file reflects
-- the full current end-state — if you're adding to an existing setup, use the
-- incremental snippet your assistant gave you instead of re-running all of this.

-- 1. Table logging every completed round (not just top-10 leaderboard scores).
create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  game text not null,
  value numeric not null,
  round text,
  device text,      -- random anonymous per-device id (no personal info), used
                     -- only to tell "one person played 50 times" apart from
                     -- "50 different people played once" and to measure whether
                     -- people come back on a later day
  created_at timestamptz not null default now()
);
alter table public.plays enable row level security;

-- Anyone (including anonymous players) can log a completed play.
-- Deliberately NO select policy — the raw table can't be read via the API at
-- all, not even with the public anon key. Reads only happen through the
-- admin-only functions below.
create policy "public insert" on public.plays
  for insert with check (char_length(game) between 1 and 20 and value is not null);

create index if not exists plays_device on public.plays (device);
create index if not exists plays_game_created on public.plays (game, created_at);

-- 2. Aggregate summary per game: plays, average, median, typical spread
-- (p10/p90), last-played recency, and audience size (unique devices +
-- how many came back on a different day).
drop function if exists public.admin_play_summary();
create function public.admin_play_summary()
returns table(
  game text, plays bigint, avg_value numeric, median_value numeric,
  p10_value numeric, p90_value numeric, min_value numeric, max_value numeric,
  last_played timestamptz, unique_devices bigint, returning_devices bigint
)
language sql
security definer
set search_path = public
as $$
  with per_device_days as (
    select game, device, count(distinct created_at::date) as days
    from public.plays
    where device is not null
    group by game, device
  )
  select
    p.game,
    count(*) as plays,
    round(avg(p.value)::numeric, 1) as avg_value,
    percentile_cont(0.5) within group (order by p.value) as median_value,
    percentile_cont(0.1) within group (order by p.value) as p10_value,
    percentile_cont(0.9) within group (order by p.value) as p90_value,
    min(p.value) as min_value,
    max(p.value) as max_value,
    max(p.created_at) as last_played,
    (select count(*) from per_device_days d where d.game = p.game) as unique_devices,
    (select count(*) from per_device_days d where d.game = p.game and d.days >= 2) as returning_devices
  from public.plays p
  group by p.game
  order by plays desc;
$$;

-- 3. Equal-width histogram of outcome values for one game — this is what
-- surfaces "players always end at wave 22" style difficulty walls.
create or replace function public.admin_play_histogram(p_game text, p_buckets int default 12)
returns table(bucket int, range_low numeric, range_high numeric, cnt bigint)
language sql
security definer
set search_path = public
as $$
  with bounds as (
    select min(value) as lo, max(value) as hi from public.plays where game = p_game
  ),
  bucketed as (
    select width_bucket(p.value, b.lo, b.hi + 0.0001, p_buckets) as bucket
    from public.plays p, bounds b
    where p.game = p_game
  )
  select bucket,
         b.lo + (bucket - 1) * (b.hi - b.lo + 0.0001) / p_buckets as range_low,
         b.lo + bucket * (b.hi - b.lo + 0.0001) / p_buckets as range_high,
         count(*) as cnt
  from bucketed, bounds b
  group by bucket, b.lo, b.hi
  order by bucket;
$$;

-- 4. Plays-per-day trend for one game over the last N days (zero-filled, so
-- quiet days show as an explicit 0 rather than a missing row).
create or replace function public.admin_play_trend(p_game text, p_days int default 14)
returns table(day date, cnt bigint)
language sql
security definer
set search_path = public
as $$
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, interval '1 day')::date as day
  )
  select d.day, count(p.*) as cnt
  from days d
  left join public.plays p on p.game = p_game and p.created_at::date = d.day
  group by d.day
  order by d.day;
$$;

-- 5. Overall (cross-game) retention snapshot: of everyone who's ever played
-- anything, how many showed up on more than one distinct calendar day.
create or replace function public.admin_retention()
returns table(unique_devices bigint, returning_devices bigint, retention_pct numeric)
language sql
security definer
set search_path = public
as $$
  with per_device_days as (
    select device, count(distinct created_at::date) as days
    from public.plays
    where device is not null
    group by device
  )
  select
    count(*) as unique_devices,
    count(*) filter (where days >= 2) as returning_devices,
    round(100.0 * count(*) filter (where days >= 2) / nullif(count(*), 0), 1) as retention_pct
  from per_device_days;
$$;

-- 6. Lock everything to logged-in admins only — anonymous players (and
-- anyone who only has the public anon key) cannot call these.
revoke execute on function public.admin_play_summary() from public, anon;
grant execute on function public.admin_play_summary() to authenticated;
revoke execute on function public.admin_play_histogram(text, int) from public, anon;
grant execute on function public.admin_play_histogram(text, int) to authenticated;
revoke execute on function public.admin_play_trend(text, int) from public, anon;
grant execute on function public.admin_play_trend(text, int) to authenticated;
revoke execute on function public.admin_retention() from public, anon;
grant execute on function public.admin_retention() to authenticated;

-- 7. You'll also need one admin login (not run as SQL — do this in the
-- dashboard instead): Authentication -> Users -> Add user -> Create new user.
-- Set an email + password and check "Auto Confirm User". Sign in with that
-- at /admin.html on the live site.
