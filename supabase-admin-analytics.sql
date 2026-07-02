-- Tranquil — admin analytics setup.
-- Run this once in the Supabase SQL Editor (Project -> SQL Editor -> New query -> Run).
-- Reference copy only; not executed automatically by the app.

-- 1. Table logging every completed round (not just top-10 leaderboard scores).
create table if not exists public.plays (
  id uuid primary key default gen_random_uuid(),
  game text not null,
  value numeric not null,
  round text,
  created_at timestamptz not null default now()
);
alter table public.plays enable row level security;

-- Anyone (including anonymous players) can log a completed play.
-- Deliberately NO select policy — the raw table can't be read via the API at
-- all, not even with the public anon key. Reads only happen through the two
-- admin-only functions below.
create policy "public insert" on public.plays
  for insert with check (char_length(game) between 1 and 20 and value is not null);

-- 2. Aggregate summary per game: total plays, average, median, min, max.
create or replace function public.admin_play_summary()
returns table(game text, plays bigint, avg_value numeric, median_value numeric, min_value numeric, max_value numeric)
language sql
security definer
set search_path = public
as $$
  select game, count(*) as plays,
         round(avg(value)::numeric, 1) as avg_value,
         percentile_cont(0.5) within group (order by value) as median_value,
         min(value) as min_value, max(value) as max_value
  from public.plays
  group by game
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

-- 4. Lock both functions to logged-in admins only — anonymous players (and
-- anyone who only has the public anon key) cannot call these.
revoke execute on function public.admin_play_summary() from public, anon;
grant execute on function public.admin_play_summary() to authenticated;
revoke execute on function public.admin_play_histogram(text, int) from public, anon;
grant execute on function public.admin_play_histogram(text, int) to authenticated;

-- 5. You'll also need one admin login (not run as SQL — do this in the
-- dashboard instead): Authentication -> Users -> Add user -> Create new user.
-- Set an email + password and check "Auto Confirm User". Sign in with that
-- at /admin.html on the live site.
