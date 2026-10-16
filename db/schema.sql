-- Idempotent: safe to run on every deploy (npm run migrate).
create extension if not exists citext;

create table if not exists users (
  id                  bigserial primary key,
  email               citext not null unique,
  stripe_customer_id  text unique,
  subscription_status text not null default 'none',
  current_period_end  timestamptz,
  alerts_opt_in       boolean not null default true,
  created_at          timestamptz not null default now(),
  last_login_at       timestamptz
);

create table if not exists login_tokens (
  token_hash text primary key,
  email      citext not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists login_tokens_expires_idx on login_tokens (expires_at);

create table if not exists boards (
  id           bigserial primary key,
  season       int not null,
  week         int not null check (week between 1 and 22),
  status       text not null default 'draft' check (status in ('draft', 'published')),
  odds_min     int not null default -500,
  odds_max     int not null default -200,
  published_at timestamptz,
  alerted_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (season, week)
);

create table if not exists games (
  id         bigserial primary key,
  board_id   bigint not null references boards (id) on delete cascade,
  label      text not null,
  away       text not null,
  home       text not null,
  away_score int,
  home_score int,
  unique (board_id, label)
);

create table if not exists bets (
  id          bigserial primary key,
  board_id    bigint not null references boards (id) on delete cascade,
  game_id     bigint not null references games (id) on delete cascade,
  market      text not null check (market in ('spread', 'total', 'prop')),
  selection   text not null,
  line        numeric(6, 1),
  odds        int not null,
  hit_2025    numeric(6, 4),
  n_2025      int,
  hit_2026    numeric(6, 4),
  n_2026      int,
  blended     numeric(6, 4) not null,
  implied     numeric(6, 4) not null,
  edge        numeric(6, 4) not null,
  sample_size int not null default 0,
  result      char(1) check (result in ('W', 'L', 'P')),
  graded_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists bets_board_idx on bets (board_id);
create index if not exists bets_game_idx on bets (game_id);

-- ── v2: plans + trial, live odds, locked opportunity tracking, backtests ──────────

alter table users add column if not exists plan_id text;
alter table users add column if not exists trial_ends_at timestamptz;
alter table users add column if not exists cancel_at_period_end boolean not null default false;
update users set trial_ends_at = created_at + interval '7 days' where trial_ends_at is null;
alter table users alter column trial_ends_at set default now() + interval '7 days';

alter table boards add column if not exists sport text not null default 'nfl';
alter table boards add column if not exists kind text not null default 'live';
do $$ begin
  alter table boards add constraint boards_kind_check check (kind in ('live', 'backtest'));
exception when duplicate_object then null; end $$;
alter table boards drop constraint if exists boards_season_week_key;
create unique index if not exists boards_sport_kind_season_week_key on boards (sport, kind, season, week);

alter table games add column if not exists commence_time timestamptz;
alter table games add column if not exists external_event_id text;
alter table games add column if not exists odds_checked_at timestamptz;

-- Current price lives in bets.odds/implied/edge and moves with the market.
alter table bets add column if not exists odds_updated_at timestamptz;
alter table bets add column if not exists line_moved_at timestamptz;
alter table bets add column if not exists line_status text not null default 'manual'; -- manual | live | missing
-- Snapshot taken the moment a bet first qualifies (edge > 0 inside the board's odds window). Never changes.
alter table bets add column if not exists qualified_at timestamptz;
alter table bets add column if not exists qualified_odds int;
alter table bets add column if not exists qualified_prob numeric(6, 4);
alter table bets add column if not exists qualified_edge numeric(6, 4);
-- Last price observed before kickoff.
alter table bets add column if not exists closing_odds int;
alter table bets add column if not exists closing_at timestamptz;

create table if not exists bet_price_history (
  id          bigserial primary key,
  bet_id      bigint not null references bets (id) on delete cascade,
  odds        int not null,
  observed_at timestamptz not null default now()
);
create index if not exists bet_price_history_bet_idx on bet_price_history (bet_id, observed_at);

create table if not exists odds_refresh_runs (
  id                bigserial primary key,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running', -- running | ok | error | disabled | idle
  games_checked     int not null default 0,
  prices_changed    int not null default 0,
  credits_remaining int,
  error             text
);
create index if not exists odds_refresh_runs_started_idx on odds_refresh_runs (started_at desc);

-- Locked records: the qualification snapshot can't be edited or deleted once written.
create or replace function bets_lock_qualified() returns trigger as $$
begin
  if old.qualified_at is not null and (
       new.qualified_at   is distinct from old.qualified_at   or
       new.qualified_odds is distinct from old.qualified_odds or
       new.qualified_prob is distinct from old.qualified_prob or
       new.qualified_edge is distinct from old.qualified_edge) then
    raise exception 'Qualified opportunity % is locked', old.id;
  end if;
  return new;
end $$ language plpgsql;
drop trigger if exists bets_lock_qualified on bets;
create trigger bets_lock_qualified before update on bets for each row execute function bets_lock_qualified();

create or replace function bets_protect_delete() returns trigger as $$
begin
  -- Direct deletes only; deleting a whole backtest board cascades (trigger depth > 1).
  if old.qualified_at is not null and pg_trigger_depth() = 1 then
    raise exception 'Qualified opportunity % is locked and cannot be deleted', old.id;
  end if;
  return old;
end $$ language plpgsql;
drop trigger if exists bets_protect_delete on bets;
create trigger bets_protect_delete before delete on bets for each row execute function bets_protect_delete();

create or replace function boards_protect_live() returns trigger as $$
begin
  if old.kind = 'live' and exists (select 1 from bets where board_id = old.id and qualified_at is not null) then
    raise exception 'Live board % has tracked opportunities and cannot be deleted', old.id;
  end if;
  return old;
end $$ language plpgsql;
drop trigger if exists boards_protect_live on boards;
create trigger boards_protect_live before delete on boards for each row execute function boards_protect_live();

-- Backfill: bets already on published boards count as qualified at publish time.
update bets b set qualified_at = coalesce(bd.published_at, b.created_at), qualified_odds = b.odds,
                  qualified_prob = b.blended, qualified_edge = b.edge
  from boards bd
 where bd.id = b.board_id and bd.status = 'published' and b.qualified_at is null
   and b.edge > 0 and b.odds between bd.odds_min and bd.odds_max;

-- ── v3: automated boards (nflverse hit rates × Kalshi ladders) ───────────────────

alter table bets add column if not exists venue text not null default 'draftkings'; -- draftkings | kalshi
alter table bets add column if not exists external_ref text;   -- Kalshi market ticker
alter table bets add column if not exists external_side text;  -- yes | no
create unique index if not exists bets_external_key on bets (board_id, external_ref, external_side) where external_ref is not null;
alter table games add column if not exists flags text;          -- e.g. starting-QB change warnings
alter table boards add column if not exists source text not null default 'manual'; -- manual | auto

create table if not exists pipeline_state (
  key text primary key,
  at  timestamptz not null default now(),
  info jsonb
);

-- ── v4: automated player props ───────────────────────────────────────────────────
alter table bets add column if not exists prop_key text;   -- shared/props.js key, e.g. pass_yds
alter table bets add column if not exists player text;     -- player display name (props only)
alter table bets add column if not exists prop_side text;  -- Over | Under

-- ── v5: cookie-free first-party funnel stats (no IPs, no user ids, no cookies) ────
create table if not exists funnel_daily (
  day   date not null default current_date,
  kind  text not null,   -- view | signup_start | signup | checkout | subscribe | cancel
  path  text not null default '',
  ref   text not null default '',
  count int  not null default 0,
  primary key (day, kind, path, ref)
);

-- ── v6: pick-your-book (sportsbook lines priced against Kalshi fair value) ─────────
alter table users add column if not exists book text;
alter table bets add column if not exists model text not null default 'hitrate'; -- hitrate (retired) | fair
alter table games add column if not exists odds_event_id text;
alter table games add column if not exists book_checked_at timestamptz;
create index if not exists bets_board_model_venue_idx on bets (board_id, model, venue);

-- ── v7: research-grade tracking ─────────────────────────────────────────────────
alter table bets add column if not exists closing_fair numeric(6, 4);   -- sharp fair prob at kickoff (CLV benchmark)
alter table bets add column if not exists model_version text;           -- e.g. fair-v1
alter table bets add column if not exists edge_first_seen timestamptz;  -- edge ≥ 1% first observed
alter table bets add column if not exists edge_last_seen timestamptz;   -- edge ≥ 1% last observed

-- ── v8: live stale-line test ─────────────────────────────────────────────────────
alter table games add column if not exists book_fast_checked_at timestamptz;
alter table bets add column if not exists alerted_at timestamptz;   -- stale-line alert sent
