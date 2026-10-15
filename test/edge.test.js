import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bestPerSide, blendHitRate, formatRecord, gradeBet, impliedProbability, parseBoardInput, payout, summarize,
} from '../shared/edge.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('implied probability from American odds', () => {
  close(impliedProbability(-300), 0.75);
  close(impliedProbability(-500), 500 / 600);
  close(impliedProbability(150), 0.4);
  assert.throws(() => impliedProbability(-50));
});

test('blend is 75/25 and falls back to the season that has data', () => {
  close(blendHitRate(0.8, 17, 0.6, 3), 0.75);
  close(blendHitRate(0.8, 17, null, null), 0.8);
  close(blendHitRate(0.8, 17, 0.5, 0), 0.8);
  assert.equal(blendHitRate(null, null, null, null), null);
});

test('payout and summary match the headline example', () => {
  close(payout(-250), 0.4);
  const bets = [{ odds: -300, result: 'W' }, { odds: -300, result: 'L' }, { odds: -300, result: 'P' }, { odds: -300, result: null }];
  const s = summarize(bets);
  assert.equal(s.wins, 1); assert.equal(s.losses, 1); assert.equal(s.pushes, 1); assert.equal(s.pending, 1);
  close(s.units, 1 / 3 - 1);
  assert.equal(formatRecord({ wins: 144, losses: 26, pushes: 0, units: 13.5, winRate: 144 / 170, roi: 13.5 / 170 }),
    '144–26 (84.7%), +13.5u (+7.9% ROI)');
});

test('parses pasted CSV and TSV, scoring edge', () => {
  const { rows, errors } = parseBoardInput(
    'Game\tMarket\tSelection\tLine\tOdds\tHit 2025\tN 2025\tHit 2026\tN 2026\n' +
    'BUF @ MIA\tspread\tbuf\t+2.5\t−300\t86%\t17\t67%\t3\n' +
    'BUF @ MIA\ttotals\to\t37.5\t-360\t0.88\t17\t1\t3\n' +
    'BUF @ MIA\tspread\tNYJ\t+2.5\t-300\t0.8\t17\t0.6\t3',
  );
  assert.equal(rows.length, 2);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].line, 4);
  assert.equal(rows[0].selection, 'BUF');
  assert.equal(rows[0].odds, -300);
  close(rows[0].edge, 0.75 * 0.86 + 0.25 * 0.67 - 0.75);
  assert.equal(rows[1].selection, 'Over');
  assert.equal(rows[0].sampleSize, 20);
});

test('grades spreads and totals, including pushes', () => {
  const game = { away: 'BUF', home: 'MIA', awayScore: 17, homeScore: 20 };
  assert.equal(gradeBet({ market: 'spread', selection: 'BUF', line: 3.5 }, game), 'W');
  assert.equal(gradeBet({ market: 'spread', selection: 'BUF', line: 3 }, game), 'P');
  assert.equal(gradeBet({ market: 'spread', selection: 'MIA', line: -3.5 }, game), 'L');
  assert.equal(gradeBet({ market: 'total', selection: 'Over', line: 36.5 }, game), 'W');
  assert.equal(gradeBet({ market: 'total', selection: 'Under', line: 36.5 }, game), 'L');
  assert.equal(gradeBet({ market: 'prop', selection: 'x', line: 1 }, game), null);
});

test('best line per side keeps the highest edge', () => {
  const bets = [
    { game: 'A @ B', market: 'spread', selection: 'A', edge: 0.05 },
    { game: 'A @ B', market: 'spread', selection: 'A', edge: 0.09 },
    { game: 'A @ B', market: 'total', selection: 'Over', edge: 0.02 },
  ];
  assert.deepEqual(bestPerSide(bets).map((b) => b.edge), [0.09, 0.02]);
});
