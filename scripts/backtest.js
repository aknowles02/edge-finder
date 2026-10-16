// Point-in-time backtest of the live method on a past season, using Kalshi's archived alt ladders.
//   node scripts/backtest.js 2025      → writes data/backtest-2025.json
//
// No look-ahead: each week's hit rates use only the prior season + games played before that week,
// prices are Kalshi's ask one hour before kickoff (fee included), and grading uses Kalshi's own settlement.
// Spreads and totals only (player props weren't listed on Kalshi for the full season).

import { mkdir, writeFile } from 'node:fs/promises';
import { blendHitRate, impliedProbability } from '../shared/edge.js';
import { spreadHitRate, teamLogs, totalHitRate } from '../shared/hitrates.js';
import { betsFromEntry, costToAmerican, effectiveCost, parseEventTicker, teamsMatch } from '../server/kalshi.js';
import { loadGames } from '../server/nflverse.js';
import { canonTeam } from '../shared/hitrates.js';

const SEASON = Number(process.argv[2] || 2025);
const API = 'https://api.elections.kalshi.com/trade-api/v2';
const WINDOW = { min: -500, max: -200 }; // same qualifying window as the live board
const MIN_IMPLIED = impliedProbability(WINDOW.max); // a rung can't qualify unless its hit rate beats this

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url) {
  for (let i = 0; i < 5; i++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(500 * 2 ** i); continue; }
    throw new Error(`${res.status} ${url}`);
  }
  throw new Error(`gave up on ${url}`);
}

async function archived(series) {
  const out = [];
  let cursor = '';
  do {
    const d = await get(`${API}/historical/markets?series_ticker=${series}&limit=1000${cursor ? `&cursor=${cursor}` : ''}`);
    out.push(...(d.markets ?? []));
    cursor = d.markets?.length ? d.cursor : '';
  } while (cursor);
  return out;
}

/** Ask prices one hour before kickoff from hourly candles: YES ask, and NO ask = 1 − YES bid. */
async function pregamePrice(ticker, kickoffMs) {
  const end = Math.floor(kickoffMs / 1000) - 3600;
  const d = await get(`${API}/historical/markets/${ticker}/candlesticks?start_ts=${end - 6 * 3600}&end_ts=${end}&period_interval=60`);
  const c = (d.candlesticks ?? []).filter((x) => x.yes_ask?.close != null || x.yes_bid?.close != null).at(-1);
  if (!c) return null;
  const yesAsk = c.yes_ask?.close != null ? Number(c.yes_ask.close) : null;
  const yesBid = c.yes_bid?.close != null ? Number(c.yes_bid.close) : null;
  return { yesAsk, noAsk: yesBid != null ? 1 - yesBid : null };
}

const games = await loadGames({ fresh: true });
const season = games.filter((g) => g.season === SEASON && g.type === 'REG' && g.awayScore != null);
console.log(`${season.length} ${SEASON} regular-season games`);

const raw = [];
for (const [kind, series] of [['spread', 'KXNFLSPREAD'], ['total', 'KXNFLTOTAL']]) {
  const ms = await archived(series);
  console.log(`${series}: ${ms.length} archived markets`);
  for (const m of ms) {
    const ev = parseEventTicker(m.event_ticker);
    if (!ev || m.floor_strike == null || !['yes', 'no'].includes(m.result)) continue;
    const suffix = m.ticker.slice(m.event_ticker.length + 1);
    raw.push({ ticker: m.ticker, eventTicker: m.event_ticker, date: ev.date, teams: ev.teams, kind,
      team: kind === 'spread' ? canonTeam(suffix.replace(/\d+$/, '')) : null, strike: Number(m.floor_strike), result: m.result });
  }
}

// Pass 1: hit rates for every rung (no prices yet) to find the markets worth pricing.
const logsPrior = teamLogs(games, SEASON - 1);
const candidates = [];
for (const g of season) {
  const logsToDate = teamLogs(games, SEASON, { before: g.gameday });
  const entries = raw.filter((e) => teamsMatch(e.teams, g.away, g.home) && Math.abs(new Date(e.date) - new Date(g.gameday)) <= 86_400_000);
  for (const e of entries) {
    // Placeholder asks just to expand both sides; real prices come in pass 2.
    for (const b of betsFromEntry({ ...e, yesAsk: 0.5, noAsk: 0.5 }, g.away, g.home)) {
      const opp = b.selection === g.away ? g.home : g.away;
      const r1 = b.market === 'spread' ? spreadHitRate(logsPrior, b.selection, opp, b.line) : totalHitRate(logsPrior, g.away, g.home, b.line, b.selection);
      const r2 = b.market === 'spread' ? spreadHitRate(logsToDate, b.selection, opp, b.line) : totalHitRate(logsToDate, g.away, g.home, b.line, b.selection);
      const blended = blendHitRate(r1.rate, r1.n, r2.rate, r2.n);
      if (blended == null || blended <= MIN_IMPLIED) continue;
      candidates.push({ g, e, b, blended, sample: r1.n + r2.n });
    }
  }
}
const tickers = [...new Set(candidates.map((c) => c.e.ticker))];
console.log(`${candidates.length} candidate sides across ${tickers.length} markets; pricing…`);

// Pass 2: pre-game prices (small concurrency to respect Kalshi's rate limits).
const prices = new Map();
let done = 0;
const kickoffOf = new Map(candidates.map((c) => [c.e.ticker, new Date(c.g.kickoff).getTime()]));
const queue = [...tickers];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const t = queue.shift();
    try { prices.set(t, await pregamePrice(t, kickoffOf.get(t))); } catch (err) { console.warn(t, err.message); }
    if (++done % 250 === 0) console.log(`  priced ${done}/${tickers.length}`);
  }
}));

const rows = [];
for (const { g, e, b, blended, sample } of candidates) {
  const p = prices.get(e.ticker);
  const ask = b.side === 'yes' ? p?.yesAsk : p?.noAsk;
  if (!(ask > 0 && ask < 1)) continue;
  const odds = costToAmerican(effectiveCost(ask));
  if (odds == null || odds < WINDOW.min || odds > WINDOW.max) continue;
  const implied = impliedProbability(odds);
  const edge = blended - implied;
  if (edge <= 0) continue;
  rows.push({
    week: g.week, game: `${g.away} @ ${g.home}`, away: g.away, home: g.home, kickoff: g.kickoff,
    market: b.market, selection: b.selection, line: b.line, odds, prob: Number(blended.toFixed(4)),
    edge: Number(edge.toFixed(4)), sample, ref: e.ticker, side: b.side,
    result: (e.result === b.side) ? 'W' : 'L',
  });
}
rows.sort((a, b) => a.week - b.week || b.edge - a.edge);

const w = rows.filter((r) => r.result === 'W').length;
const units = rows.reduce((u, r) => u + (r.result === 'W' ? 100 / -r.odds : -1), 0);
const summary = { season: SEASON, bets: rows.length, wins: w, losses: rows.length - w, units: Number(units.toFixed(2)), roi: Number((units / rows.length).toFixed(4)) };
console.log(summary);

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(new URL(`../data/backtest-${SEASON}.json`, import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows }));
console.log(`wrote data/backtest-${SEASON}.json`);
