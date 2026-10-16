// Sportsbook lines from The Odds API, scored against Kalshi fair prices.
// One request per game returns every supported book, so cost doesn't grow with the number of books.
// Credits = markets requested per game; a budget guard and a kickoff-based cadence keep usage bounded.

import { impliedProbability } from '../shared/edge.js';
import { BOOKS } from '../shared/books.js';
import { PROP_STATS, nameKey, propSelection } from '../shared/props.js';
import { SPORTS, teamName } from '../shared/sports.js';
import { actionProb, fitGame, propFair } from './fair.js';
import { propTeam, teamsMatch } from './kalshi.js';

const API = 'https://api.the-odds-api.com/v4';
const HOUR = 3_600_000;

// Odds API market key → how we store it. Player props map onto shared/props.js keys.
export const BOOK_MARKETS = {
  spreads: { market: 'spread' },
  alternate_spreads: { market: 'spread' },
  totals: { market: 'total' },
  alternate_totals: { market: 'total' },
  player_pass_yds: { market: 'prop', propKey: 'pass_yds' },
  player_pass_yds_alternate: { market: 'prop', propKey: 'pass_yds' },
  player_rush_yds: { market: 'prop', propKey: 'rush_yds' },
  player_rush_yds_alternate: { market: 'prop', propKey: 'rush_yds' },
  player_reception_yds: { market: 'prop', propKey: 'rec_yds' },
  player_reception_yds_alternate: { market: 'prop', propKey: 'rec_yds' },
  player_receptions: { market: 'prop', propKey: 'receptions' },
  player_receptions_alternate: { market: 'prop', propKey: 'receptions' },
  player_anytime_td: { market: 'prop', propKey: 'any_td' },
};
const DEFAULT_MARKETS = Object.keys(BOOK_MARKETS);

/** Game-day stale-line watch: cheap spreads/totals pulls every 15 minutes in the last 4 hours. */
export const fastWindowMs = 4 * HOUR;
export const fastCadenceMs = 15 * 60_000;

/** How often each game's sportsbook prices are re-pulled. Tighter near kickoff, where lines move. */
export function bookCadenceMs(kickoffMs, now = Date.now()) {
  const until = kickoffMs - now;
  if (until <= 25 * 60_000) return 10 * 60_000; // final pull(s) right before kickoff = accurate closing price
  if (until <= 3 * HOUR) return HOUR;
  if (until <= 24 * HOUR) return 3 * HOUR;
  if (until <= 48 * HOUR) return 6 * HOUR;
  return 12 * HOUR;
}

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');

/** Team full name in a feed outcome → the game's board code (away/home). */
function codeFor(name, game, sport) {
  const n = norm(name);
  if (n === norm(teamName(sport, game.away))) return game.away;
  if (n === norm(teamName(sport, game.home))) return game.home;
  return null;
}

/**
 * Turn one event-odds payload into scored lines, priced against Kalshi.
 * `kalshi`: this game's Kalshi ladder entries. Returns rows ready to upsert (all books).
 */
const dec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);

/**
 * Pinnacle (the sharpest book) with its margin removed: exact no-vig probability for every line it
 * lists, plus ladder entries so a fit can price lines it doesn't list. Null if Pinnacle isn't in the payload.
 */
export function pinnacleFair(eventOdds, game, sport = 'nfl') {
  const book = eventOdds?.bookmakers?.find((b) => b.key === 'pinnacle');
  if (!book) return null;
  const exact = new Map(), entries = [];
  for (const m of book.markets ?? []) {
    const spec = BOOK_MARKETS[m.key];
    if (!spec || spec.market === 'prop') continue;
    const isSpread = spec.market === 'spread';
    const out = (m.outcomes ?? []).map((o) => ({ ...o, side: isSpread ? codeFor(o.name, game, sport) : o.name, point: Number(o.point) }));
    for (const o of out) {
      if (!o.side || !Number.isFinite(o.point) || Number.isInteger(o.point)) continue;
      const opp = isSpread
        ? out.find((x) => x.side && x.side !== o.side && x.point === -o.point)
        : out.find((x) => x.side !== o.side && x.point === o.point);
      if (!opp) continue;
      const p = (1 / dec(o.price)) / (1 / dec(o.price) + 1 / dec(opp.price));
      exact.set(`${spec.market}|${o.side}|${o.point}`, p);
      if (isSpread) entries.push({ kind: 'spread', team: o.side, strike: -o.point, yesBid: p, yesAsk: p });
      else if (o.side === 'Over') entries.push({ kind: 'total', strike: o.point, yesBid: p, yesAsk: p });
    }
  }
  return exact.size ? { exact, entries } : null;
}

export function scoreEventOdds(eventOdds, game, kalshi, models, sport = 'nfl') {
  const kalshiFit = fitGame(kalshi.filter((e) => e.kind !== 'prop'), game, models);
  // Pinnacle no-vig is the primary fair price for spreads/totals (backtested as accurate as Kalshi and
  // live/liquid); Kalshi's ladder fills in when Pinnacle is missing, and always prices props.
  const pin = pinnacleFair(eventOdds, game, sport);
  const pinFit = pin ? fitGame(pin.entries, game, models) : null;
  const fairFor = (market, side, line) => {
    const ex = pin?.exact.get(`${market}|${side}|${line}`);
    if (ex != null) return { f: { win: ex, push: 0 }, source: 'pinnacle' };
    const viaPin = pinFit && (market === 'spread' ? pinFit.spread(side, line) : pinFit.total(side, line));
    if (viaPin) return { f: viaPin, source: 'pinnacle' };
    const viaKalshi = market === 'spread' ? kalshiFit.spread(side, line) : kalshiFit.total(side, line);
    return { f: viaKalshi, source: 'kalshi' };
  };
  // Player ladders, keyed by player + stat.
  const ladders = new Map();
  for (const e of kalshi) {
    if (e.kind !== 'prop' || !propTeam(e, game.away, game.home)) continue;
    const k = `${nameKey(e.player)}|${e.propKey}`;
    if (!ladders.has(k)) ladders.set(k, []);
    ladders.get(k).push(e);
  }

  const rows = [];
  const wanted = new Set(BOOKS.map((b) => b.key));
  for (const book of eventOdds?.bookmakers ?? []) {
    if (!wanted.has(book.key)) continue;
    for (const m of book.markets ?? []) {
      const spec = BOOK_MARKETS[m.key];
      if (!spec) continue;
      for (const o of m.outcomes ?? []) {
        if (!Number.isFinite(o.price) || Math.abs(o.price) < 100) continue;
        let fair = null, source = 'kalshi', selection, line, team = null, player = null, propSide = null;
        if (spec.market === 'spread') {
          team = codeFor(o.name, game, sport);
          if (!team || o.point == null) continue;
          line = Number(o.point);
          selection = team;
          ({ f: fair, source } = fairFor('spread', team, line));
        } else if (spec.market === 'total') {
          if (o.point == null || !['Over', 'Under'].includes(o.name)) continue;
          line = Number(o.point);
          selection = o.name;
          ({ f: fair, source } = fairFor('total', o.name, line));
        } else {
          player = o.description;
          if (!player) continue;
          propSide = o.name === 'Yes' ? 'Over' : o.name === 'No' ? 'Under' : o.name;
          if (!['Over', 'Under'].includes(propSide)) continue;
          line = o.point != null ? Number(o.point) : 0.5; // anytime TD: "1+"
          selection = propSelection(player, spec.propKey, propSide);
          fair = propFair(ladders.get(`${nameKey(player)}|${spec.propKey}`) ?? [], line, propSide);
        }
        const p = actionProb(fair);
        if (p == null) continue;
        const odds = Math.round(o.price);
        const implied = impliedProbability(odds);
        rows.push({
          book: book.key, market: spec.market, selection, line, odds, fair: p, implied, edge: p - implied,
          ref: `${book.key}|${m.key}|${norm(player ?? o.name)}|${o.name}|${line}`,
          propKey: spec.propKey ?? null, player, propSide, source,
        });
      }
    }
  }
  // Same line can appear in both the main and alternate market: keep the better price.
  const best = new Map();
  for (const r of rows) {
    const k = `${r.book}|${r.market}|${r.selection}|${r.line}`;
    const cur = best.get(k);
    if (!cur || r.odds > cur.odds) best.set(k, r);
  }
  return [...best.values()].map((r) => ({ ...r, ref: `${r.book}|${r.market}|${norm(r.selection)}|${r.line}` }));
}

async function oddsApi(path, params) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('apiKey', process.env.ODDS_API_KEY);
  for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const remaining = res.headers.get('x-requests-remaining');
  if (res.status === 404) return { data: null, remaining: remaining == null ? null : Number(remaining) };
  if (res.status === 422) throw new Error(`Odds API rejected the request (422): ${(await res.text()).slice(0, 200)}`);
  if (!res.ok) throw new Error(`Odds API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { data: await res.json(), remaining: remaining == null ? null : Number(remaining) };
}

export async function listEvents(sport = 'nfl') {
  return (await oddsApi(`/sports/${SPORTS[sport].oddsKey}/events`)).data ?? [];
}

// Game-day "fast" pulls: just spreads/totals (4 credits) for catching stale lines; "full" pulls add props.
export const FAST_MARKETS = ['spreads', 'totals', 'alternate_spreads', 'alternate_totals'];

/** One request for every book (plus Pinnacle as the fair reference) on one game. */
export async function fetchEventOdds(eventId, sport = 'nfl', { fast = false } = {}) {
  const markets = fast ? FAST_MARKETS
    : (process.env.ODDS_API_MARKETS || DEFAULT_MARKETS.join(',')).split(',').filter((k) => BOOK_MARKETS[k]);
  return oddsApi(`/sports/${SPORTS[sport].oddsKey}/events/${eventId}/odds`, {
    bookmakers: [...BOOKS.map((b) => b.key), 'pinnacle'].join(','),
    markets: markets.join(','),
    oddsFormat: 'american',
  });
}

/** Score Kalshi's own rungs against the fitted fair price (so Kalshi can be someone's "book" too). */
export function scoreKalshiAsBook(kalshi, game, models) {
  const fit = fitGame(kalshi.filter((e) => e.kind !== 'prop'), game, models);
  const rows = [];
  for (const e of kalshi) {
    if (e.kind === 'prop') continue;
    for (const side of ['yes', 'no']) {
      const ask = side === 'yes' ? e.yesAsk : e.noAsk;
      if (!(ask > 0 && ask < 1)) continue;
      const cost = ask + 0.07 * ask * (1 - ask);
      const oddsNum = cost >= 0.5 ? -Math.round((100 * cost) / (1 - cost)) : Math.round((100 * (1 - cost)) / cost);
      let selection, line, fair;
      if (e.kind === 'spread') {
        const opp = e.team === game.away ? game.home : game.away;
        selection = side === 'yes' ? e.team : opp;
        line = side === 'yes' ? -e.strike : e.strike;
        fair = fit.spread(selection, line);
      } else {
        selection = side === 'yes' ? 'Over' : 'Under';
        line = e.strike;
        fair = fit.total(selection, line);
      }
      const p = actionProb(fair);
      if (p == null) continue;
      const implied = impliedProbability(oddsNum);
      rows.push({ book: 'kalshi', market: e.kind, selection, line, odds: oddsNum, fair: p, implied, edge: p - implied,
        ref: `kalshi|${e.ticker}|${side}`, propKey: null, player: null, propSide: null });
    }
  }
  return rows;
}

export { teamsMatch };
