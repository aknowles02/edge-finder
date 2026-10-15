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
