// The automation loop. One call does everything that's due:
//   1. build/extend this week's board from nflverse hit rates × Kalshi ladders   (hourly)
//   2. re-price every open Kalshi line, lock closing prices, qualify new edges    (every run)
//   3. re-price DraftKings lines via The Odds API, if a key is configured        (its own cadence)
//   4. grade finished games from nflverse scores                                  (every 30 min)
// It's triggered by page views (throttled), Vercel Cron, the admin button, or any external pinger.

import { blendHitRate, gradeBet, impliedProbability } from '../shared/edge.js';
import { qbChangeFlag, spreadHitRate, teamLogs, totalHitRate } from '../shared/hitrates.js';
import { MIN_GAMES, gradeProp, nameKey, playerHitRate } from '../shared/props.js';
import { indexByPlayer, loadPlayerStats } from './playerstats.js';
import { query, tx } from './db.js';
import { betsFromEntry, costToAmerican, effectiveCost, fetchAllLadders, propTeam, teamsMatch } from './kalshi.js';
import { currentWeek, loadGames } from './nflverse.js';
import { qualifyBets } from './boards.js';
import { refreshDraftKings } from './odds.js';
import { alertAdminsOfErrors, alertBoardOnce } from './alerts.js';
import { bookCadenceMs, fastCadenceMs, fastWindowMs, fetchEventOdds, listEvents, scoreEventOdds, scoreKalshiAsBook } from './books.js';
import { sendAdminAlert } from './email.js';
import { findArbs, recordArbs } from './arbs.js';
import { config } from './config.js';
import { actionProb, fitGame, propFair, residualModels } from './fair.js';
import { MIN_QUALIFY_EDGE } from '../shared/books.js';

export const FAIR_MODEL_VERSION = 'fair-v1'; // Kalshi-fit fair price
export const PIN_MODEL_VERSION = 'fair-v2-pinnacle'; // Pinnacle no-vig fair price
const STALE_ALERT_EDGE = Number(process.env.STALE_ALERT_EDGE || 0.03);
import { matchEvent } from './odds.js';

const SEASON = Number(process.env.SEASON || 2026);
const MIN_RUN_GAP_S = 90;
// Bump when scoring changes so the next run rebuilds immediately instead of waiting for the hourly slot.
const BUILD_KEY = 'build:props-v1';
// Rungs worth storing: anything from −150 to −1000. The board's own window (default −200 to −500) decides what qualifies.
const STORE_MIN = -1000, STORE_MAX = -150;
const autoPublish = () => process.env.AUTO_PUBLISH_BOARDS !== '0';

async function due(key, minutes) {
  const { rows } = await query(`select at from pipeline_state where key = $1`, [key]);
  return !rows[0] || Date.now() - new Date(rows[0].at).getTime() >= minutes * 60_000;
}
const mark = (key, info) => query(
  `insert into pipeline_state (key, at, info) values ($1, now(), $2)
   on conflict (key) do update set at = now(), info = excluded.info`, [key, info ?? null]);

/** Pure scoring: every Kalshi rung for the week's open games, with nflverse hit rates. No I/O. */
export function scoreWeek({ games, ladders, week, players, now = Date.now() }) {
  const weekGames = games.filter((g) => g.season === SEASON && g.type === 'REG' && g.week === week);
  const firstDay = weekGames.map((g) => g.gameday).sort()[0];
  const logs25 = teamLogs(games, SEASON - 1);
  const logs26 = teamLogs(games, SEASON, { before: firstDay });

  const rows = [];
  const gameRows = [];
  for (const g of weekGames) {
    if (g.awayScore != null || (g.kickoff && new Date(g.kickoff).getTime() <= now)) continue;
    const entries = ladders.filter((e) => teamsMatch(e.teams, g.away, g.home)
      && Math.abs(new Date(e.date) - new Date(g.gameday)) <= 86_400_000);
    if (!entries.length) continue;
    const label = `${g.away} @ ${g.home}`;
    const flags = [qbChangeFlag(logs26, g.away), qbChangeFlag(logs26, g.home)].filter(Boolean).join('; ') || null;
    gameRows.push({ label, away: g.away, home: g.home, kickoff: g.kickoff, event: entries[0].eventTicker, flags });

    for (const e of entries) {
      if (e.kind === 'prop' && (!players || !propTeam(e, g.away, g.home))) continue;
      for (const b of betsFromEntry(e, g.away, g.home)) {
        const odds = costToAmerican(effectiveCost(b.ask));
        if (odds == null || odds < STORE_MIN || odds > STORE_MAX) continue;
        let r25, r26;
        if (b.market === 'prop') {
          const key = nameKey(b.player);
          r25 = playerHitRate(players.s25.get(key) ?? [], b.propKey, b.line, b.propSide);
          r26 = playerHitRate(players.s26.get(key) ?? [], b.propKey, b.line, b.propSide);
          if (r25.n + r26.n < MIN_GAMES) continue; // same bar as the original QB rule: 6+ real games
        } else if (b.market === 'spread') {
          const opp = b.selection === g.away ? g.home : g.away;
          r25 = spreadHitRate(logs25, b.selection, opp, b.line);
          r26 = spreadHitRate(logs26, b.selection, opp, b.line);
        } else {
          r25 = totalHitRate(logs25, g.away, g.home, b.line, b.selection);
          r26 = totalHitRate(logs26, g.away, g.home, b.line, b.selection);
        }
        const blended = blendHitRate(r25.rate, r25.n, r26.rate, r26.n);
        if (blended == null) continue;
        const implied = impliedProbability(odds);
        rows.push({
          label, market: b.market, selection: b.selection, line: b.line, odds, ref: b.ref, side: b.side,
          propKey: b.propKey ?? null, player: b.player ?? null, propSide: b.propSide ?? null,
          h25: r25.rate, n25: r25.n, h26: r26.rate, n26: r26.n, blended, implied, edge: blended - implied,
          sample: r25.n + r26.n,
        });
      }
    }
  }
  return { gameRows, rows };
}

/** Build (or extend) the board for the current week. Never removes or re-prices locked records. */
export async function loadPlayers(week) {
  const [s25, s26] = await Promise.all([loadPlayerStats(SEASON - 1), loadPlayerStats(SEASON)]);
  return { s25: indexByPlayer(s25), s26: indexByPlayer(s26, { beforeWeek: week }) };
}

export async function buildWeek({ week, ladders, games, players } = {}) {
  games ??= await loadGames();
  week ??= currentWeek(games, SEASON);
  if (!week) return { skipped: 'no upcoming regular-season week' };
  ladders ??= await fetchAllLadders();
  players ??= await loadPlayers(week).catch((err) => { console.error('[players]', err); return null; });
  const { gameRows, rows } = scoreWeek({ games, ladders, week, players });
  if (!gameRows.length) return { week, games: 0, bets: 0, note: 'Kalshi has no ladders posted for this week yet' };

  const result = await tx(async (db) => {
    const { rows: [board] } = await db.query(
      `insert into boards (sport, kind, season, week, source) values ('nfl', 'live', $1, $2, 'auto')
       on conflict (sport, kind, season, week) do update set week = excluded.week
       returning *`,
      [SEASON, week],
    );
    await db.query(
      `insert into games (board_id, label, away, home, commence_time, external_event_id, flags)
       select $1, x.label, x.away, x.home, x.kickoff::timestamptz, x.event, x.flags
         from jsonb_to_recordset($2::jsonb) as x(label text, away text, home text, kickoff text, event text, flags text)
       on conflict (board_id, label) do update
         set commence_time = excluded.commence_time, external_event_id = excluded.external_event_id, flags = excluded.flags`,
      [board.id, JSON.stringify(gameRows)],
    );
    // The hit-rate method is retired; boards now carry sportsbook lines priced against Kalshi (refreshBooks).
    const hitRateRows = process.env.EDGE_MODEL === 'hitrate' ? rows : [];
    const { rowCount } = await db.query(
      `insert into bets (board_id, game_id, venue, external_ref, external_side, market, selection, line, odds,
                         hit_2025, n_2025, hit_2026, n_2026, blended, implied, edge, sample_size,
                         line_status, odds_updated_at, prop_key, player, prop_side)
       select $1, g.id, 'kalshi', x.ref, x.side, x.market, x.selection, x.line, x.odds,
              x.h25, x.n25, x.h26, x.n26, x.blended, x.implied, x.edge, x.sample, 'live', now(),
              x."propKey", x.player, x."propSide"
         from jsonb_to_recordset($2::jsonb) as x(label text, market text, selection text, line numeric, odds int, ref text, side text,
                h25 numeric, n25 int, h26 numeric, n26 int, blended numeric, implied numeric, edge numeric, sample int,
                "propKey" text, player text, "propSide" text)
         join games g on g.board_id = $1 and g.label = x.label
       on conflict (board_id, external_ref, external_side) where external_ref is not null do update
         set hit_2025 = excluded.hit_2025, n_2025 = excluded.n_2025, hit_2026 = excluded.hit_2026, n_2026 = excluded.n_2026,
             blended = excluded.blended, sample_size = excluded.sample_size, edge = excluded.blended - bets.implied`,
      [board.id, JSON.stringify(hitRateRows)],
    );
    let published = false;
    if (board.status !== 'published' && autoPublish()) {
      await db.query(`update boards set status = 'published', published_at = coalesce(published_at, now()) where id = $1`, [board.id]);
      published = true;
    }
    const qualified = await qualifyBets(db, board.id);
    return { boardId: board.id, week, games: gameRows.length, bets: rowCount, published, qualified };
  });
  // New board went live on its own: email Pro members (once per board).
  if (result.published && process.env.AUTO_ALERTS !== '0') {
    try { result.alerted = await alertBoardOnce(result.boardId); } catch (err) { console.error('[alerts]', err); result.alertError = err.message; }
  }
  return result;
}

/** Re-price every open Kalshi bet from a fresh ladder snapshot. */
export async function refreshKalshi({ ladders } = {}) {
  ladders ??= await fetchAllLadders();
  const index = new Map(ladders.map((e) => [e.ticker, e]));
  const { rows: open } = await query(
    `select b.id, b.external_ref, b.external_side, b.odds, b.line_status
       from bets b join boards bd on bd.id = b.board_id join games g on g.id = b.game_id
      where b.venue = 'kalshi' and b.model <> 'fair' and bd.kind = 'live' and bd.status = 'published'
        and (g.commence_time is null or g.commence_time > now())`,
  );
  const updates = [];
  for (const b of open) {
    const e = index.get(b.external_ref);
    const ask = e ? (b.external_side === 'yes' ? e.yesAsk : e.noAsk) : null;
    const odds = ask > 0 && ask < 1 ? costToAmerican(effectiveCost(ask)) : null;
    updates.push({ id: b.id, odds, implied: odds == null ? null : impliedProbability(odds), moved: odds != null && odds !== b.odds });
  }
  await tx(async (db) => {
    if (updates.length) {
      await db.query(
        `update bets b set
            odds = coalesce(x.odds, b.odds),
            implied = coalesce(x.implied, b.implied),
            edge = b.blended - coalesce(x.implied, b.implied),
            line_status = case when x.odds is null then 'missing' else 'live' end,
            odds_updated_at = now(),
            line_moved_at = case when x.moved then now() else b.line_moved_at end
           from jsonb_to_recordset($1::jsonb) as x(id bigint, odds int, implied numeric, moved boolean)
          where b.id = x.id`,
        [JSON.stringify(updates)],
      );
      await db.query(
        `insert into bet_price_history (bet_id, odds)
         select x.id, x.odds from jsonb_to_recordset($1::jsonb) as x(id bigint, odds int, moved boolean) where x.moved`,
        [JSON.stringify(updates)],
      );
    }
    await db.query(
      `update games g set odds_checked_at = now() from boards bd
        where bd.id = g.board_id and bd.kind = 'live' and g.external_event_id like 'KX%' and (g.commence_time is null or g.commence_time > now())`,
    );
  });
  return { priced: updates.length, moved: updates.filter((u) => u.moved).length, missing: updates.filter((u) => u.odds == null).length };
}

const RESERVE_CREDITS = Number(process.env.ODDS_API_MIN_CREDITS || 300);

async function repriceStored(g, kalshi, models) {
  const { rows: lines } = await query(
    `select id, market, selection, line, odds, implied, prop_key, player, prop_side from bets
      where game_id = $1 and model = 'fair' and line_status = 'live'
        and coalesce(model_version, '${FAIR_MODEL_VERSION}') = '${FAIR_MODEL_VERSION}'`, [g.id]);
  if (!lines.length) return 0;
  const fit = fitGame(kalshi.filter((e) => e.kind !== 'prop'), g, models);
  const ladders = new Map();
  for (const e of kalshi) {
    if (e.kind !== 'prop') continue;
    const k = `${nameKey(e.player)}|${e.propKey}`;
    if (!ladders.has(k)) ladders.set(k, []);
    ladders.get(k).push(e);
  }
  const updates = [];
  for (const b of lines) {
    const line = Number(b.line);
    const f = b.market === 'spread' ? fit.spread(b.selection, line)
      : b.market === 'total' ? fit.total(b.selection, line)
        : propFair(ladders.get(`${nameKey(b.player)}|${b.prop_key}`) ?? [], line, b.prop_side);
    const p = actionProb(f);
    if (p != null) updates.push({ id: b.id, fair: p, edge: p - Number(b.implied) });
  }
  if (!updates.length) return 0;
  await query(
    `update bets b set blended = x.fair, edge = x.edge,
            edge_first_seen = case when x.edge >= $2 then coalesce(b.edge_first_seen, now()) else b.edge_first_seen end,
            edge_last_seen = case when x.edge >= $2 then now() else b.edge_last_seen end
       from jsonb_to_recordset($1::jsonb) as x(id bigint, fair numeric, edge numeric)
      where b.id = x.id`,
    [JSON.stringify(updates), MIN_QUALIFY_EDGE],
  );
  return updates.length;
}

/**
 * Live stale-line test: email admins the moment a sportsbook is ≥3% off Pinnacle's no-vig price on a
 * freshly pulled line (once per line). Admin-only while we measure whether these edges are real.
 */
async function alertStaleLines(g) {
  const admins = [...config.adminEmails()];
  if (!admins.length) return 0;
  const { rows } = await query(
    `update bets set alerted_at = now()
      where game_id = $1 and model = 'fair' and model_version = $2 and alerted_at is null
        and edge >= $3 and odds_updated_at > now() - interval '5 minutes'
        and coalesce(prop_key, '') not in ('any_td', 'pass_tds', 'pass_int')
      returning venue, market, selection, line, odds, blended, edge`,
    [g.id, PIN_MODEL_VERSION, STALE_ALERT_EDGE],
  );
  if (!rows.length) return 0;
  const lines = rows.slice(0, 15).map((b) =>
    `${g.label}: ${b.selection} ${b.market === 'spread' && Number(b.line) > 0 ? '+' : ''}${b.line} at ${b.venue} ${b.odds > 0 ? '+' : ''}${b.odds}, fair ${(b.blended * 100).toFixed(1)}%, edge +${(b.edge * 100).toFixed(1)}%`);
  await sendAdminAlert(admins, `Stale line alert: ${rows.length} edge${rows.length > 1 ? 's' : ''} in ${g.label}`, lines);
  return rows.length;
}

/** Upsert scored lines for one game (any books) and log price moves. */
async function upsertBookLines(gameRow, rows) {
  const keep = rows.filter((r) => r.edge > -0.03); // far-negative lines are noise; skip storing them
  if (!keep.length) return { stored: 0, moved: 0 };
  const { rows: existing } = await query(
    `select external_ref, odds, id from bets where game_id = $1 and model = 'fair' and external_ref = any($2)`,
    [gameRow.id, keep.map((r) => r.ref)],
  );
  const prev = new Map(existing.map((e) => [e.external_ref, e]));
  await query(
    `insert into bets (board_id, game_id, venue, model, model_version, external_ref, external_side, market, selection, line, odds,
                       blended, implied, edge, sample_size, line_status, odds_updated_at, prop_key, player, prop_side)
     select $1, $2, x.book, 'fair', case when x.source = 'pinnacle' then '${PIN_MODEL_VERSION}' else '${FAIR_MODEL_VERSION}' end, x.ref, 'book', x.market, x.selection, x.line, x.odds,
            x.fair, x.implied, x.edge, 0, 'live', now(), x."propKey", x.player, x."propSide"
       from jsonb_to_recordset($3::jsonb) as x(book text, market text, selection text, line numeric, odds int, fair numeric,
            implied numeric, edge numeric, ref text, "propKey" text, player text, "propSide" text, source text)
     on conflict (board_id, external_ref, external_side) where external_ref is not null do update
       set odds = excluded.odds, implied = excluded.implied, blended = excluded.blended, edge = excluded.edge,
           model_version = excluded.model_version,
           edge_first_seen = case when excluded.edge >= ${MIN_QUALIFY_EDGE} then coalesce(bets.edge_first_seen, now()) else bets.edge_first_seen end,
           edge_last_seen = case when excluded.edge >= ${MIN_QUALIFY_EDGE} then now() else bets.edge_last_seen end,
           line_status = 'live', odds_updated_at = now(),
           line_moved_at = case when bets.odds <> excluded.odds then now() else bets.line_moved_at end`,
    [gameRow.board_id, gameRow.id, JSON.stringify(keep)],
  );
  const moved = keep.filter((r) => prev.has(r.ref) && prev.get(r.ref).odds !== r.odds);
  if (moved.length) {
    await query(
      `insert into bet_price_history (bet_id, odds)
       select b.id, x.odds from jsonb_to_recordset($2::jsonb) as x(ref text, odds int)
         join bets b on b.game_id = $1 and b.external_ref = x.ref and b.model = 'fair'`,
      [gameRow.id, JSON.stringify(moved.map((r) => ({ ref: r.ref, odds: r.odds })))],
    );
  }
  return { stored: keep.length, moved: moved.length };
}

/**
 * Price every open game's sportsbook lines against Kalshi fair value.
 * Kalshi (as a book) is free and runs every time; sportsbooks need ODDS_API_KEY and follow the cadence.
 */
export async function refreshBooks({ ladders, games, force = false } = {}) {
  ladders ??= await fetchAllLadders();
  games ??= await loadGames();
  const models = residualModels(games, SEASON);
  const { rows: open } = await query(
    `select g.*, bd.sport from games g join boards bd on bd.id = g.board_id
      where bd.kind = 'live' and bd.status = 'published' and g.away_score is null
        and g.commence_time > now()`,
  );
  const out = { games: open.length, kalshi: 0, sportsbooks: 0, moved: 0, credits: null, skipped: 0,
    keyConfigured: Boolean(process.env.ODDS_API_KEY), noKalshi: 0, notDue: 0, unmatched: 0, fetched: 0 };
  let events = null;
  for (const g of open) {
    const kalshi = ladders.filter((e) => teamsMatch(e.teams, g.away, g.home)
      && Math.abs(new Date(e.date) - new Date(g.commence_time)) <= 1.5 * 86_400_000);
    if (!kalshi.length) { out.noKalshi++; continue; }
    if (process.env.KALSHI_AS_BOOK === '1') { // research only; see shared/books.js
      const k = await upsertBookLines(g, scoreKalshiAsBook(kalshi, g, models));
      out.kalshi += k.stored; out.moved += k.moved;
    }

    // Free every run: re-price this game's stored sportsbook lines against the latest Kalshi fair value,
    // so edges (and the closing fair price) track the sharp market between paid sportsbook pulls.
    out.repriced = (out.repriced ?? 0) + await repriceStored(g, kalshi, models);

    if (!process.env.ODDS_API_KEY) continue;
    const kickoff = new Date(g.commence_time).getTime();
    const since = (t) => (t ? Date.now() - new Date(t).getTime() : Infinity);
    const fullDue = force || since(g.book_checked_at) >= bookCadenceMs(kickoff) - 60_000;
    // Stale-line watch: cheap spreads/totals pulls every 15 min in the last 4 hours before kickoff.
    const fastDue = !fullDue && kickoff - Date.now() <= fastWindowMs
      && Math.min(since(g.book_fast_checked_at), since(g.book_checked_at)) >= fastCadenceMs - 60_000;
    if (!fullDue && !fastDue) { out.notDue++; continue; }
    if (out.credits != null && out.credits < RESERVE_CREDITS) { out.skipped++; continue; }
    events ??= await listEvents(g.sport);
    const ev = (g.odds_event_id && events.find((e) => e.id === g.odds_event_id)) || matchEvent(g.sport, g, events);
    if (!ev) { out.unmatched++; continue; }
    const { data, remaining } = await fetchEventOdds(ev.id, g.sport, { fast: fastDue });
    out.fetched++;
    if (fastDue) out.fast = (out.fast ?? 0) + 1;
    out.credits = remaining ?? out.credits;
    await query(`update games set odds_event_id = $1, ${fastDue ? 'book_fast_checked_at' : 'book_checked_at'} = now() where id = $2`, [ev.id, g.id]);
    if (!data) continue;
    const scored = scoreEventOdds(data, g, kalshi, models, g.sport);
    const r = await upsertBookLines(g, scored);
    out.sportsbooks += r.stored; out.moved += r.moved;
    out.alerts = (out.alerts ?? 0) + await alertStaleLines(g).catch((err) => { console.error('[stale alert]', err); return 0; });
    out.arbs = (out.arbs ?? 0) + await recordArbs(g, findArbs(data, kalshi, g, g.sport)).catch((err) => { console.error('[arbs]', err); return 0; });
    // Count-only profile of what each book is offering vs fair value (no picks or prices).
    out.byBook ??= {};
    for (const x of scored) {
      const b = (out.byBook[x.book] ??= { lines: 0, edge1: 0, edge1Window: 0, edge3: 0, best: 0 });
      b.lines++;
      if (x.edge >= 0.01) b.edge1++;
      if (x.edge >= 0.03) b.edge3++;
      if (x.edge >= 0.01 && x.odds >= -500 && x.odds <= -200) b.edge1Window++;
      b.best = Math.max(b.best, Math.round(x.edge * 1000) / 10);
    }
  }
  return out;
}

/** Lock closing prices at kickoff and qualify any newly positive-edge lines. */
async function lockAndQualify() {
  await query(
    `update bets b set closing_odds = b.odds, closing_at = now(),
            closing_fair = case when b.model = 'fair' then b.blended else null end
       from games g where g.id = b.game_id and g.commence_time <= now() and b.closing_odds is null and b.line_status = 'live'`,
  );
  const { rows } = await query(`select id from boards where kind = 'live' and status = 'published'`);
  let n = 0;
  for (const r of rows) n += await qualifyBets({ query }, r.id);
  return n;
}

/** Grade automated props from nflverse player stats once the game's week is in the file (usually within a day). */
export async function gradeProps() {
  const { rows: pending } = await query(
    `select b.id, b.player, b.prop_key, b.prop_side, b.line, bd.season, bd.week
       from bets b join boards bd on bd.id = b.board_id join games g on g.id = b.game_id
      where bd.kind = 'live' and b.market = 'prop' and b.prop_key is not null and b.result is null
        and g.away_score is not null`,
  );
  if (!pending.length) return { graded: 0 };
  const seasons = [...new Set(pending.map((p) => p.season))];
  const stats = new Map();
  for (const season of seasons) stats.set(season, await loadPlayerStats(season, { fresh: true }));
  const updates = [];
  for (const p of pending) {
    const rows = stats.get(p.season);
    if (!rows.some((r) => r.week === p.week)) continue; // stats for that week not published yet
    const row = rows.find((r) => r.week === p.week && r.key === nameKey(p.player));
    // No row = didn't record a stat (inactive/DNP). Leave for manual review rather than guess Kalshi's ruling.
    const result = gradeProp(row, p.prop_key, Number(p.line), p.prop_side);
    if (result) updates.push({ id: p.id, result });
  }
  if (updates.length) {
    await query(
      `update bets b set result = x.result, graded_at = now()
         from jsonb_to_recordset($1::jsonb) as x(id bigint, result text) where b.id = x.id`,
      [JSON.stringify(updates)],
    );
  }
  return { graded: updates.length };
}

/**
 * Personal bets: copy the result and sharp closing price from the board line they came from, or grade
 * manual spreads/totals on a known game from its final score. Manual props stay user-graded.
 */
export async function gradeUserBets() {
  const { rowCount: linked } = await query(
    `update user_bets ub set result = b.result, graded_at = now(), closing_fair = coalesce(ub.closing_fair, b.closing_fair)
       from bets b where b.id = ub.bet_id and ub.result is null and b.result is not null`);
  await query(
    `update user_bets ub set closing_fair = b.closing_fair from bets b
      where b.id = ub.bet_id and ub.closing_fair is null and b.closing_fair is not null`);
  const { rows } = await query(
    `select ub.id, ub.market, ub.selection, ub.line, g.away, g.home, g.away_score, g.home_score
       from user_bets ub join games g on g.id = ub.game_id
      where ub.result is null and ub.bet_id is null and ub.market <> 'prop' and g.away_score is not null`);
  let manual = 0;
  for (const r of rows) {
    const result = gradeBet({ market: r.market, selection: r.selection, line: r.line },
      { away: r.away, home: r.home, awayScore: r.away_score, homeScore: r.home_score });
    if (!result) continue;
    await query('update user_bets set result = $1, graded_at = now() where id = $2', [result, r.id]);
    manual++;
  }
  return linked + manual;
}

/** Grade finished games on live boards from nflverse scores (spreads/totals). */
export async function gradeFromNflverse({ games } = {}) {
  const { rows: pending } = await query(
    `select g.*, bd.season, bd.week from games g join boards bd on bd.id = g.board_id
      where bd.kind = 'live' and g.away_score is null and (g.commence_time is null or g.commence_time < now() - interval '3 hours')`,
  );
  if (!pending.length) return { graded: 0 };
  games ??= await loadGames({ fresh: true });
  let graded = 0;
  for (const g of pending) {
    const final = games.find((x) => x.season === g.season && x.week === g.week && x.awayScore != null
      && ((x.away === g.away && x.home === g.home) || (x.away === g.home && x.home === g.away)));
    if (!final) continue;
    const awayScore = final.away === g.away ? final.awayScore : final.homeScore;
    const homeScore = final.away === g.away ? final.homeScore : final.awayScore;
    graded += await tx(async (db) => {
      await db.query('update games set away_score = $1, home_score = $2 where id = $3', [awayScore, homeScore, g.id]);
      const { rows: bets } = await db.query(`select * from bets where game_id = $1 and market <> 'prop' and result is null`, [g.id]);
      let n = 0;
      for (const b of bets) {
        const result = gradeBet(b, { away: g.away, home: g.home, awayScore, homeScore });
        if (!result) continue;
        await db.query('update bets set result = $1, graded_at = now() where id = $2', [result, b.id]);
        n++;
      }
      return n;
    });
  }
  return { graded };
}

/**
 * Run whatever is due. Returns null if another run started in the last 90s (unless forced).
 * Each run is logged to odds_refresh_runs for the freshness indicators and the admin panel.
 */
export async function runPipeline({ force = false, build = false } = {}) {
  const { rows } = await query(
    `insert into odds_refresh_runs (status)
     select 'running' where $1 or not exists (
       select 1 from odds_refresh_runs where started_at > now() - make_interval(secs => $2))
     returning id`,
    [force, MIN_RUN_GAP_S],
  );
  if (!rows[0]) return null;
  const runId = rows[0].id;
  const summary = {};
  const errors = [];
  const step = async (name, fn) => {
    try { summary[name] = await fn(); } catch (err) { console.error(`[pipeline:${name}]`, err); errors.push(`${name}: ${err.message}`); }
  };

  let ladders = null;
  let games = null;
  await step('fetch', async () => {
    [ladders, games] = await Promise.all([fetchAllLadders(), loadGames()]);
    return { markets: ladders.length };
  });
  if (ladders && games && (force || build || await due(BUILD_KEY, 60))) {
    await step('build', async () => { const r = await buildWeek({ ladders, games }); await mark(BUILD_KEY, r); return r; });
  }
  if (ladders) await step('kalshi', () => refreshKalshi({ ladders }));
  if (ladders && games) {
    await step('books', async () => { const r = await refreshBooks({ ladders, games, force }); await mark('books', r); return r; });
  }
  // Legacy: re-pricing pasted DraftKings lines. The book step above covers sportsbooks now.
  if (process.env.ODDS_API_KEY && process.env.EDGE_MODEL === 'hitrate') await step('draftkings', () => refreshDraftKings({ force }));
  await step('qualify', lockAndQualify);
  if (force || await due('grade', 30)) {
    await step('grade', async () => {
      const r = await gradeFromNflverse({ games: null });
      const p = await gradeProps();
      const u = await gradeUserBets();
      const out = { graded: r.graded, propsGraded: p.graded, userBetsGraded: u };
      await mark('grade', out);
      return out;
    });
  }

  const priced = (summary.kalshi?.priced ?? 0) + (summary.books?.kalshi ?? 0) + (summary.books?.sportsbooks ?? 0);
  const moved = (summary.kalshi?.moved ?? 0) + (summary.books?.moved ?? 0);
  await query(
    `update odds_refresh_runs set finished_at = now(), status = $2, games_checked = $3, prices_changed = $4, error = $5 where id = $1`,
    [runId, errors.length ? 'error' : 'ok', priced, moved, errors.join(' | ') || null],
  );
  if (errors.length) await alertAdminsOfErrors(errors).catch((err) => console.error('[admin alert]', err));
  return { ...summary, errors };
}
