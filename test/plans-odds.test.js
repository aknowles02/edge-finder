import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAccess, can } from '../shared/plans.js';
import { closingLineValue, fairOdds, summarizeTracked } from '../shared/edge.js';
import { matchEvent, matchPrice, refreshIntervalMs } from '../server/odds.js';

const day = 86_400_000;

test('trial grants the core board only, then expires', () => {
  const now = new Date('2026-10-15T12:00:00Z');
  const trial = resolveAccess({ trial_ends_at: new Date(now.getTime() + 3 * day) }, now);
  assert.equal(trial.plan, 'trial');
  assert.ok(can(trial, 'board'));
  assert.ok(!can(trial, 'history'));
  assert.equal(resolveAccess({ trial_ends_at: new Date(now.getTime() - day) }, now).plan, 'none');
});

test('active subscription grants Pro; cancelled one falls back', () => {
  const now = new Date();
  const pro = resolveAccess({ subscription_status: 'active', plan_id: 'pro', current_period_end: new Date(now.getTime() + 20 * day) }, now);
  assert.equal(pro.plan, 'pro');
  assert.ok(can(pro, 'reports'));
  assert.equal(resolveAccess({ subscription_status: 'canceled', plan_id: 'pro' }, now).plan, 'none');
});

test('fair odds and CLV', () => {
  assert.equal(fairOdds(0.75), -300);
  assert.equal(fairOdds(0.4), 150);
  // Locked -300 (75%), closed -350 (77.8%): market moved toward us.
  assert.ok(closingLineValue(-300, -350) > 0);
  assert.ok(closingLineValue(-300, -250) < 0);
  const s = summarizeTracked([{ qualifiedOdds: -300, odds: -500, result: 'W', closingOdds: -350 }]);
  assert.ok(Math.abs(s.units - 1 / 3) < 1e-9, 'graded at locked price, not current');
  assert.equal(s.beatClose, 1);
});

test('refresh cadence speeds up toward kickoff', () => {
  const now = Date.now();
  assert.ok(refreshIntervalMs(now + 2 * 3600_000, now) < refreshIntervalMs(now + 12 * 3600_000, now));
  assert.ok(refreshIntervalMs(now + 12 * 3600_000, now) < refreshIntervalMs(now + 5 * day, now));
});

test('matches feed events and alt-line prices', () => {
  const game = { away: 'BUF', home: 'MIA' };
  const events = [{ id: 'e1', away_team: 'Buffalo Bills', home_team: 'Miami Dolphins' }];
  assert.equal(matchEvent('nfl', game, events).id, 'e1');
  const odds = { bookmakers: [{ key: 'draftkings', markets: [
    { key: 'alternate_spreads', outcomes: [{ name: 'Buffalo Bills', point: 2.5, price: -320 }, { name: 'Miami Dolphins', point: -2.5, price: 240 }] },
    { key: 'alternate_totals', outcomes: [{ name: 'Over', point: 37.5, price: -365 }] },
  ] }] };
  assert.equal(matchPrice('nfl', { market: 'spread', selection: 'BUF', line: 2.5 }, game, odds), -320);
  assert.equal(matchPrice('nfl', { market: 'total', selection: 'Over', line: 37.5 }, game, odds), -365);
  assert.equal(matchPrice('nfl', { market: 'spread', selection: 'BUF', line: 3.5 }, game, odds), null);
});

import { canonTeam, spreadHitRate, teamLogs, totalHitRate, qbChangeFlag } from '../shared/hitrates.js';
import { betsFromEntry, costToAmerican, effectiveCost, parseEventTicker, teamsMatch } from '../server/kalshi.js';
import { easternToUtc } from '../server/nflverse.js';

test('hit rates pool both teams from the right side', () => {
  const games = [
    { season: 2025, week: 1, gameday: '2025-09-07', away: 'BUF', home: 'MIA', awayScore: 24, homeScore: 20, awayQb: 'A', homeQb: 'T' },
    { season: 2025, week: 2, gameday: '2025-09-14', away: 'BUF', home: 'NYJ', awayScore: 10, homeScore: 13, awayQb: 'A', homeQb: 'X' },
  ];
  const logs = teamLogs(games, 2025);
  // BUF +2.5: BUF games margins +4 (cover), −3 (no). MIA games: margin −4; MIA "fails to cover" −2.5 → hit.
  const r = spreadHitRate(logs, 'BUF', 'MIA', 2.5);
  assert.equal(r.n, 3);
  assert.equal(r.rate, 2 / 3);
  assert.equal(totalHitRate(logs, 'BUF', 'MIA', 30.5, 'Over').rate, 2 / 3);
  assert.equal(qbChangeFlag(logs, 'BUF'), null);
});

test('Kalshi parsing, fee and bet expansion', () => {
  assert.deepEqual(parseEventTicker('KXNFLSPREAD-26OCT19WASSF'), { date: '2026-10-19', teams: 'WASSF' });
  assert.ok(teamsMatch('HOUJAC', 'HOU', canonTeam('JAX')));
  assert.ok(teamsMatch('ARILAR', 'ARI', canonTeam('LA')));
  assert.ok(effectiveCost(0.75) > 0.75);
  assert.equal(costToAmerican(0.75), -300);
  const bets = betsFromEntry({ ticker: 'T', kind: 'spread', team: 'WAS', strike: 6.5, yesAsk: 0.1, noAsk: 0.91 }, 'WAS', 'SF');
  assert.deepEqual(bets.map((b) => `${b.selection} ${b.line} ${b.side}`), ['WAS -6.5 yes', 'SF 6.5 no']);
});

test('Eastern kickoff converts to UTC across DST', () => {
  assert.equal(easternToUtc('2026-10-18', '13:00'), '2026-10-18T17:00:00.000Z');
  assert.equal(easternToUtc('2026-12-06', '13:00'), '2026-12-06T18:00:00.000Z');
});
