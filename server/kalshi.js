// Kalshi public market data (no API key needed for reads).
// NFL alt ladders live in two series:
//   KXNFLSPREAD-26OCT19WASSF-WAS7  "Washington wins by over 6.5"  (floor_strike 6.5)
//   KXNFLTOTAL-26OCT19WASSF-72     "Over 71.5 points"             (floor_strike 71.5)
// Every market is two bets: YES and NO.

import { canonTeam } from '../shared/hitrates.js';

const API = 'https://api.elections.kalshi.com/trade-api/v2';
export const KALSHI_SERIES = { spread: 'KXNFLSPREAD', total: 'KXNFLTOTAL' };

// Kalshi's taker fee is 0.07 × P × (1 − P) per contract (rounded up per order). We fold it into the price
// so edge and ROI reflect what you actually pay.
const FEE_RATE = 0.07;
export const effectiveCost = (ask) => ask + FEE_RATE * ask * (1 - ask);

/** Probability cost (0–1) → American odds. */
export function costToAmerican(p) {
  if (!(p > 0 && p < 1)) return null;
  return p >= 0.5 ? -Math.round((100 * p) / (1 - p)) : Math.round((100 * (1 - p)) / p);
}

const MONTHS = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "KXNFLSPREAD-26OCT19WASSF" → { date: '2026-10-19', teams: 'WASSF' } */
export function parseEventTicker(ticker) {
  const m = /^[A-Z]+-(\d{2})([A-Z]{3})(\d{2})([A-Z]+)$/.exec(ticker);
  if (!m) return null;
  const date = new Date(Date.UTC(2000 + Number(m[1]), MONTHS[m[2]], Number(m[3]))).toISOString().slice(0, 10);
  return { date, teams: m[4] };
}

/** Does "WASSF" match this pair of teams (either order, Kalshi or canonical codes)? */
export function teamsMatch(concat, a, b) {
  const codes = (t) => [...new Set([t, ...Object.entries({ JAC: 'JAX', LA: 'LAR', WSH: 'WAS' }).filter(([, v]) => v === t).map(([k]) => k)])];
  for (const x of codes(a)) for (const y of codes(b)) if (concat === x + y || concat === y + x) return true;
  return false;
}

const dollars = (v) => (v == null || v === '' ? null : Number(v));

function toLadderEntry(m, kind) {
  const ev = parseEventTicker(m.event_ticker);
  if (!ev || m.floor_strike == null) return null;
  const suffix = m.ticker.slice(m.event_ticker.length + 1);
  return {
    ticker: m.ticker,
    eventTicker: m.event_ticker,
    date: ev.date,
    teams: ev.teams,
    kind,
    team: kind === 'spread' ? canonTeam(suffix.replace(/\d+$/, '')) : null,
    strike: Number(m.floor_strike),
    yesAsk: dollars(m.yes_ask_dollars),
    noAsk: dollars(m.no_ask_dollars),
    yesBid: dollars(m.yes_bid_dollars),
    noBid: dollars(m.no_bid_dollars),
    volume: dollars(m.volume_fp) ?? 0,
    closeTime: m.close_time,
  };
}

async function fetchJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Kalshi ${res.status} on ${url.split('?')[0]}`);
  return res.json();
}

/** All open markets for one kind ('spread' | 'total'), following pagination. */
export async function fetchLadder(kind) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < 20; page++) {
    const url = `${API}/markets?series_ticker=${KALSHI_SERIES[kind]}&status=open&limit=1000${cursor ? `&cursor=${cursor}` : ''}`;
    const data = await fetchJson(url);
    for (const m of data.markets ?? []) {
      const e = toLadderEntry(m, kind);
      if (e) out.push(e);
    }
    cursor = data.cursor;
    if (!cursor || !(data.markets ?? []).length) break;
  }
  return out;
}

export async function fetchAllLadders() {
  const [spreads, totals] = await Promise.all([fetchLadder('spread'), fetchLadder('total')]);
  return [...spreads, ...totals];
}

/**
 * Expand a market into its two bets for a game (away @ home).
 * Spread "T wins by over k": YES = T −k, NO = opponent +k. Total "over k": YES = Over k, NO = Under k.
 */
export function betsFromEntry(e, away, home) {
  const sides = [];
  const push = (side, ask, bid, selection, line, market) => {
    if (ask == null || ask <= 0 || ask >= 1) return; // no offer on this side
    sides.push({ ref: e.ticker, side, ask, bid, selection, line, market });
  };
  if (e.kind === 'spread') {
    const opp = e.team === away ? home : e.team === home ? away : null;
    if (!opp) return [];
    push('yes', e.yesAsk, e.yesBid, e.team, -e.strike, 'spread');
    push('no', e.noAsk, e.noBid, opp, e.strike, 'spread');
  } else {
    push('yes', e.yesAsk, e.yesBid, 'Over', e.strike, 'total');
    push('no', e.noAsk, e.noBid, 'Under', e.strike, 'total');
  }
  return sides;
}

/** Current ask for one side of a known market, from a fetched ladder index. */
export function askFor(index, ref, side) {
  const e = index.get(ref);
  if (!e) return null;
  return side === 'yes' ? e.yesAsk : e.noAsk;
}
