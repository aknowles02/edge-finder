import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionProb, fitGame, propFair, survivalFrom } from '../server/fair.js';
import { bookCadenceMs, scoreEventOdds } from '../server/books.js';

// Synthetic "history": residuals spread evenly over -20..20 (stand-in for nflverse).
const res = Array.from({ length: 4001 }, (_, i) => -20 + i / 100);
const models = { margin: survivalFrom(res), total: survivalFrom(res) };
const S = models.margin;
const game = { away: 'BUF', home: 'MIA', commence_time: '2026-10-18T17:00:00Z' };

// Build a Kalshi ladder consistent with MIA favored by 3 and a total of 44.
function ladder(mu = 3, tau = 44) {
  const out = [];
  for (const k of [0.5, 2.5, 4.5, 6.5, 9.5]) {
    const pHome = S(k - mu), pAway = 1 - S(-k - mu);
    out.push({ kind: 'spread', team: 'MIA', strike: k, yesBid: pHome - 0.01, yesAsk: pHome + 0.01, noAsk: 1 - pHome + 0.01, ticker: `S-MIA${k}` });
    out.push({ kind: 'spread', team: 'BUF', strike: k, yesBid: pAway - 0.01, yesAsk: pAway + 0.01, noAsk: 1 - pAway + 0.01, ticker: `S-BUF${k}` });
  }
  for (const k of [38.5, 41.5, 44.5, 47.5, 50.5]) {
    const p = models.total(k - tau);
    out.push({ kind: 'total', strike: k, yesBid: p - 0.01, yesAsk: p + 0.01, noAsk: 1 - p + 0.01, ticker: `T${k}` });
  }
  return out;
}

test('fair fit recovers the market center and prices any line', () => {
  const fit = fitGame(ladder(), game, models);
  assert.ok(Math.abs(fit.mu - 3) < 0.3, `mu ${fit.mu}`);
  assert.ok(Math.abs(fit.tau - 44) < 0.3, `tau ${fit.tau}`);
  const homeMinus3 = fit.spread('MIA', -3); // whole number: push possible
  const awayPlus3 = fit.spread('BUF', 3);
  assert.ok(homeMinus3.push > 0);
  assert.ok(Math.abs(homeMinus3.win - awayPlus3.win) < 0.02, 'symmetric around the center');
  const o = fit.total('Over', 44.5), u = fit.total('Under', 44.5);
  assert.ok(Math.abs(o.win + u.win - 1) < 1e-9);
  // Uniform residuals on [-20, 20]: P(M < 10.5 | mu = 3) = (7.5 + 20) / 40 = 0.6875
  assert.ok(Math.abs(actionProb(fit.spread('BUF', 10.5)) - 0.6875) < 0.03);
});

test('prop fair interpolates the player ladder monotonically', () => {
  const rungs = [{ strike: 199.5, yesBid: 0.79, yesAsk: 0.81 }, { strike: 249.5, yesBid: 0.49, yesAsk: 0.51 }, { strike: 299.5, yesBid: 0.19, yesAsk: 0.21 }];
  assert.equal(propFair(rungs, 249.5, 'Over').win, 0.5);
  const mid = propFair(rungs, 224.5, 'Over').win;
  assert.ok(mid > 0.5 && mid < 0.8, `${mid}`);
  assert.ok(Math.abs(propFair(rungs, 224.5, 'Under').win - (1 - mid)) < 1e-9);
  assert.equal(propFair(rungs, 350.5, 'Over'), null, 'no extrapolation past the ladder');
});

test('scores a sportsbook payload against Kalshi fair value', () => {
  const kalshi = ladder();
  const payload = { bookmakers: [{ key: 'draftkings', markets: [
    { key: 'alternate_spreads', outcomes: [{ name: 'Buffalo Bills', point: 6.5, price: -400 }, { name: 'Miami Dolphins', point: -6.5, price: 280 }] },
    { key: 'spreads', outcomes: [{ name: 'Buffalo Bills', point: 6.5, price: -380 }] },
    { key: 'alternate_totals', outcomes: [{ name: 'Over', point: 37.5, price: -500 }] },
  ] }, { key: 'not_a_book_we_list', markets: [] }] };
  const rows = scoreEventOdds(payload, game, kalshi, models);
  const buf = rows.find((r) => r.selection === 'BUF' && r.line === 6.5);
  assert.equal(buf.odds, -380, 'keeps the better of main and alternate price');
  assert.equal(buf.book, 'draftkings');
  assert.ok(Math.abs(buf.edge - (buf.fair - buf.implied)) < 1e-12);
  assert.ok(rows.some((r) => r.market === 'total' && r.selection === 'Over'));
});

test('sportsbook cadence tightens toward kickoff', () => {
  const now = Date.now();
  assert.ok(bookCadenceMs(now + 2 * 3600e3, now) < bookCadenceMs(now + 30 * 3600e3, now));
});
