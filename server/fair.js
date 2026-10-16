// Fair prices from Kalshi. Kalshi's NFL ladders are efficiently priced (backtested 2025-26: its implied
// probabilities match outcomes almost exactly), so we use them as the sharp reference that sportsbook
// lines are measured against.
//
//   Spreads/totals: fit the game's expected margin/total to the whole ladder using the empirical shape
//   of NFL results (key numbers), which prices ANY line, including ones Kalshi doesn't list.
//   Props: interpolate the player's own Kalshi ladder for that stat.

const MIN_OBS = 4;
const MAX_QUOTE_SPREAD = 0.1;

/** Smoothed survival function P(residual > x) from historical residuals. */
export function survivalFrom(residuals) {
  const sorted = [...residuals].sort((a, b) => a - b);
  const n = sorted.length;
  const cdfAt = (x) => { let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] <= x) lo = m + 1; else hi = m; } return lo / n; };
  const cache = new Map();
  return (x) => {
    const key = Math.round(x * 40);
    let v = cache.get(key);
    if (v === undefined) { v = 1 - (cdfAt(x - 0.5) + 2 * cdfAt(x) + cdfAt(x + 0.5)) / 4; cache.set(key, v); }
    return v;
  };
}

/** Residual shapes (actual − closing line) from completed regular-season games before `season`. */
export function residualModels(games, season, since = season - 15) {
  const m = [], t = [];
  for (const g of games) {
    if (g.type !== 'REG' || g.season >= season || g.season < since || g.awayScore == null) continue;
    if (g.spreadLine != null) m.push(g.homeScore - g.awayScore - g.spreadLine);
    if (g.totalLine != null) t.push(g.homeScore + g.awayScore - g.totalLine);
  }
  if (m.length < 500 || t.length < 500) throw new Error('Not enough historical games to model NFL outcomes');
  return { margin: survivalFrom(m), total: survivalFrom(t) };
}

const mid = (e) => (e.yesAsk != null && e.yesBid != null && e.yesAsk - e.yesBid <= MAX_QUOTE_SPREAD ? (e.yesAsk + e.yesBid) / 2 : null);

function fitCenter(obs, prob, lo, hi) {
  let best = (lo + hi) / 2, bestErr = Infinity;
  for (let pass = 0, step = 1, a = lo, b = hi; pass < 3; pass++, step /= 8) {
    for (let x = a; x <= b; x += step) {
      let e = 0;
      for (const o of obs) { const d = prob(o, x) - o.p; e += o.w * d * d; }
      if (e < bestErr) { bestErr = e; best = x; }
    }
    a = best - step; b = best + step;
  }
  return best;
}

/**
 * Fit one game from its Kalshi ladder entries (see kalshi.js). Returns fair-probability functions, or
 * null for a market with too few liquid rungs.
 */
export function fitGame(entries, { away, home }, models) {
  const S_M = models.margin, S_T = models.total;
  const spreadObs = [], totalObs = [];
  for (const e of entries) {
    const p = mid(e);
    if (p == null || p < 0.04 || p > 0.96) continue;
    const w = 1 / (Math.max(0.01, e.yesAsk - e.yesBid) + 0.02);
    if (e.kind === 'spread') spreadObs.push({ k: e.strike, home: e.team === home, p, w });
    else if (e.kind === 'total') totalObs.push({ k: e.strike, p, w });
  }
  // Kalshi "T wins by > k":  T home → P(M > k);  T away → P(M < −k).  M = home margin.
  const spreadProb = (o, mu) => (o.home ? S_M(o.k - mu) : 1 - S_M(-o.k - mu));
  const totalProb = (o, tau) => S_T(o.k - tau);
  const mu = spreadObs.length >= MIN_OBS ? fitCenter(spreadObs, spreadProb, -30, 30) : null;
  const tau = totalObs.length >= MIN_OBS ? fitCenter(totalObs, totalProb, 25, 65) : null;

  /** P(X > x) for an integer-valued outcome; handles whole-number lines (pushes). */
  const over = (S, center, x) => {
    if (Number.isInteger(x)) {
      const win = S(x + 0.5 - center);
      const push = S(x - 0.5 - center) - win;
      return { win, push };
    }
    return { win: S(x - center), push: 0 };
  };

  return {
    mu, tau,
    /** Bet `team` at spread `line` (team covers when margin + line > 0). */
    spread(team, line) {
      if (mu == null) return null;
      // Home covers when M > −line.  Away covers when −M > −line, i.e. M < line.
      if (team === home) return over(S_M, mu, -line);
      const above = over(S_M, mu, line); // P(M > line), push at M == line
      return { win: 1 - above.win - above.push, push: above.push };
    },
    total(side, line) {
      if (tau == null) return null;
      const o = over(S_T, tau, line);
      return side === 'Over' ? o : { win: 1 - o.win - o.push, push: o.push };
    },
  };
}

/**
 * Player prop fair price: interpolate P(stat > line) across the player's Kalshi ladder for that stat
 * (in log-odds), enforcing that higher thresholds are never more likely. Returns null outside the ladder.
 */
export function propFair(rungs, line, side) {
  const pts = rungs
    .map((e) => ({ k: e.strike, p: mid(e) }))
    .filter((x) => x.p != null && x.p > 0.02 && x.p < 0.98)
    .sort((a, b) => a.k - b.k);
  if (!pts.length) return null;
  for (let i = 1; i < pts.length; i++) pts[i].p = Math.min(pts[i].p, pts[i - 1].p);
  const L = Number.isInteger(line) ? line + 0.5 : line; // whole-number prop lines: treat Over as "line + 1 or more"
  let p = null;
  const exact = pts.find((x) => x.k === L);
  if (exact) p = exact.p;
  else {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (L > a.k && L < b.k) {
        const lg = (q) => Math.log(q / (1 - q));
        const t = (L - a.k) / (b.k - a.k);
        p = 1 / (1 + Math.exp(-(lg(a.p) + t * (lg(b.p) - lg(a.p)))));
        break;
      }
    }
  }
  if (p == null) return null;
  return { win: side === 'Over' ? p : 1 - p, push: 0 };
}

/** Probability that counts toward edge: win chance given the bet isn't a push (pushes refund the stake). */
export const actionProb = (f) => (f && f.win > 0 ? f.win / (1 - f.push) : null);
