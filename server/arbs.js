// Live arbitrage scanner: opposite sides of the same number at different books (sportsbooks + Kalshi)
// whose combined prices guarantee a profit. Research tool while we measure how often real ones appear.
import { teamName } from '../shared/sports.js';
import { BOOKS } from '../shared/books.js';
import { config } from './config.js';
import { query } from './db.js';
import { sendAdminAlert } from './email.js';

const dec = (a) => (a > 0 ? 1 + a / 100 : 1 + 100 / -a);
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const ALERT_MARGIN = Number(process.env.ARB_ALERT_MARGIN || 0.01);
const userBooks = new Set(BOOKS.map((b) => b.key));

/** All arbs in one game's prices. `kalshi`: ladder entries (fee-adjusted). Returns [{market, legA, legB, margin, books}] */
export function findArbs(eventOdds, kalshi, game, sport = 'nfl') {
  const code = (n) => (norm(n) === norm(teamName(sport, game.away)) ? game.away : norm(n) === norm(teamName(sport, game.home)) ? game.home : null);
  const best = new Map();
  const add = (book, market, side, line, d) => {
    const k = `${market}|${side}|${line}`;
    if (!best.has(k) || d > best.get(k).d) best.set(k, { book, market, side, line, d });
  };
  for (const b of eventOdds?.bookmakers ?? []) {
    if (!userBooks.has(b.key)) continue; // Pinnacle isn't bettable in the US
    for (const m of b.markets ?? []) {
      const isS = m.key === 'spreads' || m.key === 'alternate_spreads';
      const isT = m.key === 'totals' || m.key === 'alternate_totals';
      if (!isS && !isT) continue;
      for (const o of m.outcomes ?? []) {
        const side = isS ? code(o.name) : o.name;
        if (!side || o.point == null || !Number.isFinite(o.price)) continue;
        add(b.key, isS ? 'spread' : 'total', side, Number(o.point), dec(o.price));
      }
    }
  }
  const kd = (ask) => (ask > 0.01 && ask < 0.99 ? 1 / (ask + 0.07 * ask * (1 - ask)) : null);
  for (const e of kalshi) {
    if (e.kind === 'prop') continue;
    const yes = kd(e.yesAsk), no = kd(e.noAsk);
    if (e.kind === 'spread') {
      const opp = e.team === game.away ? game.home : game.away;
      if (yes) add('kalshi', 'spread', e.team, -e.strike, yes);
      if (no) add('kalshi', 'spread', opp, e.strike, no);
    } else {
      if (yes) add('kalshi', 'total', 'Over', e.strike, yes);
      if (no) add('kalshi', 'total', 'Under', e.strike, no);
    }
  }
  const out = [];
  for (const a of best.values()) {
    const oppSide = a.market === 'spread' ? (a.side === game.away ? game.home : game.away) : a.side === 'Over' ? 'Under' : 'Over';
    const oppLine = a.market === 'spread' ? -a.line : a.line;
    const b = best.get(`${a.market}|${oppSide}|${oppLine}`);
    if (!b || a.book === b.book || a.side > b.side) continue; // each pair once
    const margin = 1 - (1 / a.d + 1 / b.d);
    if (margin <= 0) continue;
    const leg = (x) => `${x.side} ${x.market === 'spread' && x.line > 0 ? '+' : ''}${x.line} @ ${x.book} (${x.d.toFixed(3)})`;
    out.push({ key: `${game.label ?? `${game.away} @ ${game.home}`}|${a.market}|${Math.abs(a.line)}|${a.book}|${b.book}`, market: a.market, legA: leg(a), legB: leg(b), margin,
      stakeA: (1 / a.d) / (1 / a.d + 1 / b.d) });
  }
  return out.sort((x, y) => y.margin - x.margin);
}

/** Record arbs (first/last seen, best margin) and email admins each 1%+ arb once. Returns count found. */
export async function recordArbs(g, list) {
  if (!list.length) return 0;
  await query(
    `insert into arbs (key, game_id, game_label, leg_a, leg_b, margin, best_margin)
     select x.key, $1, $2, x."legA", x."legB", x.margin, x.margin
       from jsonb_to_recordset($3::jsonb) as x(key text, "legA" text, "legB" text, margin numeric)
     on conflict (key) do update set margin = excluded.margin, leg_a = excluded.leg_a, leg_b = excluded.leg_b,
       best_margin = greatest(arbs.best_margin, excluded.margin), last_seen = now()`,
    [g.id, g.label, JSON.stringify(list)],
  );
  const admins = [...config.adminEmails()];
  if (!admins.length) return list.length;
  const { rows } = await query(
    `update arbs set alerted_at = now() where game_id = $1 and alerted_at is null and margin >= $2 and last_seen > now() - interval '5 minutes'
     returning leg_a, leg_b, margin`, [g.id, ALERT_MARGIN]);
  if (rows.length) {
    await sendAdminAlert(admins, `Arbitrage: ${rows.length} in ${g.label}`,
      rows.map((r) => `+${(r.margin * 100).toFixed(2)}% guaranteed: ${r.leg_a}  +  ${r.leg_b}`));
  }
  return list.length;
}
