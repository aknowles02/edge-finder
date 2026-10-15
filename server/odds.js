// Live odds refresh. A scheduler (GitHub Actions every 15 min, Vercel Cron as a daily fallback) calls
// /api/cron/refresh-odds; each run only re-prices games that are due, so API credits scale with
// how close games are to kickoff rather than with how often the cron fires.

import { impliedProbability } from '../shared/edge.js';
import { SPORTS, teamName } from '../shared/sports.js';
import { query, tx } from './db.js';

const API = 'https://api.the-odds-api.com/v4';
const BOOKMAKER = 'draftkings';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

/** How often a game's prices are re-checked, by time to kickoff. */
export function refreshIntervalMs(startMs, now = Date.now()) {
  if (!startMs) return 6 * HOUR;
  const until = startMs - now;
  if (until <= 3 * HOUR) return 15 * MIN;
  if (until <= 24 * HOUR) return HOUR;
  if (until <= 72 * HOUR) return 2 * HOUR;
  return 6 * HOUR;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Find the feed event for a board game ("BUF @ MIA"). */
export function matchEvent(sport, game, events) {
  const away = norm(teamName(sport, game.away));
  const home = norm(teamName(sport, game.home));
  return events.find((e) => norm(e.away_team) === away && norm(e.home_team) === home) ?? null;
}

/** Find the DraftKings price for one alt line in an event-odds payload. Returns odds or null. */
export function matchPrice(sport, bet, game, eventOdds) {
  const book = eventOdds?.bookmakers?.find((b) => b.key === BOOKMAKER);
  const marketKey = SPORTS[sport]?.markets?.[bet.market];
  const market = book?.markets?.find((m) => m.key === marketKey);
  if (!market) return null;
  const line = Number(bet.line);
  let wanted;
  if (bet.market === 'spread') {
    const code = bet.selection.toUpperCase() === String(game.away).toUpperCase() ? game.away : game.home;
    wanted = norm(teamName(sport, code));
  } else {
    wanted = norm(bet.selection); // over | under
  }
  const outcome = market.outcomes.find((o) => norm(o.name) === wanted && Number(o.point) === line);
  return outcome ? Math.round(outcome.price) : null;
}

async function fetchJson(path, params) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('apiKey', process.env.ODDS_API_KEY);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const remaining = res.headers.get('x-requests-remaining');
  if (!res.ok) throw new Error(`Odds API ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  return { data: await res.json(), remaining: remaining == null ? null : Number(remaining) };
}

/**
 * DraftKings re-pricing via The Odds API (optional — only when ODDS_API_KEY is set).
 * Only touches games that are due on the cadence above. Called from the pipeline, which logs the run.
 */
export async function refreshDraftKings({ force = false } = {}) {
  let games = 0, changed = 0, remaining = null;
  const { rows: open } = await query(
    `select g.*, bd.sport, bd.id as board_id from games g join boards bd on bd.id = g.board_id
      where bd.kind = 'live' and bd.status = 'published' and g.away_score is null
        and exists (select 1 from bets b where b.game_id = g.id and b.venue = 'draftkings' and b.market <> 'prop')
        and (g.commence_time is null or g.commence_time > now())`,
  );
  const now = Date.now();
  const bySport = new Map();
  for (const g of open) {
    if (!SPORTS[g.sport]?.oddsKey) continue;
    const start = g.commence_time ? new Date(g.commence_time).getTime() : null;
    const due = force || !g.odds_checked_at || now - new Date(g.odds_checked_at).getTime() >= refreshIntervalMs(start, now) - MIN;
    if (!due) continue;
    if (!bySport.has(g.sport)) bySport.set(g.sport, []);
    bySport.get(g.sport).push(g);
  }
  for (const [sport, list] of bySport) {
    const spec = SPORTS[sport];
    const { data: events, remaining: r1 } = await fetchJson(`/sports/${spec.oddsKey}/events`);
    remaining = r1 ?? remaining;
    for (const g of list) {
      const event = matchEvent(sport, g, events);
      if (!event) continue;
      const { data: eventOdds, remaining: r2 } = await fetchJson(`/sports/${spec.oddsKey}/events/${event.id}/odds`, {
        regions: 'us', bookmakers: BOOKMAKER, oddsFormat: 'american', markets: Object.values(spec.markets).join(','),
      });
      remaining = r2 ?? remaining;
      games++;
      changed += await tx(async (db) => {
        await db.query('update games set commence_time = coalesce(commence_time, $1), odds_checked_at = now() where id = $2', [event.commence_time, g.id]);
        const { rows: bets } = await db.query(`select * from bets where game_id = $1 and venue = 'draftkings' and market <> 'prop'`, [g.id]);
        let n = 0;
        for (const b of bets) {
          const price = matchPrice(sport, b, g, eventOdds);
          if (price == null) {
            await db.query(`update bets set line_status = 'missing', odds_updated_at = now() where id = $1`, [b.id]);
            continue;
          }
          const implied = impliedProbability(price);
          const moved = price !== b.odds;
          await db.query(
            `update bets set odds = $2, implied = $3, edge = blended - $3, line_status = 'live', odds_updated_at = now(),
                    line_moved_at = case when $4 then now() else line_moved_at end
              where id = $1`,
            [b.id, price, implied, moved],
          );
          if (moved || b.line_status !== 'live') await db.query('insert into bet_price_history (bet_id, odds) values ($1, $2)', [b.id, price]);
          if (moved) n++;
        }
        return n;
      });
    }
  }
  return { games, changed, remaining };
}

export async function oddsStatus() {
  const { rows } = await query(
    `select (select row_to_json(r) from (select * from odds_refresh_runs order by started_at desc limit 1) r) as last_run,
            (select max(finished_at) from odds_refresh_runs where status in ('ok', 'idle')) as last_success`,
  );
  const last = rows[0]?.last_run;
  return {
    enabled: true, // Kalshi prices are always on; DraftKings re-pricing additionally needs ODDS_API_KEY
    draftkingsEnabled: Boolean(process.env.ODDS_API_KEY),
    lastRunAt: last?.started_at ?? null,
    lastRunStatus: last?.status ?? null,
    lastError: last?.status === 'error' ? last.error : null,
    lastSuccessAt: rows[0]?.last_success ?? null,
    creditsRemaining: last?.credits_remaining ?? null,
  };
}
