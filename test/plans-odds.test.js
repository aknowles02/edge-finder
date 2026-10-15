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
