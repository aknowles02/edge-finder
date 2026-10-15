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
 * One refresh pass. `force` re-prices every open game regardless of cadence (admin "Refresh now").
 * Every run is logged in odds_refresh_runs so the UI can show freshness and failures honestly.
 */
export async function refreshOdds({ force = false } = {}) {
  const { rows: [run] } = await query(`insert into odds_refresh_runs default values returning id`);
  const finish = (status, fields = {}) => query(
    `update odds_refresh_runs set finished_at = now(), status = $2, games_checked = $3, prices_changed = $4,
            credits_remaining = $5, error = $6 where id = $1`,
    [run.id, status, fields.games ?? 0, fields.changed ?? 0, fields.remaining ?? null, fields.error ?? null],
  );

  if (!process.env.ODDS_API_KEY) {
    await finish('disabled', { error: 'ODDS_API_KEY not set' });
    return { status: 'disabled' };
  }

  let games = 0, changed = 0, remaining = null;
  try {
    const { rows: open } = await query(
      `select g.*, bd.sport, bd.id as board_id from games g join boards bd on bd.id = g.board_id
        where bd.kind = 'live' and bd.status = 'published'
          and (g.commence_time is null or g.commence_time > now() - interval '6 hours')
          and g.away_score is null`,
    );
    const now = Date.now();

    // Lock closing prices for anything that has kicked off.
    await query(
      `update bets b set closing_odds = b.odds, closing_at = now()
         from games g where g.id = b.game_id and g.commence_time <= now() and b.closing_odds is null and b.line_status = 'live'`,
    );

    const bySport = new Map();
    for (const g of open) {
      if (!SPORTS[g.sport]?.oddsKey) continue;
      const start = g.commence_time ? new Date(g.commence_time).getTime() : null;
      if (start && start <= now) continue;
      const due = force || !g.odds_checked_at || now - new Date(g.odds_checked_at).getTime() >= refreshIntervalMs(start, now) - MIN;
      if (!due) continue;
      if (!bySport.has(g.sport)) bySport.set(g.sport, []);
      bySport.get(g.sport).push(g);
    }
    if (!bySport.size) {
      await finish('idle');
      return { status: 'idle' };
    }

    for (const [sport, list] of bySport) {
      const spec = SPORTS[sport];
      const { data: events, remaining: r1 } = await fetchJson(`/sports/${spec.oddsKey}/events`);
      remaining = r1 ?? remaining;
      for (const g of list) {
        const event = g.external_event_id ? events.find((e) => e.id === g.external_event_id) ?? matchEvent(sport, g, events) : matchEvent(sport, g, events);
        if (!event) continue;
        const { data: eventOdds, remaining: r2 } = await fetchJson(`/sports/${spec.oddsKey}/events/${event.id}/odds`, {
          regions: 'us', bookmakers: BOOKMAKER, oddsFormat: 'american', markets: Object.values(spec.markets).join(','),
        });
        remaining = r2 ?? remaining;
        games++;
        changed += await tx(async (db) => {
          await db.query('update games set external_event_id = $1, commence_time = $2, odds_checked_at = now() where id = $3',
            [event.id, event.commence_time, g.id]);
          const { rows: bets } = await db.query(`select * from bets where game_id = $1 and market <> 'prop'`, [g.id]);
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
            if (moved || b.line_status !== 'live') {
              await db.query('insert into bet_price_history (bet_id, odds) values ($1, $2)', [b.id, price]);
            }
            if (moved) n++;
          }
          // Newly qualifying lines become tracked opportunities with a locked snapshot.
          await db.query(
            `update bets b set qualified_at = now(), qualified_odds = b.odds, qualified_prob = b.blended, qualified_edge = b.edge
               from boards bd where bd.id = b.board_id and b.game_id = $1 and b.qualified_at is null
                and b.edge > 0 and b.odds between bd.odds_min and bd.odds_max`,
            [g.id],
          );
          return n;
        });
      }
    }
    await finish('ok', { games, changed, remaining });
    return { status: 'ok', games, changed, remaining };
  } catch (err) {
    console.error('[odds refresh]', err);
    await finish('error', { games, changed, remaining, error: err.message.slice(0, 500) });
    return { status: 'error', error: err.message };
  }
}

export async function oddsStatus() {
  const { rows } = await query(
    `select (select row_to_json(r) from (select * from odds_refresh_runs order by started_at desc limit 1) r) as last_run,
            (select max(finished_at) from odds_refresh_runs where status in ('ok', 'idle')) as last_success`,
  );
  const last = rows[0]?.last_run;
  return {
    enabled: Boolean(process.env.ODDS_API_KEY),
    lastRunAt: last?.started_at ?? null,
    lastRunStatus: last?.status ?? null,
    lastError: last?.status === 'error' ? last.error : null,
    lastSuccessAt: rows[0]?.last_success ?? null,
    creditsRemaining: last?.credits_remaining ?? null,
  };
}
