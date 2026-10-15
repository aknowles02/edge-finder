// Pure betting math shared by the API (import/grading) and the browser (filters/stats).
// No Node or DOM dependencies — keep it that way.

export const MARKETS = ['spread', 'total', 'prop'];
export const SMALL_SAMPLE = 15;
export const WEIGHT_2025 = 0.75; // 75% full 2025 season, 25% 2026 to date
export const DEFAULT_ODDS_WINDOW = { min: -500, max: -200 };

/** American odds -> implied probability. Negative: |o| / (|o| + 100). */
export function impliedProbability(odds) {
  const o = Number(odds);
  if (!Number.isInteger(o) || Math.abs(o) < 100) throw new Error(`Invalid American odds: ${odds}`);
  return o < 0 ? -o / (-o + 100) : 100 / (o + 100);
}

/** Profit in units on a 1u stake that wins. */
export function payout(odds) {
  return odds < 0 ? 100 / -odds : odds / 100;
}

function present(rate, n) {
  return rate != null && Number.isFinite(rate) && (n == null || n > 0);
}

/** Weighted blend of the two seasons; falls back to whichever season has data. */
export function blendHitRate(h25, n25, h26, n26) {
  const a = present(h25, n25);
  const b = present(h26, n26);
  if (a && b) return WEIGHT_2025 * h25 + (1 - WEIGHT_2025) * h26;
  if (a) return h25;
  if (b) return h26;
  return null;
}

/** "78%", "0.78", "78" -> 0.78. Blank -> null. */
export function parseRate(value) {
  if (value == null) return null;
  const s = String(value).trim().replace('%', '');
  if (s === '') return null;
  let n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Bad hit rate "${value}"`);
  if (n > 1) n /= 100;
  if (n < 0 || n > 1) throw new Error(`Hit rate out of range "${value}"`);
  return n;
}

export function parseOdds(value) {
  const s = String(value ?? '').trim().replace(/−/g, '-').replace(/^\+/, '');
  const n = Number(s);
  impliedProbability(n); // validates
  return n;
}

function parseNumber(value, label, { required = false } = {}) {
  const s = String(value ?? '').trim().replace(/−/g, '-').replace(/^\+/, '');
  if (s === '') {
    if (required) throw new Error(`${label} is required`);
    return null;
  }
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Bad ${label} "${value}"`);
  return n;
}

/** "BUF @ MIA" / "BUF at MIA" / "BUF vs MIA" -> { away, home } */
export function parseGame(label) {
  const parts = String(label).trim().split(/\s+(?:@|at|vs\.?)\s+/i);
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error(`Game must look like "AWAY @ HOME", got "${label}"`);
  return { away: parts[0].trim(), home: parts[1].trim() };
}

export function normalizeMarket(value) {
  const s = String(value ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (['spread', 'spreads', 'altspread', 'altspreads', 'ats'].includes(s)) return 'spread';
  if (['total', 'totals', 'alttotal', 'alttotals', 'ou', 'overunder'].includes(s)) return 'total';
  if (['prop', 'props', 'playerprop', 'playerprops', 'player'].includes(s)) return 'prop';
  throw new Error(`Unknown market "${value}" (use spread, total or prop)`);
}

/** Minimal CSV/TSV parser with quoted-field support. Tab-delimited if the header has a tab. */
export function parseDelimited(text) {
  const src = String(text).replace(/\r\n?/g, '\n');
  const delim = src.split('\n', 1)[0].includes('\t') ? '\t' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

const HEADER_ALIASES = {
  game: ['game', 'matchup', 'event'],
  market: ['market', 'type', 'bettype'],
  selection: ['selection', 'bet', 'side', 'pick'],
  line: ['line', 'alt', 'altline', 'number'],
  odds: ['odds', 'price', 'dkodds'],
  hit2025: ['hit2025', 'hr2025', '2025hit', '2025hitrate', 'hitrate2025', '2025'],
  n2025: ['n2025', 'games2025', '2025n', '2025games', 'sample2025'],
  hit2026: ['hit2026', 'hr2026', '2026hit', '2026hitrate', 'hitrate2026', '2026'],
  n2026: ['n2026', 'games2026', '2026n', '2026games', 'sample2026'],
};

function mapHeader(cells) {
  const norm = cells.map((c) => c.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const idx = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = norm.findIndex((h) => aliases.includes(h));
    if (i !== -1) idx[key] = i;
  }
  const missing = ['game', 'market', 'selection', 'odds'].filter((k) => idx[k] == null);
  if (idx.hit2025 == null && idx.hit2026 == null) missing.push('hit_2025 or hit_2026');
  return { idx, missing };
}

/**
 * Parse a pasted board. Returns scored rows (all of them — callers filter on edge)
 * and per-line errors. Expected header:
 * game,market,selection,line,odds,hit_2025,n_2025,hit_2026,n_2026
 */
export function parseBoardInput(text) {
  const table = parseDelimited(text);
  if (table.length < 2) return { rows: [], errors: [{ line: 1, message: 'Paste a header row plus at least one bet' }] };
  const { idx, missing } = mapHeader(table[0]);
  if (missing.length) return { rows: [], errors: [{ line: 1, message: `Missing column(s): ${missing.join(', ')}` }] };

  const rows = [];
  const errors = [];
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (k) => (idx[k] == null ? '' : (cells[idx[k]] ?? '').trim());
    try {
      const game = get('game');
      const { away, home } = parseGame(game);
      const market = normalizeMarket(get('market'));
      let selection = get('selection');
      if (!selection) throw new Error('Selection is required');
      const lineValue = parseNumber(get('line'), 'line', { required: market !== 'prop' });

      if (market === 'spread') {
        const team = selection.toUpperCase();
        if (team !== away.toUpperCase() && team !== home.toUpperCase()) {
          throw new Error(`Spread selection "${selection}" must be ${away} or ${home}`);
        }
        selection = team;
      } else if (market === 'total') {
        const s = selection.toLowerCase();
        if (s !== 'over' && s !== 'under' && s !== 'o' && s !== 'u') throw new Error('Total selection must be Over or Under');
        selection = s.startsWith('o') ? 'Over' : 'Under';
      }

      const odds = parseOdds(get('odds'));
      const hit2025 = parseRate(get('hit2025'));
      const hit2026 = parseRate(get('hit2026'));
      const n2025 = parseNumber(get('n2025'), 'n_2025');
      const n2026 = parseNumber(get('n2026'), 'n_2026');
      const blended = blendHitRate(hit2025, n2025, hit2026, n2026);
      if (blended == null) throw new Error('No usable hit rate');
      const implied = impliedProbability(odds);

      rows.push({
        game, away, home, market, selection, line: lineValue, odds,
        hit2025, n2025, hit2026, n2026,
        blended, implied, edge: blended - implied,
        sampleSize: (n2025 ?? 0) + (n2026 ?? 0),
      });
    } catch (err) {
      errors.push({ line, message: err.message });
    }
  });
  return { rows, errors };
}

/** W / L / P for spreads and totals once the game has a final score; props are graded manually. */
export function gradeBet(bet, game) {
  if (game.awayScore == null || game.homeScore == null || bet.line == null) return null;
  let value;
  if (bet.market === 'spread') {
    const team = bet.selection.toUpperCase();
    let margin;
    if (team === game.away.toUpperCase()) margin = game.awayScore - game.homeScore;
    else if (team === game.home.toUpperCase()) margin = game.homeScore - game.awayScore;
    else return null;
    value = margin + Number(bet.line);
  } else if (bet.market === 'total') {
    const total = game.awayScore + game.homeScore;
    value = bet.selection === 'Over' ? total - Number(bet.line) : Number(bet.line) - total;
  } else {
    return null;
  }
  return value > 0 ? 'W' : value < 0 ? 'L' : 'P';
}

/** Flat 1u stakes. Pushes refund the stake and are excluded from win rate and ROI. */
export function summarize(bets) {
  let wins = 0, losses = 0, pushes = 0, units = 0;
  for (const b of bets) {
    if (b.result === 'W') { wins++; units += payout(b.odds); }
    else if (b.result === 'L') { losses++; units -= 1; }
    else if (b.result === 'P') pushes++;
  }
  const decided = wins + losses;
  return {
    wins, losses, pushes, units,
    total: bets.length,
    pending: bets.length - decided - pushes,
    winRate: decided ? wins / decided : null,
    roi: decided ? units / decided : null,
  };
}

const signed = (n, digits = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;

/** "144–26 (84.7%), +13.5u (+8.0% ROI)" */
export function formatRecord(s) {
  if (!s.wins && !s.losses && !s.pushes) return 'No graded bets yet';
  const record = `${s.wins}–${s.losses}${s.pushes ? `–${s.pushes}` : ''}`;
  const pct = s.winRate == null ? '—' : `${(s.winRate * 100).toFixed(1)}%`;
  const roi = s.roi == null ? '—' : `${signed(s.roi * 100)}% ROI`;
  return `${record} (${pct}), ${signed(s.units)}u (${roi})`;
}

/** Lines on the same side of a game are correlated: keep only the highest-edge one. */
export function bestPerSide(bets) {
  const best = new Map();
  for (const b of bets) {
    const key = `${b.game}|${b.market}|${b.selection.toLowerCase()}`;
    const cur = best.get(key);
    if (!cur || b.edge > cur.edge) best.set(key, b);
  }
  return bets.filter((b) => best.get(`${b.game}|${b.market}|${b.selection.toLowerCase()}`) === b);
}

export function betLabel(b) {
  if (b.line == null) return b.selection;
  if (b.market === 'spread') return `${b.selection} ${b.line > 0 ? '+' : ''}${b.line}`;
  return `${b.selection} ${b.line}`;
}

export function formatOdds(odds) {
  return odds > 0 ? `+${odds}` : `${odds}`.replace('-', '−');
}
